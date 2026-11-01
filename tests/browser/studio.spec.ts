import { CaptureStart } from "../../shared/contracts/capture.ts";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
test("reader home and index show a public landing page without requesting creator APIs", async ({
  page,
}) => {
  const creatorRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/creator/"))
      creatorRequests.push(request.method());
  });
  page.on("pageerror", (error) => errors.push(error.name));
  for (const path of ["/", "/index.html", "/unknown-page"]) {
    await page.goto("http://localhost:4321" + path);
    await expect(
      page.getByRole("heading", { name: "Open a replay link." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "+ New exchange", exact: true }),
    ).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/reader-home-mobile.png",
    fullPage: true,
  });
  expect(creatorRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("browser runtime diagnostics send only fixed categories to the authenticated local logger", async ({
  page,
}) => {
  const socketPayloads: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) =>
      socketPayloads.push(String(frame.payload)),
    ),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "+ New exchange", exact: true }),
  ).toBeVisible();
  for (const kind of ["error", "unhandledrejection"]) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/creator/diagnostics") &&
        r.request().method() === "POST",
    );
    await page.evaluate((kind) => {
      if (kind === "error")
        window.dispatchEvent(
          new ErrorEvent("error", {
            message: "PRIVATE_BROWSER_ERROR",
            filename: "file:///PRIVATE_RECORDING",
            error: new Error("PRIVATE_TRANSCRIPT"),
          }),
        );
      else
        window.dispatchEvent(
          new PromiseRejectionEvent("unhandledrejection", {
            promise: Promise.resolve(),
            reason: "PRIVATE_REJECTION",
          }),
        );
    }, kind);
    const report = await response;
    expect(report.status()).toBe(204);
    expect(report.request().postDataJSON()).toEqual({
      kind: kind === "error" ? "runtime_error" : "unhandled_rejection",
    });
    expect(report.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  }
  expect(socketPayloads.join("\n")).not.toContain("PRIVATE_");
});

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
  await page.getByRole("button", { name: "← All exchanges" }).click();
  await expect(
    page.getByRole("region", { name: "Render notification" }),
  ).toContainText("Replay rendered", { timeout: 30000 });
  await page
    .getByRole("button", { name: "Review A little shader magic", exact: true })
    .click();
  await expect(page.getByTestId("render-state")).toContainText("Replay ready");
  await expect(page.getByRole("status")).not.toContainText(
    "Rendering a separate replay",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Review A little shader magic", exact: true })
    .click();
  await expect(page.getByTestId("render-state")).toContainText("Replay ready");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByTestId("render-state")
    .screenshot({ path: "test-results/render-ready-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
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
  await expect(remote.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "A little shader magic",
  );
  const replayApi = (readerHref ?? "").replace("/r/", "/api/public/replies/");
  for (const response of [
    { status: 200, body: "", contentType: "application/json" },
    {
      status: 502,
      body: "<html>PRIVATE_PROXY_ERROR</html>",
      contentType: "text/html",
    },
  ]) {
    let recovered = false;
    await remote.route(replayApi, (route) =>
      recovered ? route.continue() : route.fulfill(response),
    );
    await remote.reload();
    await expect(
      remote.getByRole("heading", { name: "Couldn’t load this replay." }),
    ).toBeVisible();
    await expect(
      remote.getByRole("heading", { name: "This replay is unavailable." }),
    ).toHaveCount(0);
    recovered = true;
    await remote
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await expect(
      remote.getByRole("heading", { name: "A little shader magic" }),
    ).toBeVisible();
    await remote.unroute(replayApi);
  }
  const previewHref = await page
    .getByRole("link", { name: "Open share preview" })
    .first()
    .getAttribute("href");
  const preview = await remote.request.get(previewHref ?? "/");
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toContain("image/png");
  await writeFile("test-results/share-preview.png", await preview.body());
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
  expect((await remote.request.get(previewHref ?? "/")).status()).toBe(410);
  const removedHtml = await remote.request.get(readerHref ?? "/");
  expect(await removedHtml.text()).not.toContain('property="og:image"');
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

test("video-only browser window capture explains the missing audio without adding a microphone or starting a recording", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let shared: MediaStream;
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        shared = document.createElement("canvas").captureStream(10);
        Object.defineProperty(window, "fixtureSharedStream", { value: shared });
        return shared;
      },
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new Error("Microphone must not be requested");
      },
    });
  });
  const captureRequests: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/creator/captures" &&
      request.method() === "POST"
    )
      captureRequests.push(request.method());
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Setup/ }).click();
  await page.getByRole("button", { name: "Choose screen or tab" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Browser window sharing may be video-only on Linux",
  );
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "fixtureSharedStream")
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === "ended"),
    ),
  ).toBe(true);
  expect(captureRequests).toEqual([]);
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
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
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
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  const sentence = page.getByRole("button", {
    name: /^Select sentence 2:/,
  });
  await expect(sentence).toBeVisible();
  await sentence.click();
  await page
    .getByRole("button", {
      name: "Use selected sentences for reply",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Start (seconds)")).toHaveValue("2");
  await expect(page.getByLabel("End (seconds)")).toHaveValue("7");
  await expect(
    page.getByLabel("Captions (relative start | end | text, one per line)"),
  ).toHaveValue(/provider fixture/);
  await expect(sentence).toBeEnabled();
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

test("empty transcript and silent audio show recovery guidance without claiming captions are ready (response fixture)", async ({
  page,
}) => {
  let silent = false;
  let transcriptAssetId = "fixture";
  await page.route("**/api/creator/analysis/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    return route.fulfill({
      json: {
        job: silent
          ? {
              id,
              revisionId: id,
              draftId: "fixture",
              state: "failed",
              generation: 1,
              attempts: 1,
              nextAttempt: 0,
              leaseUntil: 0,
              createdAt: "2026-10-30",
              error:
                "The selected interval contains silent audio. Check the OBS microphone mute, device and recording-track routing, record a new clip, then transcribe it. Existing silent footage cannot supply captions.",
              provider: "fixture",
              model: "fixture",
              transcriptId: null,
            }
          : null,
        transcript: silent
          ? null
          : {
              id: "empty-fixture",
              sourceRevisionId: id,
              assetId: transcriptAssetId,
              provider: "fixture",
              model: "fixture",
              createdAt: "2026-10-30",
              start: 0,
              end: 7,
              segments: [],
            },
        stale: false,
        suggestions: [],
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "Review A very important duck",
      exact: true,
    }),
  ).toBeVisible();
  const fixtureState = await (
    await page.request.get("/api/creator/state")
  ).json();
  transcriptAssetId = fixtureState.drafts.find(
    (r: { title: string }) => r.title === "A very important duck",
  ).assetId;
  await page
    .getByRole("button", { name: "Review A very important duck", exact: true })
    .click();
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  const section = page.getByRole("region", { name: "Transcript assistance" });
  await expect(section).toContainText(
    "No speech was detected; captions were not generated.",
  );
  await expect(
    section.getByRole("button", {
      name: "Use transcript within reply as captions",
    }),
  ).toHaveCount(0);
  await expect(section).not.toContainText("Local transcript ready");
  silent = true;
  await expect(section).toContainText(
    "The selected interval contains silent audio.",
  );
  await expect(
    section.getByRole("button", { name: "Retry local transcription" }),
  ).toBeVisible();
});

test("caption input preserves incomplete text and prevents saving it silently", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Review One more time, slowly", exact: true })
    .click();
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page.getByText("Advanced caption text", { exact: true }).click();
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

test("full transcript becomes editable timed captions without changing the reply and trimming preserves source timing", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ New exchange", exact: true })
    .click();
  await page.getByLabel("Replay title").fill("Full interval captions");
  await page
    .getByRole("combobox", { name: "Recording", exact: true })
    .selectOption({ index: 0 });
  await page.getByLabel("Start (seconds)").fill("0");
  await page.getByLabel("End (seconds)").fill("10");
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page
    .getByRole("button", { name: "Transcribe selected interval locally" })
    .click();
  const apply = page.getByRole("button", {
    name: "Use transcript within reply as captions",
    exact: true,
  });
  await expect(apply).toBeEnabled({ timeout: 20000 });
  await apply.click();
  await expect(page.getByLabel("Start (seconds)")).toHaveValue("0");
  await expect(page.getByLabel("End (seconds)")).toHaveValue("10");
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    /Kai/,
  );
  await page
    .getByLabel("Caption 1 text", { exact: true })
    .fill("First corrected words");
  await page.getByLabel("Caption 2 text", { exact: true }).fill("");
  await page
    .getByLabel("Caption 2 text", { exact: true })
    .pressSequentially("Second corrected sentence");
  await expect(page.getByLabel("Caption 2 text", { exact: true })).toHaveValue(
    "Second corrected sentence",
  );
  await expect
    .poll(() =>
      page.locator(".editor video").evaluate((video: HTMLVideoElement) => {
        const track = Array.from(video.textTracks).find(
          (t) => t.label === "Draft caption preview",
        );
        const cue = track?.cues?.[0];
        return cue instanceof VTTCue ? cue.text : undefined;
      }),
    )
    .toBe("First corrected words");
  await page.locator(".editor video").evaluate((video: HTMLVideoElement) => {
    video.currentTime = 0.5;
    video.pause();
  });
  await expect
    .poll(() =>
      page.locator(".editor video").evaluate((video: HTMLVideoElement) => {
        const track = Array.from(video.textTracks).find(
          (t) => t.label === "Draft caption preview",
        );
        const cue = track?.activeCues?.[0];
        return track?.mode === "showing" && cue instanceof VTTCue
          ? cue.text
          : undefined;
      }),
    )
    .toBe("First corrected words");
  await page
    .locator(".video-box")
    .screenshot({ path: "test-results/private-caption-preview-desktop.png" });

  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Review Full interval captions", exact: true })
    .click();
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    "First corrected words",
  );
  await page.getByLabel("Start (seconds)").fill("0.5");
  await expect(page.getByLabel("Caption 1 start", { exact: true })).toHaveValue(
    "-0.5",
  );
  await expect(page.getByLabel("Caption 2 start", { exact: true })).toHaveValue(
    "0.5",
  );
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Draft not saved",
  );
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove caption 1", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator(".editor video").evaluate((video: HTMLVideoElement) => {
        const track = Array.from(video.textTracks).find(
          (t) => t.label === "Draft caption preview",
        );
        const cue = track?.cues?.[0];
        return cue instanceof VTTCue ? cue.startTime : -1;
      }),
    )
    .toBe(1);

  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    "Second corrected sentence",
  );
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/caption-editor-mobile.png",
    fullPage: true,
  });
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
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
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

