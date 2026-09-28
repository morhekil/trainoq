import { expect, test, type Page } from "@playwright/test";

const day = "2026-09-15";
const emptyDay = "2026-09-16";
const doc = {
  v: 2,
  date: day,
  morning: "Slept well. Left shoulder feels a little stiff.",
  sessions: [{
    id: "session-1",
    startedAt: "2026-09-15T07:00:00.000Z",
    endedAt: "2026-09-15T08:00:00.000Z",
    warmup: [{ id: "warmup-1", exercises: [{ id: "warmup-exercise-1", name: "Band pull-apart", comment: "", sets: [
      { id: "warmup-set-1", type: "working", weight: null, reps: 15 },
      { id: "warmup-set-2", type: "working", weight: null, reps: 15 },
    ] }] }],
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
      : procedure === "exercises.library" ? { catalog: [], stats: [], history: {} }
      : procedure === "exercises.create" ? JSON.parse(route.request().postData() ?? "{}").json ?? null
      : procedure === "days.save" ? { ok: true, updatedAt: "2026-09-15T09:00:00.000Z" }
      : null;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data } }) });
  });
}

async function checkWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function addActivity(page: Page, name = "Walk") {
  await page.getByRole("button", { name: "Add activity" }).click();
  await page.getByRole("dialog", { name: "Add activity" }).getByRole("button", { name, exact: true }).click();
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

test("visible placeholder remains readable in both themes", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("tq:authed", JSON.stringify(true)));
  await page.goto(`/#/d/${emptyDay}`);
  const field = page.getByLabel("Morning check-in");
  expect(await field.getAttribute("placeholder")).toBeTruthy();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const colors = await field.evaluate((input) => {
      const placeholder = getComputedStyle(input, "::placeholder");
      return { foreground: placeholder.color, opacity: Number(placeholder.opacity), background: getComputedStyle(input).backgroundColor };
    });
    const background = rgb(colors.background);
    const foreground = rgb(colors.foreground).map((channel, index) => channel * colors.opacity + background[index] * (1 - colors.opacity));
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
});

