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

function contrastRatio(foreground: number[], background: number[]) {
  const luminance = (color: number[]) => color
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function rgb(color: string) {
  return color.match(/\d+/g)!.slice(0, 3).map(Number);
}

test("login screen", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("login.png");
});

test("password keeps a visible label after entry", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/");
  await page.getByLabel("Password").fill("example-password");
  await expect(page.getByText("Password", { exact: true })).toBeVisible();
});

test("password placeholder remains readable", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/");
  const colors = await page.locator(".login input").evaluate((input) => {
    const placeholder = getComputedStyle(input, "::placeholder");
    return { foreground: placeholder.color, opacity: Number(placeholder.opacity), background: getComputedStyle(input).backgroundColor };
  });
  const background = rgb(colors.background);
  const foreground = rgb(colors.foreground).map((channel, index) => channel * colors.opacity + background[index] * (1 - colors.opacity));
  expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
});

test("Undo remains readable in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("tq:authed", JSON.stringify(true)));
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Add activity" }).click();
  await page.getByRole("button", { name: "Activity options" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const colors = await page.getByRole("button", { name: "Undo" }).evaluate((button) => ({
    foreground: getComputedStyle(button).color,
    filter: getComputedStyle(button).filter,
    background: getComputedStyle(button.parentElement!).backgroundColor,
  }));
  const brightness = Number(colors.filter.match(/brightness\(([^)]+)\)/)?.[1] ?? 1);
  const foreground = rgb(colors.foreground).map((channel) => Math.min(255, channel * brightness));
  expect(contrastRatio(foreground, rgb(colors.background))).toBeGreaterThanOrEqual(4.5);
});

test("Undo stays available until used", async ({ page }) => {
  await page.clock.install();
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("tq:authed", JSON.stringify(true)));
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Add activity" }).click();
  await page.getByRole("button", { name: "Activity options" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.clock.fastForward(7_000);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Activity options" })).toBeVisible();
});

test("later messages do not replace an earlier Undo", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("tq:authed", JSON.stringify(true)));
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Add activity" }).click();
  await page.getByRole("button", { name: "Add activity" }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Activity options" }).first().click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(2, { timeout: 1_000 });
});

test("backup error stays until dismissed", async ({ page }) => {
  await page.clock.install();
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("tq:authed", JSON.stringify(true)));
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Download backup (JSON)" }).click();
  const error = page.locator(".toast");
  await expect(error).toContainText("Couldn't download backup");
  await page.clock.fastForward(3_000);
  await expect(error).toBeVisible();
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await expect(error).not.toBeVisible();
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

test("the transparent date input shows a visible focus indicator", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("tq:authed", JSON.stringify(true)));
  await page.goto(`/#/d/${day}`);
  const dateInput = page.getByLabel("Pick a date");
  await dateInput.focus();
  await expect(dateInput).toBeFocused();
  expect(await page.locator(".date-picker").evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
});

test("exercise search shows keyboard focus", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Add exercise" }).first().click();
  const search = page.getByRole("searchbox", { name: "Warm-up exercise" });
  await search.focus();
  const indicator = await search.evaluate((input) => ({
    outline: getComputedStyle(input).outlineStyle,
    width: parseFloat(getComputedStyle(input).outlineWidth),
  }));
  expect(indicator.outline).not.toBe("none");
  expect(indicator.width).toBeGreaterThanOrEqual(2);
});

test("exercise search keeps its context after typing", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Add exercise" }).first().click();
  await page.getByRole("searchbox", { name: "Warm-up exercise" }).fill("squat");
  await expect(page.getByRole("dialog", { name: "Warm-up exercise" }).getByText("Warm-up exercise", { exact: true })).toBeVisible();
});

test("day and session notes keep visible labels after entry", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await page.getByRole("textbox", { name: "Day notes" }).fill("Evening update");
  await page.getByRole("textbox", { name: "Session notes" }).fill("Form improved");
  await expect(page.getByText("Day notes", { exact: true })).toBeVisible();
  await expect(page.getByText("Session notes", { exact: true })).toBeVisible();
});

test("signed-in views expose a heading hierarchy", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Session" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Warm-up" })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
});