test("chat inbox selects an original message and recording, protects unsaved edits and fits mobile", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Received chat/ }).click();
  const inbox = page.getByRole("region", { name: "Received chat inbox" });
  await inbox
    .getByRole("combobox", { name: "Message source", exact: true })
    .selectOption("fixture");
  await inbox.getByLabel("Search messages", { exact: true }).fill("duck");
  await expect(
    inbox.getByText("Fixture · not live chat", { exact: true }).first(),
  ).toBeVisible();
  const select = inbox.getByRole("combobox", {
    name: "Recording for this exchange",
    exact: true,
  });
  const choose = inbox
    .getByRole("button", { name: /^Choose recording/ })
    .first();
  await expect(choose).toBeEnabled();
  expect(
    await choose.evaluate((button) => getComputedStyle(button).cursor),
  ).toBe("pointer");
  await choose.click();
  await expect(select).toBeFocused();
  await select.selectOption({ index: 1 });
  const connect = inbox
    .getByRole("button", { name: /^Connect response/ })
    .first();
  await connect.click();
  await expect(page.getByLabel("Replay title", { exact: true })).toBeVisible();
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Keep my unsaved title");
  await page.getByRole("button", { name: /Received chat/ }).click();
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Keep my unsaved title",
  );
  await expect(page.getByRole("status")).toContainText(
    "Revert unsaved changes",
  );
  await page
    .getByRole("button", { name: "Revert unsaved changes", exact: true })
    .click();
  await page.getByRole("button", { name: /Received chat/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(inbox).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/chat-inbox-mobile.png",
    fullPage: true,
  });
});