test("Undo remains readable in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("tq:authed", JSON.stringify(true)));
  await page.goto(`/#/d/${day}`);
  await addActivity(page);
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
  await addActivity(page);
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
  await addActivity(page);
  await addActivity(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Activity options" }).first().click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(2, { timeout: 1_000 });
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByRole("button", { name: "Activity options" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
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

  const addExercise = page.getByRole("button", { name: "Add exercise", exact: true }).first();
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
  await page.getByRole("button", { name: "Add exercise", exact: true }).first().click();
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
  await page.getByRole("button", { name: "Add exercise", exact: true }).first().click();
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

test("activity choice stays readable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  const activity = page.getByRole("button", { name: "Change Walk" });
  await expect(activity).toHaveText("Walk");
  const fit = await activity.evaluate((button) => {
    const style = getComputedStyle(button);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = style.font;
    return { width: button.clientWidth, text: context.measureText(button.textContent ?? "").width, padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), font: style.font };
  });
  expect(fit.text + fit.padding + 24).toBeLessThanOrEqual(fit.width);
});

test("activity uses the exercise picker at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Add activity" }).click();
  const picker = page.getByRole("dialog", { name: "Add activity" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Tennis" }).click();
  await expect(page.getByRole("button", { name: "Change Tennis" })).toBeVisible();
  await checkWidth(page);
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

test("warm-up and cool-down can edit supersets with numeric sets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);

  for (const title of ["Warm-up", "Cool-down"]) {
    const section = page.locator(".section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await section.getByRole("button", { name: "Superset", exact: true }).click();
    const block = section.locator(".block.superset");
    await expect(block).toHaveCount(1);
    await expect(block.locator(".exercise")).toHaveCount(0);
    for (const exercise of [`${title} press`, `${title} row`]) {
      await block.getByRole("button", { name: "Add exercise to superset" }).click();
      await page.getByRole("searchbox", { name: "Add to superset" }).fill(exercise);
      await page.getByRole("searchbox", { name: "Add to superset" }).press("Enter");
    }
    await expect(block.locator(".exercise")).toHaveCount(2);
    await block.getByRole("button", { name: "Round", exact: true }).click();
    await block.getByRole("textbox", { name: `${title} press W1 weight` }).fill("12");
    await block.getByRole("textbox", { name: `${title} press W1 reps` }).fill("7");
    await block.getByRole("textbox", { name: `${title} row W1 weight` }).fill("0");
    await block.getByRole("textbox", { name: `${title} row W1 reps` }).fill("9");
    await block.getByRole("button", { name: "Round", exact: true }).click();
    await expect(block.getByRole("textbox", { name: `${title} press W2 weight` })).toHaveValue("12");
    await expect(block.getByRole("textbox", { name: `${title} press W2 reps` })).toHaveValue("7");
    await expect(block.getByRole("textbox", { name: `${title} row W2 weight` })).toHaveValue("0");
    await expect(block.getByRole("textbox", { name: `${title} row W2 reps` })).toHaveValue("9");
    await expect(block.locator(".exercise").first().locator(".set-row")).toHaveCount(2);
    await expect(block.locator(".exercise").last().locator(".set-row")).toHaveCount(2);
    await block.getByRole("button", { name: /Superset .* options/ }).click();
    await page.getByRole("button", { name: "Delete round W1" }).click();
    await page.getByRole("button", { name: "Undo" }).last().click();
    await expect(block.locator(".exercise").first().locator(".set-row")).toHaveCount(2);
    await checkWidth(page);
  }
  await expect(page.locator(".sync.saved")).toBeVisible();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => window.scrollTo(0, 0));
      await checkWidth(page);
      await expect(page).toHaveScreenshot(`sections-supersets-${width}-${colorScheme}.png`, { fullPage: true });
    }
  }
  const lastAction = page.locator(".section").filter({ has: page.getByRole("heading", { name: "Cool-down", exact: true }) }).getByRole("button", { name: "Add exercise", exact: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await lastAction.scrollIntoViewIfNeeded();
  await expect(lastAction).toBeInViewport();
  const warmup = page.locator(".section").filter({ has: page.getByRole("heading", { name: "Warm-up", exact: true }) });
  await warmup.getByRole("button", { name: "Warm-up row options" }).click();
  await page.getByRole("button", { name: "Take out of superset" }).click();
  await expect(warmup.locator(".block.superset")).toHaveCount(1);
  await warmup.getByRole("button", { name: "Warm-up row options" }).click();
  await page.getByRole("button", { name: "Move up" }).click();
  await expect(warmup.locator(".block").nth(1).getByRole("button", { name: "Warm-up row", exact: true })).toBeVisible();
  await warmup.getByRole("button", { name: "Warm-up row options" }).click();
  await page.getByRole("button", { name: "Delete exercise" }).click();
  await page.getByRole("button", { name: "Undo" }).last().click();
  await expect(warmup.getByRole("button", { name: "Warm-up row", exact: true })).toBeVisible();
});

test("set rows have no immediate delete control", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  await expect(page.locator(".set-row")).not.toHaveCount(0);
  await expect(page.locator(".set-row button[aria-label^='Delete']")).toHaveCount(0);
});

test("set type announcement stays available at 200% zoom", async ({ page }) => {
  // A 640px wide window at 200% browser zoom has a 320 CSS pixel viewport.
  await page.setViewportSize({ width: 320, height: 422 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  const status = page.locator(".set-row").first().getByRole("status", { includeHidden: true });
  expect(await status.evaluate((node) => getComputedStyle(node).display)).not.toBe("none");
  await page.locator(".set-row .set-badge").first().click();
  await expect(status).toHaveText("back-off");
  await checkWidth(page);
  const lastAction = page.locator(".section").last().getByRole("button", { name: "Add exercise", exact: true });
  await lastAction.scrollIntoViewIfNeeded();
  await expect(lastAction).toBeInViewport();
});

test("a custom exercise name appears when its catalog record arrives", async ({ page }) => {
  await mockApi(page);
  const customId = "e164c8eb-a785-4c78-a854-f7a9f0787215";
  await page.route("**/api/trpc/exercises.library", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: { data: {
      catalog: [{ id: customId, name: "Custom raise", section: null, aliases: "" }], stats: [], history: {},
    } } }) });
  });
  const custom = { ...doc, v: 3, sessions: [{ ...doc.sessions[0], warmup: [], cooldown: [], main: [
    { kind: "exercise", id: "custom", exerciseId: customId, comment: "", sets: [] },
  ] }] };
  await page.addInitScript(({ date, custom }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc: custom, base: null, dirty: false, rev: 1 }));
  }, { date: day, custom });
  await page.goto(`/#/d/${day}`);
  const name = page.locator(".exercise .name-btn");
  await expect(name).toHaveText(customId);
  await page.getByRole("button", { name: "Share day with PT / physio" }).click();
  const share = page.getByTestId("share-text");
  await expect(share).toContainText(customId);
  await expect(name).toHaveText("Custom raise");
  await expect(share).toContainText("Custom raise");
});

