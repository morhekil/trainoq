import { expect, test, type Page } from "@playwright/test";

const reading = (id = "12", weightKg = 82.5) => ({ sourceId: `withings:7:${id}`, userId: "7", groupId: id,
  measuredAt: "2026-11-17T21:00:00.000Z", timezone: "Australia/Sydney", localDate: "2026-11-18", weightKg });
const connected = { configured: true, connected: true, userId: "7", lastSyncAt: "2026-11-18T00:00:00.000Z", lastError: null, historyComplete: true };

async function mockApi(page: Page, options: { connected?: boolean; configured?: boolean; empty?: boolean; error?: boolean } = {}) {
  let connection = { ...connected, connected: options.connected ?? true, configured: options.configured ?? true, lastSyncAt: options.connected === false ? null : connected.lastSyncAt };
  let synced = false, disconnected = false, fail = options.error ?? false;
  const calls: string[] = [];
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url()); const procedure = url.pathname.split("/").at(-1)!; calls.push(procedure);
    const input = JSON.parse(url.searchParams.get("input") ?? route.request().postData() ?? "{}");
    if (procedure === "withings.sync" && fail) {
      fail = false;
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { message: "Withings is unavailable. Retry sync shortly.", code: -32603, data: { code: "BAD_GATEWAY", httpStatus: 502 } } }) });
      return;
    }
    if (procedure === "withings.sync") synced = true;
    if (procedure === "withings.disconnect") { connection = { ...connection, connected: false, lastSyncAt: null }; disconnected = true; }
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "days.get" ? { date: "2026-11-18", doc: null, updatedAt: null }
      : procedure === "days.list" ? []
      : procedure === "exercises.library" ? { catalog: [], stats: [], history: {}, params: {}, templates: [] }
      : procedure === "withings.connection" ? connection
      : procedure === "withings.measurements" ? { items: options.empty ? [] : input.cursor ? [reading("11", 82.7)] : [reading()], nextCursor: !options.empty && !input.from && !input.cursor ? { measuredAt: reading().measuredAt, sourceId: reading().sourceId } : null }
      : procedure === "withings.authorize" ? { url: "https://account.withings.com/oauth2_user/authorize2?state=test" }
      : procedure === "withings.sync" ? { imported: 1, complete: true }
      : { ok: true };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
  await page.addInitScript(() => localStorage.setItem("tq:authed", "true"));
  return { calls, synced: () => synced, disconnected: () => disconnected };
}

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-11-18T12:00:00+11:00")); });

test("opens Withings from the menu and authorizes through a keyboard accessible control", async ({ page }) => {
  const api = await mockApi(page, { connected: false, empty: true });
  await page.route("https://account.withings.com/**", (route) => route.fulfill({ contentType: "text/html", body: "Withings consent" }));
  await page.goto("/#/"); await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Withings weight", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Withings weight" })).toBeVisible();
  const connect = page.getByRole("button", { name: "Connect Withings", exact: true });
  await page.keyboard.press("Tab"); await connect.focus(); expect(await connect.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter"); await expect(page).toHaveURL(/account.withings.com/);
  expect(api.calls).toContain("withings.authorize");
});

test("syncs a page, loads older readings, retries an error and disconnects without removing readings", async ({ page }) => {
  const api = await mockApi(page, { error: true }); await page.goto("/#/withings");
  await expect(page.getByText("82.5 kg", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Retry sync");
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Imported 1" })).toBeVisible(); expect(api.synced()).toBe(true);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.getByText("82.7 kg", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Disconnect Withings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect Withings", exact: true })).toBeVisible();
  expect(api.disconnected()).toBe(true); await expect(page.getByText("82.5 kg", { exact: true })).toBeVisible();
});

test("shows weight on its Withings local day without saving a training document", async ({ page }) => {
  const api = await mockApi(page); await page.goto("/#/d/2026-11-18");
  await expect(page.getByRole("region", { name: "Body weight" })).toContainText("82.5 kg");
  await expect(page.getByRole("region", { name: "Body weight" })).toContainText("08:00");
  expect(api.calls).not.toContain("days.save");
});

test("keeps cancellation errors on the Withings screen and provides reconnection", async ({ page }) => {
  await mockApi(page, { connected: false, empty: true }); await page.goto("/#/withings?error=authorization");
  await expect(page.getByRole("heading", { level: 1, name: "Withings weight" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Connect Withings");
  await expect(page.getByRole("button", { name: "Connect Withings", exact: true })).toBeEnabled();
});

for (const width of [320, 1280]) for (const theme of ["light", "dark"] as const) {
  test(`Withings states at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await mockApi(page); await page.goto("/#/withings"); await expect(page.getByText("82.5 kg", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const contrasts = await page.getByRole("main").evaluate((main) => {
      const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((n) => n / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
      return [...main.querySelectorAll("p, h2, a, strong, button:not(:disabled)")].map((element) => {
        let ancestor: Element | null = element;
        while (ancestor && ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(ancestor).backgroundColor)) ancestor = ancestor.parentElement;
        const foreground = luminance(getComputedStyle(element).color), background = luminance(getComputedStyle(ancestor!).backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });
    expect(Math.min(...contrasts)).toBeGreaterThanOrEqual(4.5);
    await expect(page).toHaveScreenshot(`withings-connected-${width}-${theme}.png`, { fullPage: true });
    await page.goto("/#/d/2026-11-18"); await expect(page.getByRole("region", { name: "Body weight" })).toBeVisible();
    await expect(page).toHaveScreenshot(`withings-day-${width}-${theme}.png`, { fullPage: true });
    await mockApi(page, { connected: false, empty: true }); await page.goto("/#/withings?error=authorization");
    await expect(page.getByRole("button", { name: "Connect Withings", exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot(`withings-disconnected-${width}-${theme}.png`, { fullPage: true });
    await page.getByRole("button", { name: "Connect Withings", exact: true }).focus();
    expect(await page.getByRole("button", { name: "Connect Withings", exact: true }).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("shows setup and empty states and retries loading errors", async ({ page }) => {
  await mockApi(page, { configured: false, connected: false, empty: true }); await page.goto("/#/withings");
  await expect(page.getByText(/app owner.*setup/)).toBeVisible();
  await expect(page.getByText(/No weight measurements/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Withings", exact: true })).toHaveCount(0);
  await expect(page).toHaveScreenshot("withings-setup-mobile.png", { fullPage: true });
  await page.route("**/api/trpc/withings.connection**", (route) => route.fulfill({ status: 500, body: "failed" }));
  await page.reload(); await expect(page.getByRole("alert")).toContainText("Retry");
  const retry = page.getByRole("button", { name: "Retry loading" }); await retry.focus(); await page.keyboard.press("Enter");
  await expect(retry).toBeEnabled();
  await expect(page).toHaveScreenshot("withings-load-error-mobile.png", { fullPage: true });
});