test("offline polling is visible, reconnect preserves editor text, and read-only audio checks show muted inputs", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Review A very important duck", exact: true })
    .click();
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Unsaved while offline");
  await page.route("**/api/creator/state", (route) => route.abort());
  await expect(
    page.getByRole("alert").filter({ hasText: "Studio offline" }),
  ).toBeVisible({ timeout: 8000 });
  await expect(
    page.getByRole("button", {
      name: /(?:^Approve revision|^Revision \d+ approved)/,
    }),
  ).toBeDisabled();
  await page.unroute("**/api/creator/state");
  await page
    .getByRole("button", { name: "Reconnect studio", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Studio offline" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Unsaved while offline",
  );
  await page.route("**/api/creator/obs/inspect", (route) =>
    route.fulfill({
      json: {
        version: "32.1.1",
        splitSupported: true,
        recording: false,
        paused: false,
        durationMs: 0,
        inputKinds: [],
        visibleSourceKinds: [],
        windowCaptureAvailable: false,
        audioInputs: [
          {
            kind: "pulse_input_capture",
            muted: true,
            volumeMul: 1,
            enabledTracks: [1],
          },
        ],
      },
    }),
  );
  await page
    .getByText("Capture tools & saved footage", { exact: true })
    .click();
  const readiness = page.getByRole("region", { name: "Capture readiness" });
  await readiness.locator("summary").click();
  await readiness
    .getByRole("button", { name: "Check OBS audio & routing", exact: true })
    .click();
  await expect(readiness).toContainText("All audio inputs are muted");
  await expect(readiness).toContainText("Read-only snapshot");
  await page
    .getByRole("button", { name: "Revert unsaved changes", exact: true })
    .click();
});