test("dragging an exercise creates a durable one-member superset and reorders its round", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 2400 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  const main = page.locator(".section").filter({ has: page.getByRole("heading", { name: "Main", exact: true }) });
  const handle = main.getByRole("button", { name: "Drag Squat" });
  const target = main.locator('[data-drop-key="superset:new"]');
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await expect(main.locator(".sr-only[role='status']")).toContainText("Drag to a labelled drop target");
  const to = await target.boundingBox();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
  await expect(target).toHaveClass(/drop-over/);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const colors = await target.evaluate((node) => ({ foreground: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
    expect(contrastRatio(rgb(colors.foreground), rgb(colors.background))).toBeGreaterThanOrEqual(4.5);
  }
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const block = main.locator(".block.superset");
  await expect(block).toHaveCount(1);
  await expect(block.locator(".exercise")).toHaveCount(1);
  const round = block.getByRole("button", { name: "Drag round W1" });
  const roundFrom = await round.boundingBox();
  await page.mouse.move(roundFrom!.x + roundFrom!.width / 2, roundFrom!.y + roundFrom!.height / 2);
  await page.mouse.down();
  const invalid = main.locator('[data-drop-key="superset:new"]');
  const invalidBox = await invalid.boundingBox();
  await page.mouse.move(invalidBox!.x + invalidBox!.width / 2, invalidBox!.y + invalidBox!.height / 2, { steps: 5 });
  await expect(invalid).not.toHaveClass(/drop-over/);
  const roundTarget = block.locator(".round-drop").last();
  const roundTo = await roundTarget.boundingBox();
  await page.mouse.move(roundTo!.x + roundTo!.width / 2, roundTo!.y + roundTo!.height / 2, { steps: 8 });
  await expect(roundTarget).toHaveClass(/drop-over/);
  const colors = await roundTarget.evaluate((node) => ({ foreground: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
  expect(contrastRatio(rgb(colors.foreground), rgb(colors.background))).toBeGreaterThanOrEqual(4.5);
  await page.mouse.up();
  await round.focus();
  await round.press("Enter");
  await expect(page.getByRole("dialog", { name: "Superset A" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(round).toBeFocused();
  const entry = await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!), day);
  const item = entry.doc.sessions[0].main[0];
  expect(item.kind).toBe("superset");
  expect(item.members).toHaveLength(1);
  expect(item.rounds.map((r: { type: string }) => r.type)).toEqual(["working", "backoff", "warmup"]);
  expect(item.results.find((r: { roundId: string }) => r.roundId === "set-1")).toMatchObject({ weight: 40, reps: 8 });
});

test("mismatched sets show an alignment preview before joining", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 2400 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  const main = page.locator(".section").filter({ has: page.getByRole("heading", { name: "Main", exact: true }) });
  await main.getByRole("button", { name: "Superset", exact: true }).click();
  const empty = main.locator(".block.superset");
  await empty.getByRole("button", { name: "Add exercise to superset" }).click();
  await page.getByRole("searchbox", { name: "Add to superset" }).fill("Row");
  await page.getByRole("searchbox", { name: "Add to superset" }).press("Enter");
  await empty.getByRole("button", { name: "Round", exact: true }).click();
  await empty.getByRole("button", { name: "Round", exact: true }).click();
  const handle = main.getByRole("button", { name: "Drag Squat" });
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  const target = empty.locator(".member-drop");
  const to = await target.boundingBox();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.up();
  const preview = page.getByRole("dialog", { name: "Align Squat with superset" });
  await expect(preview).toContainText("Superset rounds: warmup, warmup");
  await expect(preview).toContainText("40kg ×8");
  const before = await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!), day);
  expect(before.doc.sessions[0].main).toHaveLength(2);
  await preview.getByRole("button", { name: "Append sets as new rounds" }).click();
  const after = await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!), day);
  const superset = after.doc.sessions[0].main[0];
  expect(superset.members).toHaveLength(2);
  expect(superset.rounds).toHaveLength(5);
  expect(superset.results.find((result: { memberId: string; roundId: string }) => result.memberId === "exercise-1" && result.roundId === "set-1")).toMatchObject({ weight: 40, reps: 8 });
});

test("touch drag scrolls to the superset target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.addInitScript(({ date, doc }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc, base: null, dirty: false, rev: 1 }));
  }, { date: day, doc });
  await page.goto(`/#/d/${day}`);
  const main = page.locator(".section").filter({ has: page.getByRole("heading", { name: "Main", exact: true }) });
  const handle = main.getByRole("button", { name: "Drag Squat" });
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const x = from!.x + from!.width / 2;
  const y = from!.y + from!.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await expect(main.locator(".sr-only[role='status']")).toContainText("Drag to a labelled drop target");
  const target = main.locator('[data-drop-key="superset:new"]');
  const to = await target.boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to!.x + to!.width / 2, y: 825 }] });
  await expect(target).toBeInViewport();
  await expect(target).toHaveClass(/drop-over/);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(main.locator(".block.superset")).toHaveCount(1);
});

