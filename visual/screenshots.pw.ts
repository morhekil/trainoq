import { expect, test, type Page } from "@playwright/test";

const day = "2026-09-15";
const emptyDay = "2026-09-16";
const doc = {
  v: 1,
  date: day,
  morning: "Slept well. Left shoulder feels a little stiff.",
  sessions: [{
    id: "session-1",
    startedAt: "2026-09-15T07:00:00.000Z",
    endedAt: "2026-09-15T08:00:00.000Z",
    warmup: [{ id: "warmup-1", name: "Band pull-apart", reps: "2x15", comment: "" }],
    main: [{ id: "block-1", exercises: [{
      id: "exercise-1", name: "Squat", comment: "",
      sets: [
        { id: "set-1", type: "warmup", weight: 40, reps: 8 },
        { id: "set-2", type: "working", weight: 80, reps: 5 },
        { id: "set-3", type: "backoff", weight: 65, reps: 8 },
      ],
    }] }],
    cooldown: [],
    calories: 320,
    notes: "Good pace today.",
  }],
  activities: [{ id: "activity-1", name: "Walk", minutes: 25, calories: 95, notes: "" }],
  totalCalories: 415,
  notes: "",
};

async function mockApi(page: Page, signedIn = true) {
  await page.route("**/api/trpc/**", async (route) => {
    const procedure = new URL(route.request().url()).pathname.split("/").at(-1);
    if (procedure === "auth.me" && !signedIn) {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({
        error: { message: "Unauthorized", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } },
      }) });
      return;
    }
    const data = procedure === "auth.me" ? { ok: true }
      : procedure === "days.get" ? { date: day, doc: null, updatedAt: null }
      : procedure === "days.list" ? []
      : procedure === "exercises.library" ? { stats: [], history: {} }
      : procedure === "days.save" ? { ok: true, updatedAt: "2026-09-15T09:00:00.000Z" }
      : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
}

async function checkWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test("login screen", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("login.png");
});

test("overlays keep keyboard focus inside and return it on Escape", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await expect(page.getByText("Squat", { exact: true })).toBeVisible();

  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  await checkModalKeyboard(page, "Actions", menu);

  const addExercise = page.getByRole("button", { name: "Add exercise" }).first();
  await addExercise.click();
  await checkModalKeyboard(page, "Warm-up exercise", addExercise);

  const share = page.getByRole("button", { name: "Share day with PT / physio" });
  await share.click();
  await checkModalKeyboard(page, "Share day", share);
});

test("reduced motion keeps live state visible without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc: { ...doc, sessions: [{ ...doc.sessions[0], endedAt: null }] } });
  await page.goto(`/#/d/${day}`);
  const dot = page.locator(".live-dot");
  await expect(dot).toBeVisible();
  expect(await dot.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.getByRole("button", { name: "Menu" }).click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

async function checkModalKeyboard(page: Page, name: string, trigger: ReturnType<Page["getByRole"]>) {
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, inside: Boolean(document.activeElement?.closest('dialog,[role="dialog"]')) }));
    if (focus.tag === "BODY") {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog,[role="dialog"]')))).toBe(true);
    } else {
      expect(focus.inside).toBe(true);
    }
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
}

for (const width of [320, 390, 1280]) {
  test(`day, picker, menu and history at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page);
    await page.addInitScript(({ date, doc }) => {
      localStorage.setItem("tq:authed", JSON.stringify(true));
      localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
    }, { date: day, doc });
    await page.goto(`/#/d/${emptyDay}`);
    await expect(page.getByText("Morning check-in")).toBeVisible();
    await checkWidth(page);
    await expect(page).toHaveScreenshot(`empty-day-${width}.png`);

    await page.goto(`/#/d/${day}`);
    await expect(page.getByText("Squat", { exact: true })).toBeVisible();
    await checkWidth(page);
    await expect(page).toHaveScreenshot(`logged-day-${width}.png`);

    await page.getByRole("button", { name: "Add exercise" }).first().click();
    await expect(page.getByRole("dialog", { name: "Warm-up exercise" })).toBeVisible();
    await checkWidth(page);
    await expect(page).toHaveScreenshot(`exercise-picker-${width}.png`);
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: "Actions" })).toBeVisible();
    await checkWidth(page);
    await expect(page).toHaveScreenshot(`menu-${width}.png`);
    await page.getByRole("button", { name: "Share this day" }).click();
    await expect(page.getByRole("dialog", { name: "Share day" })).toBeVisible();
    await checkWidth(page);
    await expect(page).toHaveScreenshot(`share-${width}.png`);
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByText("Good pace today.")).not.toBeVisible();
    await expect(page.getByText("Slept well. Left shoulder feels a little stiff.")).toBeVisible();
    await checkWidth(page);
    await expect(page).toHaveScreenshot(`history-${width}.png`);
  });
}