test("private quality notes survive reload, stay on the saved revision and export separately from publishing", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Review A very important duck", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  const notes = page.locator(".review-notes");
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  await notes.locator("summary").click();
  await notes
    .getByRole("combobox", { name: "Message connection", exact: true })
    .selectOption("correct");
  await notes
    .getByRole("combobox", { name: "Response boundaries", exact: true })
    .selectOption("complete");
  await notes
    .getByLabel("Private review notes", { exact: true })
    .fill(
      "Labelled fixture review for offline evaluation; not a human acceptance result.",
    );
  await notes
    .getByRole("button", { name: "Save private quality note", exact: true })
    .click();
  await expect(notes).toContainText("Private review saved for this revision.");
  await page.reload();
  await page
    .getByRole("button", { name: "Review A very important duck", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  await notes.locator("summary").click();
  await expect(
    notes.getByLabel("Private review notes", { exact: true }),
  ).toHaveValue(/Labelled fixture review/);
  const exported = await page.request.get("/api/creator/reviews/export");
  expect(exported.ok()).toBe(true);
  expect((await exported.json()).summary.reviewedRevisions).toBeGreaterThan(0);
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Unsaved quality review edit");
  await expect(
    notes.getByRole("button", {
      name: "Save private quality note",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Revert unsaved changes", exact: true })
    .click();
});

test("visual timeline edits remain private and approved replay transcript seeks the derived media", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Review A very important duck", exact: true })
    .click();
  const timeline = page.getByRole("region", { name: "Response timeline" });
  await expect(timeline).toBeVisible();
  await timeline
    .getByRole("slider", { name: "Timeline start", exact: true })
    .focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Unsaved changes",
  );
  await page
    .getByRole("button", { name: "Revert unsaved changes", exact: true })
    .click();
  await timeline
    .getByRole("button", { name: "Zoom to selection", exact: true })
    .click();
  await expect(
    timeline.getByRole("button", { name: "Show full recording", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Transcribe selected interval locally",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Local transcript ready. Verify against actual footage.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", {
      name: "Use transcript within reply as captions",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await page.getByRole("button", { name: /^Approve revision/ }).click();
  await page.getByRole("button", { name: /Published replies/ }).click();
  const href = await page
    .getByRole("link", { name: "Open replay ↗", exact: true })
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();
  const viewer = await context.newPage();
  await viewer.goto(href ?? "/");
  await viewer
    .getByText("Read the approved transcript", { exact: true })
    .click();
  const sentence = viewer.locator(".approved-transcript button").first();
  await expect(sentence).toBeVisible();
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate(
          (v) => v instanceof HTMLVideoElement && Number.isFinite(v.duration),
        ),
    )
    .toBe(true);
  await viewer.locator("video").evaluate((v) => {
    if (v instanceof HTMLVideoElement)
      v.currentTime = Math.min(1, v.duration / 2);
  });
  await sentence.click();
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate((v) => (v instanceof HTMLVideoElement ? v.currentTime : -1)),
    )
    .toBeCloseTo(0, 1);
  expect((await new AxeBuilder({ page: viewer }).analyze()).violations).toEqual(
    [],
  );
});

test("original proposal assessments survive caption corrections and export separately on mobile", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Review Original evidence fixture",
      exact: true,
    })
    .click();
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  const evidence = page.getByRole("region", {
    name: "Original suggestion evidence",
  });
  await expect(
    evidence
      .getByText("Authored ASR fixture, not actual speech.", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(evidence).toContainText("edge of available footage");
  await page.getByRole("tab", { name: "Response", exact: true }).click();
  await page.getByLabel("End (seconds)", { exact: true }).fill("2.5");
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  await evidence
    .getByRole("button", { name: /Play original proposed range/ })
    .click();
  await page.locator(".editor video").evaluate((video: HTMLVideoElement) => {
    video.muted = true;
    video.currentTime = 4;
  });
  await expect
    .poll(() =>
      page
        .locator(".editor video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(4.1);
  await page
    .locator(".editor video")
    .evaluate((video: HTMLVideoElement) => video.pause());
  await page.getByRole("tab", { name: "Response", exact: true }).click();
  await page
    .getByRole("button", { name: "▶ Preview selection", exact: true })
    .click();
  await page.locator(".editor video").evaluate((video: HTMLVideoElement) => {
    video.currentTime = 2.7;
  });
  await expect
    .poll(() =>
      page
        .locator(".editor video")
        .evaluate((video: HTMLVideoElement) => video.paused),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Revert unsaved changes", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  await evidence
    .getByText("Assess the original suggestion", { exact: true })
    .click();
  await evidence
    .getByLabel("Original message connection", { exact: true })
    .selectOption("correct");
  await evidence
    .getByLabel("Original response boundaries", { exact: true })
    .selectOption("cut-off");
  await evidence
    .getByLabel("Original transcript quality", { exact: true })
    .selectOption("needs-correction");
  await evidence
    .getByLabel("Time spent correcting", { exact: true })
    .fill("15");
  await evidence
    .getByLabel("Original proposal notes", { exact: true })
    .fill("Authored UI fixture; not independent human evidence.");
  await evidence
    .getByRole("button", { name: "Save original assessment", exact: true })
    .click();
  await expect(evidence).toContainText(
    "Original proposal assessment saved privately.",
  );
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page
    .getByLabel("Caption 1 text", { exact: true })
    .fill("Corrected caption fixture.");
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  await expect(evidence.locator("blockquote")).toHaveText(
    "Authored ASR fixture, not actual speech.",
  );
  await page.reload();
  await page
    .getByRole("button", {
      name: "Review Original evidence fixture",
      exact: true,
    })
    .click();
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  await evidence
    .getByText("Assess the original suggestion", { exact: true })
    .click();
  await expect(
    evidence.getByLabel("Original response boundaries", { exact: true }),
  ).toHaveValue("cut-off");
  await expect(
    evidence.getByLabel("Time spent correcting", { exact: true }),
  ).toHaveValue("15");
  const exported = await page.request.get(
    "/api/creator/proposal-reviews/export",
  );
  expect(exported.ok()).toBe(true);
  const data = await exported.json();
  expect(data.examples[0].transcript.segments[0].text).toBe(
    "Authored ASR fixture, not actual speech.",
  );
  expect(data.examples[0].review.transcript).toBe("needs-correction");
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/original-assessment-mobile.png",
    fullPage: true,
  });
});

test("server-paged inbox connects an older message beyond the studio recent window", async ({
  page,
}) => {
  await page.goto("/");
  const { token } = await (
    await page.request.get("/api/creator/session")
  ).json();
  for (let i = 0; i < 55; i++) {
    const result = await page.request.post("/api/creator/messages", {
      headers: { "x-creator-token": token },
      data: {
        author: "PaginationFixture",
        text: "Pagination fixture message " + i,
      },
    });
    expect(result.ok()).toBe(true);
  }
  await page.getByRole("button", { name: /Received chat/ }).click();
  const inbox = page.getByRole("region", { name: "Received chat inbox" });
  await inbox
    .getByLabel("Search messages", { exact: true })
    .fill("Pagination fixture");
  await expect(
    inbox.getByText("55 matching messages", { exact: true }),
  ).toBeVisible();
  await expect(inbox.locator(".inbox-message")).toHaveCount(50);
  await inbox
    .getByRole("button", { name: "Older messages", exact: true })
    .click();
  await expect(inbox.locator(".inbox-message")).toHaveCount(5);
  await expect(
    inbox.getByText("Pagination fixture message 0", { exact: true }),
  ).toBeVisible();
  await inbox
    .getByRole("combobox", { name: "Recording for this exchange", exact: true })
    .selectOption({ index: 1 });
  await inbox
    .getByRole("button", {
      name: "Connect response ↗ for PaginationFixture: Pagination fixture message 0",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Replay title", { exact: true })).toBeVisible();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await expect(
    page.getByText("Pagination fixture message 0", { exact: true }).first(),
  ).toBeVisible();
});

test("focused review tools preserve incomplete captions, protect exchange navigation and keep mobile actions accessible", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ New exchange", exact: true })
    .click();
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Focused review fixture");
  const response = page.getByRole("tab", { name: "Response", exact: true });
  const captions = page.getByRole("tab", { name: "Captions", exact: true });
  const evidence = page.getByRole("tab", {
    name: "Evidence & notes",
    exact: true,
  });
  await expect(response).toHaveAttribute("aria-selected", "true");
  await response.focus();
  await page.keyboard.press("ArrowRight");
  await expect(captions).toBeFocused();
  await expect(captions).toHaveAttribute("aria-selected", "true");
  await page.getByText("Advanced caption text", { exact: true }).click();
  const text = page.getByLabel(
    "Captions (relative start | end | text, one per line)",
  );
  await text.fill("0 |");
  await captions.focus();
  await page.keyboard.press("End");
  await expect(evidence).toBeFocused();
  await expect(evidence).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".editor video")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(response).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Response timeline" }),
  ).toBeVisible();
  await captions.click();
  await expect(text).toHaveValue("0 |");
  await page
    .getByRole("button", { name: "← Previous exchange", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Revert unsaved changes",
  );
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Focused review fixture",
  );
  await text.fill("0 | 1 | Authored caption fixture.");
  const dock = page.getByRole("region", {
    name: "Review actions",
    exact: true,
  });
  await dock.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByTestId("review-dock-state")).toContainText(
    /Revision \d+ saved/,
  );
  await page
    .getByRole("button", { name: "← Previous exchange", exact: true })
    .click();
  await expect(
    page.getByLabel("Replay title", { exact: true }),
  ).not.toHaveValue("Focused review fixture");
  await page
    .getByRole("button", { name: "Next exchange →", exact: true })
    .click();
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Focused review fixture",
  );
  await expect(response).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    path: "test-results/focused-review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await dock
    .getByRole("button", { name: "Review approval", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Publication approval", exact: true }),
  ).toBeFocused();
  const state = await (await page.request.get("/api/creator/state")).json();
  const draft = state.drafts.find(
    (r: { title: string }) => r.title === "Focused review fixture",
  );
  expect(draft).toBeTruthy();
  expect(
    state.publications.some(
      (p: { revisionId: string }) => p.revisionId === draft.id,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/focused-review-mobile.png",
    fullPage: true,
  });
});

test("message correction searches beyond recent chat, refreshes removed-state fixtures and preserves unfinished captions", async ({
  page,
}) => {
  await page.goto("/");
  const { token } = await (
    await page.request.get("/api/creator/session")
  ).json();
  let originalId = "";
  for (let i = 0; i < 56; i++) {
    const response = await page.request.post("/api/creator/messages", {
      headers: { "x-creator-token": token },
      data: {
        author: "CorrectionFixture",
        text: "Correction fixture message " + i,
      },
    });
    expect(response.ok()).toBe(true);
    if (i === 0) originalId = (await response.json()).id;
  }
  expect(originalId).toBeTruthy();
  await page
    .getByRole("button", { name: "+ New exchange", exact: true })
    .click();
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Correct an older original");
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page.getByText("Advanced caption text", { exact: true }).click();
  const captionText = page.getByLabel(
    "Captions (relative start | end | text, one per line)",
  );
  await captionText.fill("0 |");
  await page
    .getByText("Find another original message", { exact: true })
    .click();
  await page
    .getByLabel("Find a viewer or message", { exact: true })
    .fill("Correction fixture");
  const search = page.locator(".message-search");
  await expect(search).toContainText("56 available messages match.");
  await search
    .getByRole("button", { name: "Older matches", exact: true })
    .click();
  await expect(search.locator(".message-search-results button")).toHaveCount(
    20,
  );
  await expect(
    search.getByText("Correction fixture message 35", { exact: true }),
  ).toBeVisible();
  await search
    .getByRole("button", { name: "Older matches", exact: true })
    .click();
  await expect(search.locator(".message-search-results button")).toHaveCount(
    16,
  );
  const refreshed = page.waitForResponse((r) =>
    r.url().endsWith("/api/creator/messages/" + originalId),
  );
  await search
    .getByRole("button", { name: /Correction fixture message 0 / })
    .click();
  await expect(page.locator(".review-panel blockquote")).toContainText(
    "Correction fixture message 0",
  );
  expect((await refreshed).ok()).toBe(true);
  await expect(captionText).toHaveValue("0 |");
  await page.route("**/api/creator/messages/" + originalId, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      json: { message: { ...body.message, removed: true } },
    });
  });
  await expect(
    page.getByText("This original message was removed.", { exact: false }),
  ).toBeVisible({ timeout: 12000 });
  await expect(
    page.getByRole("button", { name: /^Approve revision/ }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Connect a different message", { exact: true }),
  ).toHaveValue(originalId);
  await page.unroute("**/api/creator/messages/" + originalId);
  await expect(
    page.getByText("This original message was removed.", { exact: false }),
  ).toHaveCount(0, { timeout: 12000 });
  await expect(captionText).toHaveValue("0 |");
  await captionText.fill("0 | 1 | Correction fixture caption.");
  let releaseState = () => {},
    announceState = () => {};
  const heldState = new Promise<void>((resolve) => {
    releaseState = resolve;
  });
  const stateStarted = new Promise<void>((resolve) => {
    announceState = resolve;
  });
  await page.route(
    "**/api/creator/state",
    async (route) => {
      const snapshot = await (await route.fetch()).json();
      announceState();
      await heldState;
      await route.fulfill({
        json: snapshot,
        headers: { "x-stale-review-fixture": "true" },
      });
    },
    { times: 1 },
  );
  await stateStarted;
  try {
    await page
      .getByRole("region", { name: "Review actions", exact: true })
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByTestId("draft-save-state")).toContainText(
      "Saved privately",
    );
    const staleResponse = page.waitForResponse(
      (response) => response.headers()["x-stale-review-fixture"] === "true",
    );
    releaseState();
    await (await staleResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.getByTestId("draft-save-state").textContent()).toContain(
      "Revision 2",
    );
    expect(
      await page
        .getByLabel("Connect a different message", { exact: true })
        .inputValue(),
    ).toBe(originalId);
  } finally {
    releaseState();
  }
  await page.reload();
  await page
    .getByRole("button", {
      name: "Review Correct an older original",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Connect a different message", { exact: true }),
  ).toHaveValue(originalId);
  await expect(page.locator(".review-panel blockquote")).toContainText(
    "Correction fixture message 0",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByText("Find another original message", { exact: true })
    .click();
  await page
    .getByLabel("Find a viewer or message", { exact: true })
    .fill("Correction fixture message 0");
  await expect(search).toContainText("1 available messages match.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/message-correction-mobile.png",
    fullPage: true,
  });
});