test("an offline v1 draft syncs as v5 and preserves its revision base", async ({ page }) => {
  await mockApi(page);
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/trpc/")) requests.push(request.url().split("/").at(-1)!); });
  const legacy = { ...doc, v: 1, sessions: [{ ...doc.sessions[0],
    warmup: [{ id: "legacy-warm", name: "Band pull-apart", reps: "2x15", comment: "" }],
    cooldown: [{ id: "legacy-cool", name: "Stretch", reps: "30s", comment: "" }],
  }] };
  await page.addInitScript(({ date, legacy }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc: legacy, base: "previous-revision", dirty: true, rev: 7 }));
  }, { date: day, legacy });
  const save = page.waitForRequest((request) => request.url().endsWith("/api/trpc/days.save"));
  await page.goto(`/#/d/${day}`);
  const request = await save;
  const payload = request.postDataJSON();
  const input = payload.json ?? payload;
  expect(input.base).toBe("previous-revision");
  expect(input.doc.v).toBe(5);
  expect(requests.indexOf("exercises.create")).toBeGreaterThanOrEqual(0);
  expect(requests.indexOf("exercises.create")).toBeLessThan(requests.indexOf("days.save"));
  expect(input.doc.sessions[0].warmup[0].sets.map((set: { reps: number }) => set.reps)).toEqual([15, 15]);
  await expect(page.getByText("Band pull-apart", { exact: true })).toBeVisible();
  const entry = await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!), day);
  expect(entry.rev).toBe(7);
  expect(entry.doc.v).toBe(5);
});

test("v1 conflict copies normalize before either version is chosen", async ({ page }) => {
  await mockApi(page);
  const legacy = { ...doc, v: 1, sessions: [{ ...doc.sessions[0],
    warmup: [{ id: "old-warm", name: "Band pull-apart", reps: "2x15", comment: "" }],
    cooldown: [{ id: "old-cool", name: "Stretch", reps: "30s", comment: "" }],
  }] };
  await page.addInitScript(({ date, legacy }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({
      doc: legacy, base: "old-revision", dirty: true, rev: 9,
      conflict: { doc: { ...legacy, morning: "Other device" }, updatedAt: "new-revision" },
    }));
  }, { date: day, legacy });
  await page.goto(`/#/d/${day}`);
  const before = await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!), day);
  expect([before.doc.v, before.conflict.doc.v, before.base, before.dirty, before.rev, before.conflict.updatedAt]).toEqual([4, 4, "old-revision", true, 9, "new-revision"]);
  await page.getByRole("button", { name: "Use other device's" }).click();
  const dialog = page.getByRole("dialog", { name: "Review day versions" });
  await expect(dialog).toContainText("Other device");
  await dialog.getByRole("button", { name: "Replace this device's edits" }).click();
  const after = await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!), day);
  expect([after.doc.v, after.doc.morning, after.base, after.dirty, after.rev]).toEqual([4, "Other device", "new-revision", false, 10]);
});

test("repeat keeps grouping and set types across every section without recorded values", async ({ page }) => {
  await mockApi(page);
  const previous = { ...doc, sessions: [{ ...doc.sessions[0], cooldown: [{ id: "cool", exercises: [{
    id: "cool-ex", name: "Stretch", comment: "done", sets: [{ id: "cool-set", type: "backoff", weight: 4, reps: 8 }],
  }] }] }] };
  await page.addInitScript(({ date, previous }) => {
    localStorage.setItem("tq:authed", JSON.stringify(true));
    localStorage.setItem(`tq:day:${date}`, JSON.stringify({ doc: previous, base: null, dirty: false, rev: 1 }));
  }, { date: day, previous });
  await page.goto(`/#/d/${day}`);
  await page.getByRole("button", { name: "Start another session" }).click();
  const session = page.locator(".session").last();
  for (const title of ["Warm-up", "Main", "Cool-down"]) {
    const section = session.locator(".section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await section.getByRole("button", { name: /Repeat earlier session/ }).click();
    await expect(section.locator(".exercise")).toHaveCount(1);
    const setRows = section.locator(".set-row");
    await expect(setRows).toHaveCount(title === "Main" ? 3 : title === "Warm-up" ? 2 : 1);
    for (const row of await setRows.all()) {
      await expect(row.getByRole("textbox").first()).toHaveValue("");
      await expect(row.getByRole("textbox").last()).toHaveValue("");
    }
  }
  const entry = await page.evaluate((date) => JSON.parse(localStorage.getItem(`tq:day:${date}`)!), day);
  const repeated = entry.doc.sessions[1];
  expect(repeated.warmup[0].sets.map((set: { type: string }) => set.type)).toEqual(["working", "working"]);
  expect(repeated.main[0].sets.map((set: { type: string }) => set.type)).toEqual(["warmup", "working", "backoff"]);
  expect(repeated.cooldown[0].sets[0].type).toBe("backoff");
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

    await page.getByRole("button", { name: "Add exercise", exact: true }).first().click();
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
