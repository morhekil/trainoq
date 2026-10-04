import { expect, test } from "@playwright/test";

const disconnected = { status: "disconnected", email: null, nextOffset: 0, lastSyncAt: null, lastError: null };

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-29T12:00:00+10:00"));
});

test("connects Garmin and backfills every page without another upload", async ({ page }) => {
  const calls: string[] = [];
  let status = "disconnected";
  let pageCount = 0;
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1)!;
    calls.push(procedure);
    if (procedure === "garmin.connect") {
      expect(route.request().postData()).toContain("garmin-password");
      status = "connected";
    }
    if (procedure === "garmin.sync") pageCount++;
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "garmin.list" ? []
      : procedure === "garmin.connection" ? { status, email: status === "connected" ? "me@example.com" : null, nextOffset: pageCount * 20, lastSyncAt: null, lastError: null }
      : procedure === "garmin.connect" ? { status: "connected" }
      : procedure === "garmin.sync" ? { scanned: pageCount === 1 ? 20 : 1, inserted: pageCount === 1 ? 20 : 1, unchanged: 0, updated: 0, rejected: 0, nextOffset: pageCount === 1 ? 20 : 0, complete: pageCount === 2 }
      : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  await page.goto("/#/garmin");
  await page.getByLabel("Garmin email").fill("me@example.com");
  await page.getByLabel("Garmin password").fill("garmin-password");
  await page.getByLabel("Garmin password").press("Tab");
  await expect(page.getByRole("button", { name: "Connect Garmin" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Backfill complete", { exact: false })).toBeVisible();
  expect(calls.filter((call) => call === "garmin.sync")).toHaveLength(2);
  await expect(page.getByLabel("Garmin password")).toHaveCount(0);
  await expect(page.getByText("me@example.com")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page).toHaveScreenshot("garmin-connected-mobile.png", { fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page).toHaveScreenshot("garmin-connected-dark.png", { fullPage: true });
});

test("shows a code field only when Garmin requests verification", async ({ page }) => {
  let status = "disconnected";
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    if (procedure === "garmin.connect") status = "mfa";
    if (procedure === "garmin.verifyMfa") status = "connected";
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "garmin.connection" ? { ...disconnected, status, email: "me@example.com" }
      : procedure === "garmin.connect" ? { status: "mfa" }
      : procedure === "garmin.verifyMfa" ? { status: "connected" }
      : procedure === "garmin.sync" ? { scanned: 0, inserted: 0, unchanged: 0, updated: 0, rejected: 0, nextOffset: 0, complete: true }
      : procedure === "garmin.list" ? [] : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  await page.goto("/#/garmin");
  await expect(page.getByLabel("Verification code")).toHaveCount(0);
  await page.getByLabel("Garmin email").fill("me@example.com");
  await page.getByLabel("Garmin password").fill("garmin-password");
  await page.getByRole("button", { name: "Connect Garmin" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify Garmin sign-in" }).click();
  await expect(page.getByRole("button", { name: "Sync all now" })).toBeVisible();
});

test("explains a failed scheduled sign-in and accepts replacement credentials", async ({ page }) => {
  let status = "error";
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    if (procedure === "garmin.connect") status = "connected";
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "garmin.connection" ? { ...disconnected, status, email: "me@example.com", lastError: status === "error" ? "Garmin rejected the email or password." : null }
      : procedure === "garmin.connect" ? { status: "connected" }
      : procedure === "garmin.sync" ? { scanned: 0, inserted: 0, unchanged: 0, updated: 0, rejected: 0, nextOffset: 0, complete: true }
      : procedure === "garmin.list" ? [] : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  await page.goto("/#/garmin");
  await expect(page.getByRole("alert")).toContainText("Garmin rejected the email or password.");
  await page.getByLabel("Garmin email").fill("me@example.com");
  await page.getByLabel("Garmin password").fill("new-password");
  await page.getByRole("button", { name: "Connect Garmin" }).click();
  await expect(page.getByText("Backfill complete", { exact: false })).toBeVisible();
});

test("Garmin review can ignore and restore a recording in the local day draft", async ({ page }) => {
  const source = { sourceKey: "garmin:123:2026-09-28T01:22:05.000Z:0", sport: "running", subSport: "generic", title: "Run", startUtc: "2026-09-28T01:22:05.000Z", localDate: "2026-09-28", offsetMinutes: 600, timerSeconds: 1561.339, elapsedSeconds: 1561.339, activeCalories: 172, importedAt: "2026-09-28T08:00:00.000Z", status: "pending", targetId: null, decisionDate: null };
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "garmin.connection" ? disconnected
      : procedure === "garmin.list" ? [source]
      : procedure === "days.get" ? { date: "2026-09-28", doc: null, updatedAt: null }
      : procedure === "days.save" ? { ok: true, updatedAt: "2026-09-28T09:00:00.000Z" }
      : procedure === "exercises.library" ? { catalog: [], stats: [], history: {} }
      : procedure === "days.list" ? [] : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  await page.goto("/#/garmin");
  await expect(page.getByRole("heading", { name: "Garmin activities" })).toBeVisible();
  await expect(page.getByText("172 active cal")).toBeVisible();
  await expect(page).toHaveScreenshot("garmin-review-mobile.png", { fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page).toHaveScreenshot("garmin-review-desktop.png", { fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page).toHaveScreenshot("garmin-review-dark.png", { fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Ignore Run" }).click();
  await expect(page.getByText("Ignored", { exact: true })).toBeVisible();
  const ignored = await page.evaluate(() => JSON.parse(localStorage.getItem("tq:day:2026-09-28")!));
  expect(ignored.doc.ignoredGarminSourceKeys).toEqual([source.sourceKey]);
  await page.getByRole("button", { name: "Restore Run" }).click();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("tq:day:2026-09-28")!));
  expect(restored.doc.ignoredGarminSourceKeys).toEqual([]);
});

test("imports an original FIT in the browser and sends verified active calories", async ({ page }) => {
  const fit = "DgLhUpUAAAAuRklURV5AAAAAAAUAAQIBAoQCAoQDBIwEBIYABAEAAQB7AAAAPXUcRUEAABIADP4ChAIEhv0EhgUBAgYBAm4EBwcEhggEhgsChMQChAABAgEBAgEAAD11HEVWexxFAQBSdW4A+9IXAPvSFwDPACMACAFCAAAiAAb9BIYFBIYBAoQABIYDAQIEAQICPXUcRd0BHUUBAPvSFwAaAVfl";
  let imported: unknown = null;
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    if (procedure === "garmin.import") { const payload = route.request().postDataJSON(); imported = payload.json ?? payload; }
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "garmin.connection" ? disconnected
      : procedure === "garmin.list" ? []
      : procedure === "garmin.import" ? { inserted: 1, unchanged: 0, updated: 0, rejected: 0 }
      : procedure === "exercises.library" ? { catalog: [], stats: [], history: {} }
      : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  await page.goto("/#/garmin");
  await page.getByLabel("Choose FIT files").setInputFiles({ name: "run.fit", mimeType: "application/octet-stream", buffer: Buffer.from(fit, "base64") });
  await expect(page.getByText("1 imported", { exact: false })).toBeVisible();
  expect(imported).toMatchObject({ activities: [{ activeCalories: 172, localDate: "2026-09-28", timerSeconds: 1561.339 }] });
});

test("edits an accepted activity's Garmin local start time", async ({ page }) => {
  const doc = { v: 5, date: "2026-09-28", morning: "", sessions: [], activities: [{ id: "run", exerciseId: "seed:0170", comment: "", startedAt: "2026-09-28T06:00:00.000Z", sourceOffsetMinutes: 330, garminSourceKey: "garmin:123:2026-09-28T06:00:00.000Z:0", result: { minutes: 26, calories: 172 } }], ignoredGarminSourceKeys: [], totalCalories: null, notes: "" };
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "garmin.connection" ? disconnected
      : procedure === "days.get" ? { date: doc.date, doc, updatedAt: "base" }
      : procedure === "exercises.library" ? { catalog: [], stats: [], history: {} }
      : procedure === "days.list" ? [] : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  await page.goto("/#/d/2026-09-28");
  const input = page.getByLabel("Start time for Run");
  await expect(input).toHaveValue("11:30");
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page).toHaveScreenshot("garmin-linked-day-mobile.png", { fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page).toHaveScreenshot("garmin-linked-day-dark.png", { fullPage: true });
  await input.fill("12:15");
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("tq:day:2026-09-28")!));
  expect(draft.doc.activities[0].startedAt).toBe("2026-09-28T06:45:00.000Z");
});

test("moves an accepted activity to a corrected Trainoq day", async ({ page }) => {
  const key = "garmin:123:2026-09-28T01:22:05.000Z:0";
  const source = { sourceKey: key, sport: "running", subSport: "generic", title: "Run", startUtc: "2026-09-28T01:22:05.000Z", localDate: "2026-09-28", offsetMinutes: 600, timerSeconds: 1561.339, elapsedSeconds: 1561.339, activeCalories: 172, importedAt: "2026-09-28T08:00:00.000Z", status: "activity", targetId: "run", decisionDate: "2026-09-28" };
  const old = { v: 5, date: "2026-09-28", morning: "", sessions: [], activities: [{ id: "run", exerciseId: "seed:0170", comment: "Corrected", startedAt: source.startUtc, sourceOffsetMinutes: 600, garminSourceKey: key, result: { minutes: 30, calories: 160 } }], ignoredGarminSourceKeys: [], totalCalories: null, notes: "" };
  const saves: string[] = [];
  let oldCompleted = false;
  let newStartedBeforeOldComplete = false;
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    const url = new URL(route.request().url());
    const requestedDate = JSON.parse(url.searchParams.get("input") ?? '""');
    if (procedure === "days.save") {
      const body = route.request().postDataJSON();
      const date = (body.json ?? body).date;
      saves.push(date);
      if (date === old.date) { await new Promise((resolve) => setTimeout(resolve, 900)); oldCompleted = true; }
      else if (!oldCompleted) newStartedBeforeOldComplete = true;
    }
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "garmin.connection" ? disconnected
      : procedure === "garmin.list" ? [source]
      : procedure === "days.get" ? { date: requestedDate, doc: requestedDate === old.date ? old : null, updatedAt: requestedDate === old.date ? "base" : null }
      : procedure === "days.save" ? { ok: true, updatedAt: "new-base" }
      : procedure === "exercises.library" ? { catalog: [], stats: [], history: {} }
      : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  await page.goto("/#/garmin");
  await expect(page.getByText("Added activity")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page).toHaveScreenshot("garmin-accepted-review-mobile.png", { fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page).toHaveScreenshot("garmin-accepted-review-dark.png", { fullPage: true });
  await page.getByLabel("Correct Trainoq date").fill("2026-09-29");
  await page.getByRole("button", { name: "Move activity" }).click();
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem("tq:day:2026-09-29"))).toBe(true);
  const drafts = await page.evaluate(() => ["2026-09-28", "2026-09-29"].map((date) => localStorage.getItem(`tq:day:${date}`)));
  const days = drafts.map((value) => JSON.parse(value!).doc);
  expect(days[0].activities).toEqual([]);
  expect(days[1].activities).toMatchObject([{ id: "run", comment: "Corrected", startedAt: "2026-09-29T01:22:05.000Z", result: { minutes: 30, calories: 160 } }]);
  await expect.poll(() => saves.length).toBe(2);
  expect(saves).toEqual(["2026-09-28", "2026-09-29"]);
  expect(newStartedBeforeOldComplete).toBe(false);
});

test("requires an explicit session choice when strength matches are ambiguous", async ({ page }) => {
  const source = { sourceKey: "garmin:123:2026-09-28T06:00:00.000Z:0", sport: "training", subSport: "strengthTraining", title: "Strength", startUtc: "2026-09-28T06:00:00.000Z", localDate: "2026-09-28", offsetMinutes: 600, timerSeconds: 3600, elapsedSeconds: 3700, activeCalories: 362, importedAt: "2026-09-28T08:00:00.000Z", status: "pending", targetId: null, decisionDate: null };
  const session = (id: string, startedAt: string) => ({ id, startedAt, endedAt: "2026-09-28T07:00:00.000Z", warmup: [], main: [], cooldown: [], calories: null, notes: "Keep sets" });
  const doc = { v: 5, date: "2026-09-28", morning: "", sessions: [session("first", "2026-09-28T05:45:00.000Z"), session("second", "2026-09-28T06:10:00.000Z")], activities: [], ignoredGarminSourceKeys: [], totalCalories: null, notes: "" };
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "garmin.connection" ? disconnected
      : procedure === "garmin.list" ? [source]
      : procedure === "days.get" ? { date: doc.date, doc, updatedAt: "base" }
      : procedure === "days.save" ? { ok: true, updatedAt: "new-base" }
      : procedure === "exercises.library" ? { catalog: [], stats: [], history: {} }
      : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  await page.goto("/#/garmin");
  const chooser = page.getByLabel("Training session");
  await expect(chooser).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page).toHaveScreenshot("garmin-strength-ambiguous-mobile.png", { fullPage: true });
  await expect(page.getByRole("button", { name: "Link to session" })).toHaveCount(0);
  await chooser.selectOption("second");
  await page.getByRole("button", { name: "Link to session" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tq:day:2026-09-28") ?? "null")?.doc?.sessions?.[1]?.garminSourceKey)).toBe(source.sourceKey);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("tq:day:2026-09-28")!).doc);
  expect(saved.sessions[0].garminSourceKey).toBeUndefined();
  expect(saved.sessions[1]).toMatchObject({ id: "second", calories: 362, notes: "Keep sets" });
});