test("literal coding captions agree in private preview, approved replay and the separate reader", async ({
  page,
  context,
}) => {
  const words = "if (x < 5 && y > 2) --> literal <b>words</b>";
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ New exchange", exact: true })
    .click();
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Literal coding captions fixture");
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page.getByText("Advanced caption text", { exact: true }).click();
  await page
    .getByLabel("Captions (relative start | end | text, one per line)")
    .fill("0 | 5 | " + words);
  await expect
    .poll(() =>
      page.locator(".editor video").evaluate((video: HTMLVideoElement) => {
        const cue = video.textTracks[0]?.cues?.[0];
        return cue instanceof VTTCue
          ? cue.getCueAsHTML().textContent
          : undefined;
      }),
    )
    .toBe(words);
  await page
    .getByRole("region", { name: "Review actions", exact: true })
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  const approval = page.waitForResponse(
    (response) =>
      response.url().endsWith("/approve") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^Approve revision/ }).click();
  const { id } = await (await approval).json();
  await expect
    .poll(async () =>
      (await page.request.get("/api/public/replies/" + id)).status(),
    )
    .toBe(200);
  const viewer = await context.newPage();
  await viewer.goto("/r/" + id);
  await expect
    .poll(() =>
      viewer.locator("video").evaluate((video: HTMLVideoElement) => {
        const cue = video.textTracks[0]?.cues?.[0];
        return cue instanceof VTTCue
          ? cue.getCueAsHTML().textContent
          : undefined;
      }),
    )
    .toBe(words);
  const { token } = await (
    await page.request.get("/api/creator/session")
  ).json();
  expect(
    (
      await page.request.post("/api/creator/publications/" + id + "/publish", {
        headers: { "x-creator-token": token },
      })
    ).ok(),
  ).toBe(true);
  await expect
    .poll(async () =>
      (
        await viewer.request.get(
          "http://localhost:4321/api/public/replies/" + id,
        )
      ).status(),
    )
    .toBe(200);
  await viewer.goto("http://localhost:4321/r/" + id);
  await expect
    .poll(() =>
      viewer.locator("video").evaluate((video: HTMLVideoElement) => {
        const cue = video.textTracks[0]?.cues?.[0];
        return cue instanceof VTTCue
          ? cue.getCueAsHTML().textContent
          : undefined;
      }),
    )
    .toBe(words);
});

