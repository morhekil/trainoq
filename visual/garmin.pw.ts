import { expect, test } from "@playwright/test";

test("Garmin review can ignore and restore a recording in the local day draft", async ({ page }) => {
  const source = { sourceKey: "garmin:123:2026-09-28T01:22:05.000Z:0", sport: "running", subSport: "generic", title: "Run", startUtc: "2026-09-28T01:22:05.000Z", localDate: "2026-09-28", offsetMinutes: 600, timerSeconds: 1561.339, elapsedSeconds: 1561.339, activeCalories: 172, importedAt: "2026-09-28T08:00:00.000Z", status: "pending", targetId: null, decisionDate: null };
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    const data = procedure === "auth.me" ? { ok: true }
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
