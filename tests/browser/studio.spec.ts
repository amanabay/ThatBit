import { CaptureStart } from "../../shared/contracts/capture.ts";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("review, save revision, approve, actual viewer playback, mobile, and unpublish", async ({
  page,
  context,
}) => {
  await page.goto("/");
  for (const path of [
    ".data/e2e/replylink.sqlite",
    "apps/server/src/main.ts",
    ".env.example",
  ]) {
    const response = await page.request.get(
      "/@fs/" + process.cwd() + "/" + path,
    );
    expect([403, 404]).toContain(response.status());
  }
  await expect(
    page.getByRole("heading", { name: "Good conversations deserve to stay." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review A little shader magic", exact: true })
    .click();
  await expect(page.getByLabel("Replay title")).toHaveValue(
    "A little shader magic",
  );
  await page.getByLabel("Start (seconds)").fill("1");
  await page.getByLabel("End (seconds)").fill("4");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("status")).toContainText("saved durably");
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await page.getByRole("button", { name: /Approve revision/ }).click();
  await page.getByRole("button", { name: /Published replies/ }).click();
  await expect(
    page.getByRole("link", { name: "Open replay" }).first(),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Publish to reader" }).first().click();
  await expect(
    page.getByRole("link", { name: "Open reader replay" }).first(),
  ).toBeVisible({ timeout: 20000 });
  const readerHref = await page
    .getByRole("link", { name: "Open reader replay" })
    .first()
    .getAttribute("href");
  const remote = await context.newPage();
  await remote.goto(readerHref ?? "/");
  await expect(
    remote.getByRole("heading", { name: "A little shader magic" }),
  ).toBeVisible();
  await remote.locator("video").evaluate(async (v) => {
    if (v instanceof HTMLVideoElement) await v.play();
  });
  await expect
    .poll(() =>
      remote
        .locator("video")
        .evaluate((v) => (v instanceof HTMLVideoElement ? v.currentTime : 0)),
    )
    .toBeGreaterThan(0);
  const href = await page
    .getByRole("link", { name: "Open replay" })
    .first()
    .getAttribute("href");
  const viewer = await context.newPage();
  await viewer.goto(href ?? "/");
  await expect(
    viewer.getByRole("heading", { name: "A little shader magic" }),
  ).toBeVisible();
  await expect(
    viewer.getByText("How did you make the water look transparent?"),
  ).toBeVisible();
  await viewer.locator("video").evaluate(async (v) => {
    if (v instanceof HTMLVideoElement) await v.play();
  });
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate((v) => (v instanceof HTMLVideoElement ? v.currentTime : 0)),
    )
    .toBeGreaterThan(0);
  await viewer.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await viewer.screenshot({
    path: "test-results/viewer-mobile.png",
    fullPage: true,
  });
  const results = await new AxeBuilder({ page: viewer }).analyze();
  expect(results.violations).toEqual([]);
  await viewer.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(viewer.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await viewer.reload();
  await expect(viewer.locator("html")).toHaveAttribute("data-theme", "light");
  expect((await new AxeBuilder({ page: viewer }).analyze()).violations).toEqual(
    [],
  );
  await viewer.screenshot({
    path: "test-results/viewer-light-mobile.png",
    fullPage: true,
  });
  await viewer.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.getByRole("button", { name: "Unpublish" }).first().click();
  await expect
    .poll(async () => {
      const r = await remote.request.get(
        (readerHref ?? "").replace("/r/", "/api/public/replies/"),
      );
      return r.status();
    })
    .toBe(410);
  await viewer.reload();
  await expect(
    viewer.getByRole("heading", { name: "This replay is unavailable." }),
  ).toBeVisible();
});

test("purple glass themes persist without losing draft edits and remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("GENERATED SAMPLE").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/theme-dark-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("GENERATED SAMPLE").first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/theme-light-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review One more time, slowly", exact: true })
    .click();
  await page
    .getByLabel("Replay title")
    .fill("Theme change keeps my unsaved work");
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Unsaved changes",
  );
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.getByLabel("Replay title")).toHaveValue(
    "Theme change keeps my unsaved work",
  );
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Unsaved changes",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/theme-dark-editor.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/theme-dark-mobile-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/theme-light-mobile-editor.png",
    fullPage: true,
  });
});