test("creator polling recovers a rotated-session response fixture without dropping draft edits and favicons load", async ({
  page,
}) => {
  await page.goto("/");
  const { token: actualToken } = await (
    await page.request.get("/api/creator/session")
  ).json();
  for (const origin of ["http://localhost:4318", "http://localhost:4321"]) {
    const icon = await page.request.get(origin + "/favicon.ico");
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  }
  await page
    .getByRole("button", { name: "Review One more time, slowly", exact: true })
    .click();
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Unsaved across local session refresh");
  let renewals = 0,
    rejections = 0,
    stateReads = 0;
  const replacement = "rotated-session-fixture";
  await page.route("**/api/creator/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/creator/session") {
      renewals++;
      return route.fulfill({ json: { token: replacement } });
    }
    if (request.resourceType() !== "fetch") return route.continue();
    if (request.headers()["x-creator-token"] !== replacement) {
      rejections++;
      return route.fulfill({
        status: 401,
        json: { error: "Rotated local-session response fixture" },
      });
    }
    if (path === "/api/creator/state") stateReads++;
    return route.continue({
      headers: { ...request.headers(), "x-creator-token": actualToken },
    });
  });
  await expect.poll(() => renewals, { timeout: 12000 }).toBe(1);
  await expect
    .poll(() => stateReads, { timeout: 12000 })
    .toBeGreaterThanOrEqual(1);
  const initialRejections = rejections;
  await expect
    .poll(() => stateReads, { timeout: 12000 })
    .toBeGreaterThanOrEqual(3);
  expect(rejections).toBe(initialRejections);
  expect(renewals).toBe(1);
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Unsaved across local session refresh",
  );
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Unsaved changes",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Studio offline" }),
  ).toHaveCount(0);
  await page.unroute("**/api/creator/**");
});
