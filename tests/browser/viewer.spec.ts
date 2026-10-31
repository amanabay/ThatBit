import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

let id = "";
let token = "";
const origin = "http://localhost:4321";
const words = "if (x < 5 && y > 2) --> literal <b>words</b> [x].";
const apiPath = () => "/api/public/replies/" + id;

test.beforeAll(async ({ request }) => {
  ({ token } = await (await request.get("/api/creator/session")).json());
  const headers = { "x-creator-token": token };
  const state = await (
    await request.get("/api/creator/state", { headers })
  ).json();
  const asset = state.assets.find(
    (candidate: { fixture: boolean; duration: number }) =>
      candidate.fixture && candidate.duration >= 6,
  );
  expect(asset).toBeTruthy();
  const draftId = "e2e-viewer-" + randomUUID();
  const message = await request.post("/api/creator/messages", {
    headers,
    data: {
      author: "ReaderFixture",
      text: "Generated reader test message; no actual audience participation.",
    },
  });
  expect(message.ok()).toBe(true);
  const saved = await request.put("/api/creator/drafts/" + draftId, {
    headers,
    data: {
      expectedVersion: 0,
      messageId: (await message.json()).id,
      assetId: asset.id,
      start: 0,
      end: 6,
      title: "An approved reader fixture",
      captions: [
        {
          start: 0,
          end: 2,
          text: "Authored captions for generated media; no spoken response.",
        },
        { start: 2, end: 5, text: words },
      ],
    },
  });
  expect(saved.ok()).toBe(true);
  const approval = await request.post(
    "/api/creator/drafts/" + draftId + "/approve",
    {
      headers,
      data: { version: (await saved.json()).version },
    },
  );
  expect(approval.ok()).toBe(true);
  ({ id } = await approval.json());
  await expect
    .poll(async () => (await request.get(apiPath())).status())
    .toBe(200);
  expect(
    (
      await request.post("/api/creator/publications/" + id + "/publish", {
        headers,
      })
    ).ok(),
  ).toBe(true);
  await expect
    .poll(async () => (await request.get(origin + apiPath())).status())
    .toBe(200);
});

test("approved transcript search, bounded moment links and clipboard fallback work on mobile without autoplay", async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/creator/"))
      privateRequests.push(request.url());
  });
  await page.goto(origin + "/r/" + id + "?t=3.2&unrelated=discard#fragment");
  const video = page.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(3.2, 1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByText("Read the approved transcript", { exact: true }).click();
  const search = page.getByRole("searchbox", {
    name: "Find in this transcript",
  });
  await search.fill("<b>");
  await expect(page.locator(".approved-transcript li")).toHaveCount(1);
  await expect(page.locator(".approved-transcript mark")).toHaveText("<b>");
  await expect(page.locator(".approved-transcript li")).toContainText(words);
  await page.locator(".approved-transcript li button").click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(2, 1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(
    page.locator('.approved-transcript button[aria-current="true"]'),
  ).toHaveCount(1);
  await search.fill("not present");
  await expect(
    page.getByText("No approved captions match. Try another word."),
  ).toBeVisible();
  await search.fill("[x].");
  await expect(page.locator(".approved-transcript mark")).toHaveText("[x].");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied fixture");
        },
      },
    });
  });
  await page
    .getByRole("button", { name: "Copy link to 0:02", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Replay link", exact: true }),
  ).toHaveValue(origin + "/r/" + id + "?t=2");
  await page
    .getByRole("button", { name: "Copy replay link ↗", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Replay link", exact: true }),
  ).toHaveValue(origin + "/r/" + id);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) =>
          localStorage.setItem("copied-reader-fixture", value),
      },
    });
  });
  await page
    .getByRole("button", { name: "Copy link to 0:02", exact: true })
    .click();
  await expect(
    page.getByText("Link to 0:02 copied.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("copied-reader-fixture")),
  ).toBe(origin + "/r/" + id + "?t=2");
  await expect(
    page.getByRole("textbox", { name: "Replay link", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/viewer-search-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/viewer-search-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/viewer-search-light-mobile.png",
    fullPage: true,
  });
  await page.goto(origin + "/r/" + id + "?t=9999");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(5.8);
  expect(
    await video.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeLessThan(6);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(privateRequests).toEqual([]);
});

test("failed media retries preserve the requested and current positions while staying paused", async ({
  page,
}) => {
  let broken = true;
  await page.route("**" + apiPath() + "/video", (route) =>
    broken
      ? route.fulfill({
          contentType: "video/mp4",
          body: "Labelled corrupt media response fixture",
        })
      : route.continue(),
  );
  await page.goto(origin + "/r/" + id + "?t=2.2");
  await expect(page.getByText(/Playback couldn’t continue/)).toBeVisible();
  broken = false;
  await page
    .getByRole("button", { name: "Retry playback", exact: true })
    .click();
  const video = page.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(2.2, 1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 3.5;
  });
  await expect(
    page.getByRole("button", { name: "Copy link to 0:03", exact: true }),
  ).toBeVisible();
  await video.evaluate((v) => v.dispatchEvent(new Event("error")));
  await expect(
    page.getByRole("button", { name: "Retry playback", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry playback", exact: true })
    .click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(3.5, 1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.getByText(/Playback couldn’t continue/)).toHaveCount(0);
});

test("availability failures keep approved playback, recover without resetting it, and periodic removal discards media", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(origin + "/r/" + id);
  const video = page.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(1);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 2.5;
  });
  const retired = await video.elementHandle();
  let status = 502;
  await page.route(origin + apiPath(), (route) =>
    status === 200
      ? route.continue()
      : route.fulfill({ status, body: "Availability response fixture" }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText(/Couldn’t check this replay’s availability/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "An approved reader fixture" }),
  ).toBeVisible();
  expect(
    await video.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeCloseTo(2.5, 1);
  status = 200;
  await page
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await expect(
    page.getByText(/Couldn’t check this replay’s availability/),
  ).toHaveCount(0);
  expect(
    await video.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeCloseTo(2.5, 1);
  status = 410;
  await page.clock.fastForward(15000);
  await expect(
    page.getByRole("heading", { name: "This replay is unavailable." }),
  ).toBeVisible();
  await expect(video).toHaveCount(0);
  expect(
    await retired?.evaluate((v: HTMLVideoElement) => ({
      paused: v.paused,
      src: v.getAttribute("src"),
      connected: v.isConnected,
    })),
  ).toEqual({ paused: true, src: null, connected: false });
  await expect(
    page.getByText(
      "Generated reader test message; no actual audience participation.",
    ),
  ).toHaveCount(0);
});

test("a real managed-reader withdrawal clears an already open replay on focus", async ({
  page,
  request,
}) => {
  await page.goto(origin + "/r/" + id);
  const video = page.locator("video");
  await video.evaluate(async (v: HTMLVideoElement) => {
    await v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  const retired = await video.elementHandle();
  expect(
    (
      await request.delete("/api/creator/publications/" + id, {
        headers: { "x-creator-token": token },
      })
    ).ok(),
  ).toBe(true);
  await expect
    .poll(async () => (await request.get(origin + apiPath())).status())
    .toBe(410);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "This replay is unavailable." }),
  ).toBeVisible();
  expect(
    await retired?.evaluate((v: HTMLVideoElement) => ({
      paused: v.paused,
      src: v.getAttribute("src"),
    })),
  ).toEqual({ paused: true, src: null });
  await expect(page.locator("article")).toHaveCount(0);
});