test("glass setup dialog remains readable in light and dark mode on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Switch to light mode" })
    .press("Enter");
  await page.getByRole("button", { name: "Sources & setup" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/theme-light-setup.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close setup" }).click();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.getByRole("button", { name: "Sources & setup" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/theme-dark-setup.png",
    fullPage: true,
  });
});
test("desktop, mobile, keyboard and sample labels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("GENERATED SAMPLE").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/studio-desktop.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/studio-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sources & setup" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close setup" }).press("Enter");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("real browser MediaRecorder chunks produce a saved exchange and recover after reload (generated fixture)", async ({
  page,
}) => {
  await page.route("**/api/creator/captures", async (route) => {
    const body = CaptureStart.parse(route.request().postDataJSON());
    await route.continue({
      postData: JSON.stringify({ ...body, fixture: true }),
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const drawing = canvas.getContext("2d");
        const stream = canvas.captureStream(15);
        const audio = new AudioContext();
        const sine = audio.createOscillator();
        const destination = audio.createMediaStreamDestination();
        sine.frequency.value = 440;
        sine.connect(destination);
        sine.start();
        for (const track of destination.stream.getAudioTracks())
          stream.addTrack(track);
        const timer = setInterval(() => {
          if (drawing) {
            drawing.fillStyle = "#244f3c";
            drawing.fillRect(0, 0, 640, 360);
            drawing.fillStyle = "white";
            drawing.font = "24px sans-serif";
            drawing.fillText("GENERATED CAPTURE FIXTURE", 30, 80);
            drawing.fillText(String(performance.now()), 30, 140);
          }
        }, 60);
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          clearInterval(timer);
          void audio.close();
        });
        return stream;
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Capture an exchange" }).click();
  await page.getByRole("button", { name: "Choose screen or tab" }).click();
  await expect(page.getByText(/Recording ·.*chunks saved to disk/)).toBeVisible(
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "Save that exchange" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Private exchange saved",
    { timeout: 20000 },
  );
  await expect(
    page.getByText(
      "Labelled sample: generated test pattern and tone. No actual spoken answer.",
    ),
  ).toBeVisible();
  await page.locator(".video-box video").evaluate(async (v) => {
    if (v instanceof HTMLVideoElement) await v.play();
  });
  await expect
    .poll(() =>
      page
        .locator(".video-box video")
        .evaluate((v) => (v instanceof HTMLVideoElement ? v.currentTime : 0)),
    )
    .toBeGreaterThan(0);
  await page.locator(".video-box video").evaluate((v) => {
    if (v instanceof HTMLVideoElement) v.pause();
  });
  await page.screenshot({
    path: "test-results/capture-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Stop & save recording" }).click();
  await expect(page.getByRole("status")).toContainText("Recording finalized", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: "Capture an exchange" }).click();
  await page.getByRole("button", { name: "Choose screen or tab" }).click();
  await expect(page.getByText(/Recording ·.*chunks saved to disk/)).toBeVisible(
    { timeout: 15000 },
  );
  await page.reload();
  await page.getByRole("button", { name: "Sources & setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Interrupted recording" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/capture-recovery.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Recover recording" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Acknowledged footage recovered",
    { timeout: 20000 },
  );
  await page.getByRole("button", { name: "Close setup" }).click();
});

test("transcription bounds padded sentence timing and supports saved captions and approved playback (provider fixture)", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Review A very important duck", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Transcribe selected interval locally" })
    .click();
  await expect(
    page.getByText("Local transcript ready. Verify against actual footage."),
  ).toBeVisible({ timeout: 15000 });
  await page.screenshot({
    path: "test-results/transcript-review.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Review A very important duck", exact: true })
    .click();
  const sentence = page.getByRole("button", {
    name: /0:02 · Final sentence with padded timing/,
  });
  await expect(sentence).toBeVisible();
  await sentence.click();
  await expect(page.getByLabel("Start (seconds)")).toHaveValue("2");
  await expect(page.getByLabel("End (seconds)")).toHaveValue("7");
  await expect(
    page.getByLabel("Captions (relative start | end | text, one per line)"),
  ).toHaveValue(/provider fixture/);
  await expect(sentence).toBeDisabled();
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("status")).toContainText("saved durably");
  await expect(
    page.getByLabel("Captions (relative start | end | text, one per line)"),
  ).toHaveValue(/provider fixture/);
  await page.getByRole("button", { name: /Approve revision/ }).click();
  await page.getByRole("button", { name: /Published replies/ }).click();
  const link = page.getByRole("link", { name: /^Open replay/ }).first();
  await expect(link).toBeVisible({ timeout: 20000 });
  const href = await link.getAttribute("href");
  const viewer = await context.newPage();
  await viewer.goto(href ?? "/");
  await expect(
    viewer.getByRole("heading", { name: "A very important duck" }),
  ).toBeVisible();
  const captions = await viewer.request.get(
    (href ?? "").replace("/r/", "/api/public/replies/") + "/captions",
  );
  expect(await captions.text()).toContain("00:00:05.000");
  await viewer.locator("video").evaluate(async (v) => {
    if (v instanceof HTMLVideoElement) await v.play();
  });
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate((v) => (v instanceof HTMLVideoElement ? v.currentTime : 0)),
    )
    .toBeGreaterThan(0);
});

