import { isAuthed, login, logout } from "./auth";
import { exerciseLibrary, exportAll, getDay, listDays, putDay, validateDay } from "./db";
import { DATE_RE, type DayDoc } from "../shared/types";

const MAX_DOC_BYTES = 512 * 1024;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;

  if (path === "/api/login" && method === "POST") return login(req, env);
  if (path === "/api/logout" && method === "POST") return logout(req);

  if (!(await isAuthed(req, env))) return error(401, "Not signed in");

  if (path === "/api/me" && method === "GET") return json({ ok: true });

  if (path === "/api/days" && method === "GET") {
    const before = url.searchParams.get("before") ?? undefined;
    if (before && !DATE_RE.test(before)) return error(400, "bad 'before' date");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30) || 30, 1), 200);
    const withSessions = url.searchParams.get("sessions") === "1";
    return json({ days: await listDays(env.DB, { before, limit, withSessions }) });
  }

  const dayMatch = path.match(/^\/api\/days\/(\d{4}-\d{2}-\d{2})$/);
  if (dayMatch) {
    const date = dayMatch[1];
    if (method === "GET") {
      const day = await getDay(env.DB, date);
      return json(day ?? { date, doc: null, updatedAt: null });
    }
    if (method === "PUT") {
      const body = await req.text();
      if (body.length > MAX_DOC_BYTES) return error(413, "Day is too large");
      let parsed: { doc?: DayDoc; base?: string | null };
      try {
        parsed = JSON.parse(body);
      } catch {
        return error(400, "Invalid JSON");
      }
      const problem = validateDay(parsed.doc, date);
      if (problem) return error(400, problem);
      const result = await putDay(env.DB, date, parsed.doc as DayDoc, parsed.base ?? null);
      if (!result.ok) return json({ error: "conflict", current: result.current }, 409);
      return json({ updatedAt: result.updatedAt });
    }
    return error(405, "Method not allowed");
  }

  if (path === "/api/exercises" && method === "GET") return json(await exerciseLibrary(env.DB));

  if (path === "/api/export" && method === "GET") {
    const days = await exportAll(env.DB);
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), days }, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="trainoq-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return error(404, "Not found");
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, env, url);
      } catch (e) {
        console.error(e);
        return error(500, "Server error");
      }
    }
    // Static assets are served by the assets binding before the worker runs;
    // anything reaching here is unknown.
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
