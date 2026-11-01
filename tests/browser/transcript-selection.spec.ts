import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function draft(page: Page, title: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ New exchange", exact: true })
    .click();
  await page.getByLabel("Replay title", { exact: true }).fill(title);
  await page
    .getByRole("combobox", { name: "Recording", exact: true })
    .selectOption({ index: 0 });
  await page.getByLabel("Start (seconds)").fill("1");
  await page.getByLabel("End (seconds)").fill("8");
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  return page.getByRole("region", { name: "Transcript assistance" });
}

test("transcript sentences can be selected and added repeatedly while dirty, preserve corrections and survive save/reload", async ({
  page,
}) => {
  const section = await draft(page, "Caption selection integration fixture");
  await section
    .getByRole("button", {
      name: "Transcribe selected interval locally",
      exact: true,
    })
    .click();
  const first = section.getByRole("button", { name: /^Select sentence 1:/ });
  const second = section.getByRole("button", { name: /^Select sentence 2:/ });
  await expect(first).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("button", { name: "+ Add caption", exact: true })
    .click();
  await page.getByLabel("Caption 1 end", { exact: true }).fill("0.5");
  await page
    .getByLabel("Caption 1 text", { exact: true })
    .fill("Already corrected words.");
  await first.click();
  await expect(page.getByLabel("Start (seconds)")).toHaveValue("1");
  await expect(page.getByLabel("End (seconds)")).toHaveValue("8");
  await section
    .getByRole("button", {
      name: "Add selected captions to reply",
      exact: true,
    })
    .click();
  await expect(section.locator(".transcript-feedback")).toContainText(
    "overlap existing captions",
  );
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    "Already corrected words.",
  );
  await page
    .getByRole("button", { name: "Remove caption 1", exact: true })
    .click();
  await section
    .getByRole("button", {
      name: "Add selected captions to reply",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    /Kai/,
  );
  await second.click();
  await section
    .getByRole("button", {
      name: "Add selected captions to reply",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Caption 2 text", { exact: true })).toHaveValue(
    /Final sentence/,
  );
  await expect(first).toBeEnabled();
  await expect(second).toBeEnabled();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Unsaved changes",
  );
  await section
    .getByRole("button", {
      name: "Add selected captions to reply",
      exact: true,
    })
    .click();
  await expect(page.locator(".caption-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await page.reload();
  await page
    .getByRole("button", {
      name: "Review Caption selection integration fixture",
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await expect(first).toBeVisible();
  await expect(section).toContainText(
    "Retained from an earlier saved revision",
  );
  await second.click();
  await section
    .getByRole("button", {
      name: "Use selected sentences for reply",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Start (seconds)")).toHaveValue("2");
  await expect(page.getByLabel("End (seconds)")).toHaveValue("8");
  await expect(page.getByLabel("Caption 1 start", { exact: true })).toHaveValue(
    "0",
  );
  await expect(page.getByLabel("Caption 1 end", { exact: true })).toHaveValue(
    "6",
  );
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    /Final sentence/,
  );
  await expect(section.locator(".transcript-feedback")).toContainText(
    "Selected sentences applied",
  );
});

test("range selection previews across an edited boundary and applies separate literal captions without silently trimming", async ({
  page,
}) => {
  let assetId = "";
  const words = [
    "First fixture sentence " + "a".repeat(240),
    "Second fixture sentence " + "b".repeat(240),
    "Literal <b>code</b> & --> " + "c".repeat(240),
  ];
  await page.route("**/api/creator/analysis/*", (route) =>
    route.fulfill({
      json: {
        job: null,
        stale: false,
        suggestions: [],
        transcript: {
          id: "range-selection-fixture",
          assetId,
          sourceRevisionId: new URL(route.request().url()).pathname
            .split("/")
            .at(-1),
          provider: "Labelled response fixture",
          model: "No actual ASR",
          createdAt: "2026-11-01",
          start: 1,
          end: 8,
          segments: words.map((text, i) => ({
            start: i + 1,
            end: i + 2,
            text,
          })),
        },
      },
    }),
  );
  await draft(page, "Transcript range response fixture");
  const state = await (await page.request.get("/api/creator/state")).json();
  assetId = state.drafts.find(
    (r: { title: string }) => r.title === "Transcript range response fixture",
  ).assetId;
  const section = page.getByRole("region", { name: "Transcript assistance" });
  await expect(
    section.getByRole("button", { name: /^Select sentence 1:/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Response", exact: true }).click();
  await page.getByLabel("End (seconds)").fill("2");
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await section
    .getByRole("button", {
      name: "Start range here at sentence 1",
      exact: true,
    })
    .click();
  await section
    .getByRole("button", { name: "End range here at sentence 3", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: /^Select sentence/, pressed: true }),
  ).toHaveCount(3);
  await expect(page.getByLabel("End (seconds)")).toHaveValue("2");
  await expect(
    section.getByRole("button", {
      name: "Add selected captions to reply",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(section).toContainText(
    "These sentences fall outside the current reply",
  );
  await section
    .getByRole("button", { name: "Preview selected sentences", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".editor video")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(2.2);
  await expect
    .poll(() =>
      page.locator(".editor video").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(true);
  await section
    .getByRole("button", {
      name: "Use selected sentences for reply",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Start (seconds)")).toHaveValue("1");
  await expect(page.getByLabel("End (seconds)")).toHaveValue("4");
  await expect(page.locator(".caption-row")).toHaveCount(3);
  for (let i = 0; i < words.length; i++)
    await expect(
      page.getByLabel(`Caption ${i + 1} text`, { exact: true }),
    ).toHaveValue(words[i] ?? "");
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
    path: "test-results/transcript-selection-mobile.png",
    fullPage: true,
  });
  await section.locator(".transcript-selection").screenshot({
    path: "test-results/transcript-selection-controls-mobile.png",
  });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/transcript-selection-light-mobile.png",
    fullPage: true,
  });
  await section.locator(".transcript-selection").screenshot({
    path: "test-results/transcript-selection-controls-light-mobile.png",
  });
  await page.getByRole("tab", { name: "Response", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Recording", exact: true })
    .selectOption({ index: 1 });
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await expect(section).toContainText(
    "existing transcript belongs to a different recording",
  );
  await expect(
    section.getByRole("button", { name: /^Select sentence/ }),
  ).toHaveCount(0);
});

test("manual Add caption fills a gap, preserves later rows and explains when the reply is full", async ({
  page,
}) => {
  await draft(page, "Manual caption gap fixture");
  for (let i = 1; i <= 3; i++) {
    await page
      .getByRole("button", { name: "+ Add caption", exact: true })
      .click();
    await page
      .getByLabel(`Caption ${i} text`, { exact: true })
      .fill(`Manual caption fixture ${i}`);
  }
  await expect(page.getByLabel("Caption 3 end", { exact: true })).toHaveValue(
    "7",
  );
  await expect(
    page.getByRole("button", { name: "+ Add caption", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/The reply has no unused caption time/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove caption 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "+ Add caption", exact: true })
    .click();
  await expect(page.getByLabel("Caption 2 start", { exact: true })).toHaveValue(
    "3",
  );
  await expect(page.getByLabel("Caption 2 end", { exact: true })).toHaveValue(
    "6",
  );
  await expect(page.getByLabel("Caption 3 text", { exact: true })).toHaveValue(
    "Manual caption fixture 3",
  );
  await page
    .getByLabel("Caption 2 text", { exact: true })
    .fill("Replacement gap fixture.");
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
});