test("dark day and conflict states", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({
      doc, base: null, dirty: false, rev: 1,
      conflict: { doc: null, updatedAt: null },
    }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await expect(page.getByRole("alert")).toBeVisible();
  await checkWidth(page);
  await expect(page).toHaveScreenshot("dark-conflict-day-390.png", { fullPage: true });
});

test("conflict banner leaves the last action reachable", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({
      doc, base: null, dirty: false, rev: 1,
      conflict: { doc: null, updatedAt: null },
    }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const reachable = await page.getByRole("button", { name: "Share day with PT / physio" }).evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    });
    expect(reachable, `Share must be reachable at ${width}px`).toBe(true);
  }
});

test("conflict choice previews both versions before replacing local edits", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockApi(page);
  const other = { ...doc, morning: "Morning note from the other device." };
  await page.addInitScript(({ date, doc, other }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({
      doc, base: "old-revision", dirty: true, rev: 1,
      conflict: { doc: other, updatedAt: "new-revision" },
    }));
  }, { date: day, doc, other });
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Use other device's" }).click();
  const dialog = page.getByRole("dialog", { name: "Review day versions" });
  await expect(dialog).toContainText(doc.morning);
  await expect(dialog).toContainText(other.morning);
  await expect(dialog.getByRole("heading", { name: "Other device" })).toBeInViewport();
  await expect(page).toHaveScreenshot("conflict-review-320.png");
  expect(await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!).doc.morning, day)).toBe(doc.morning);
  await dialog.getByRole("button", { name: "Replace this device's edits" }).click();
  expect(await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!).doc.morning, day)).toBe(other.morning);
});

test("conflict review can be cancelled before replacing the server version", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({
      doc, base: "old-revision", dirty: true, rev: 1,
      conflict: { doc: { ...doc, morning: "Other note" }, updatedAt: "new-revision" },
    }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Keep this one" }).click();
  const dialog = page.getByRole("dialog", { name: "Review day versions" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate((date) => Boolean(JSON.parse(localStorage.getItem(`tq:day:${date}`)!).conflict), day)).toBe(true);
  await page.getByRole("button", { name: "Keep this one" }).click();
  await dialog.getByRole("button", { name: "Replace other device's edits" }).click();
  expect(await page.evaluate((date) => Boolean(JSON.parse(localStorage.getItem(`tq:day:${date}`)!).conflict), day)).toBe(false);
});

test("activity name stays readable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  const activity = page.getByLabel("Activity", { exact: true });
  await expect(activity).toHaveValue("Walk");
  const fit = await activity.evaluate((input: HTMLInputElement) => {
    const style = getComputedStyle(input);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = style.font;
    return { width: input.clientWidth, text: context.measureText(input.value).width, padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), font: style.font };
  });
  expect(fit.text + fit.padding + 24).toBeLessThanOrEqual(fit.width);
});

test("failed sync can be retried with the keyboard", async ({ page }) => {
  await mockApi(page);
  let attempts = 0;
  await page.route("**/api/trpc/days.save", async (route) => {
    attempts++;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({
      error: { message: "Save failed", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    }) });
  });
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: true, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await expect(page.getByText("Retrying")).toBeVisible();
  const retry = page.getByRole("button", { name: /retry sync/i });
  await expect(retry).toBeVisible();
  const before = attempts;
  await retry.focus();
  await retry.press("Enter");
  await expect.poll(() => attempts).toBeGreaterThan(before);
});

test("copy feedback stays above the share dialog", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Share day with PT / physio" }).click();
  await page.getByRole("button", { name: "Copy text" }).click();
  const feedback = page.getByRole("dialog", { name: "Share day" }).getByRole("status");
  await expect(feedback).toContainText(/Copied|Couldn't copy/);
  expect(await feedback.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })).toBe(true);
  await expect(page).toHaveScreenshot("share-copy-320.png");
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
    await expect(page).toHaveScreenshot(`empty-day-${width}.png`, { fullPage: true });

    await page.goto(`/#/d/${day}`);
    await expect(page.getByText("Squat", { exact: true })).toBeVisible();
    await checkWidth(page);
    await expect(page).toHaveScreenshot(`logged-day-${width}.png`, { fullPage: true });

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