test("caption input preserves incomplete text and prevents saving it silently", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Review One more time, slowly", exact: true })
    .click();
  const captions = page.getByLabel(
    "Captions (relative start | end | text, one per line)",
  );
  await captions.fill("0 |");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Finish each caption line",
  );
  await expect(captions).toHaveValue("0 |");
  await captions.fill("");
  await captions.pressSequentially(
    "0 | 1 | First caption\n1 | 2 | Second caption",
  );
  await expect(captions).toHaveValue(
    "0 | 1 | First caption\n1 | 2 | Second caption",
  );
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("status")).toContainText("saved durably");
});

test("save OBS exchange joins contiguous labelled fixture segments into a durable complete review", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Save OBS exchange", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("across 2 segment(s)", {
    timeout: 20000,
  });
  await expect(page.getByLabel("End (seconds)")).toHaveValue(/24/);
  await expect(
    page.getByText(
      "Labelled sample: generated test pattern and tone. No actual spoken answer.",
    ),
  ).toBeVisible();
  const source = await page.locator(".video-box video").getAttribute("src");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("status")).toContainText("saved durably");
  await page.screenshot({
    path: "test-results/obs-review.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Review A reply worth keeping", exact: true })
    .last()
    .click();
  await expect(page.locator(".video-box video")).toHaveAttribute(
    "src",
    source ?? "",
  );
  await expect(page.getByLabel("End (seconds)")).toHaveValue(/24/);
});

test("private draft save marker distinguishes failures, in-flight edits and durable success", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ New exchange", exact: true })
    .click();
  const title = page.getByLabel("Replay title");
  const marker = page.getByTestId("draft-save-state");
  await expect(marker).toContainText("Saved privately");
  await title.fill("Save marker before delayed request");
  await expect(marker).toContainText("Unsaved changes");
  await expect(
    page.getByRole("button", { name: "Transcribe selected interval locally" }),
  ).toBeDisabled();
  await page.route(
    "**/api/creator/drafts/*",
    async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Temporary save failure (test fixture).",
        }),
      });
    },
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(marker).toContainText("Draft not saved");
  await expect(title).toHaveValue("Save marker before delayed request");
  let release = () => {},
    announce = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    announce = resolve;
  });
  await page.route(
    "**/api/creator/drafts/*",
    async (route) => {
      announce();
      await held;
      await route.continue();
    },
    { times: 1 },
  );
  try {
    await page
      .getByRole("button", { name: "Save private draft", exact: true })
      .click();
    await started;
    await expect(marker).toContainText("Saving your private draft");
    await title.fill("A newer edit made during save");
    release();
    await expect(marker).toContainText("Unsaved changes");
    await expect(title).toHaveValue("A newer edit made during save");
    await expect(
      page.getByRole("button", { name: /Approve revision/ }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Save private draft", exact: true })
      .click();
    await expect(marker).toContainText("Saved privately");
    await expect(marker).toContainText("Revision 3");
    await expect(
      page.getByRole("button", {
        name: "Transcribe selected interval locally",
      }),
    ).toBeEnabled();
    await page.screenshot({
      path: "test-results/draft-saved-desktop.png",
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("button", {
        name: "Review A newer edit made during save",
        exact: true,
      })
      .click();
    await expect(marker).toContainText("Saved privately");
    await expect(marker).toContainText("Revision 3");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: "test-results/draft-saved-mobile.png",
      fullPage: true,
    });
  } finally {
    release();
  }
});
