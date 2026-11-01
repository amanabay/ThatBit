import { test, expect, type Page } from "@playwright/test";
import { generatedCapture } from "./capture-fixture.ts";
import AxeBuilder from "@axe-core/playwright";

async function openDraft(page: Page, title: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ New exchange", exact: true })
    .click();
  await page.getByLabel("Replay title", { exact: true }).fill(title);
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
}

test("manual source entry survives closing setup and creates the next draft with that exact acknowledged message", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sources & setup", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Viewer name").fill("AuditFixture");
  await dialog
    .getByLabel("Original message")
    .fill("Authored manual audit fixture; no actual audience participation.");
  await page.getByRole("button", { name: "Close setup", exact: true }).click();
  await page
    .getByRole("button", { name: "Sources & setup", exact: true })
    .click();
  await expect(dialog.getByLabel("Original message")).toHaveValue(
    "Authored manual audit fixture; no actual audience participation.",
  );
  await expect(
    dialog.getByRole("button", { name: /03 \/ Create an exchange/ }),
  ).toBeDisabled();
  let fail = true;
  await page.route("**/api/creator/messages", (route) =>
    fail
      ? route.fulfill({
          status: 409,
          json: { error: "Manual entry rejected [audit response fixture]." },
        })
      : route.continue(),
  );
  await dialog
    .getByRole("button", { name: "Add manual message", exact: true })
    .click();
  await expect(dialog.locator(".setup-status")).toContainText(
    "Manual entry rejected",
  );
  await expect(dialog.getByLabel("Viewer name")).toHaveValue("AuditFixture");
  fail = false;
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/creator/messages") &&
      r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Add manual message", exact: true })
    .click();
  const message = (await (await saved).json()).message;
  await expect(dialog.getByLabel("Original message")).toHaveValue("");
  await dialog
    .getByRole("button", { name: /03 \/ Create an exchange/ })
    .click();
  await expect(page.getByLabel("Replay title", { exact: true })).toBeVisible();
  await expect(page.locator(".review-panel blockquote")).toContainText(
    "@AuditFixture",
  );
  await expect(page.locator(".review-panel blockquote")).toContainText(
    message.text,
  );
  const state = await (await page.request.get("/api/creator/state")).json();
  expect(
    state.drafts.some((r: { messageId: string }) => r.messageId === message.id),
  ).toBe(true);
});

test("a successful mutation keeps its confirmation when the following status refresh fails", async ({
  page,
}) => {
  await openDraft(page, "Audit refresh confirmation fixture");
  let offline = false,
    writes = 0;
  await page.route("**/api/creator/state", (route) =>
    offline
      ? route.fulfill({
          status: 502,
          json: { error: "State unavailable [audit response fixture]." },
        })
      : route.continue(),
  );
  await page.route("**/api/creator/drafts/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    const response = await route.fetch();
    offline = true;
    await route.fulfill({ response });
  });
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Confirmed save despite refresh fault");
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  await expect(page.getByRole("status")).toContainText("saved durably");
  await expect(
    page.getByRole("alert").filter({ hasText: "Studio offline" }),
  ).toBeVisible();
  expect(writes).toBe(1);
  offline = false;
  await page
    .getByRole("button", { name: "Reconnect studio", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Studio offline" }),
  ).toHaveCount(0);
});

test("private quality notes retain newer typing during save, block accidental navigation and allow explicit discard", async ({
  page,
}) => {
  await openDraft(page, "Audit note persistence fixture");
  let readFails = true,
    holdSave = true;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/creator/reviews/*", async (route) => {
    if (route.request().method() === "GET" && readFails)
      return route.fulfill({
        status: 502,
        json: { error: "Review load unavailable [audit response fixture]." },
      });
    if (route.request().method() === "POST" && holdSave) {
      const response = await route.fetch();
      await held;
      return route.fulfill({ response });
    }
    return route.continue();
  });
  // Reopen so the exact-revision form must load its authoritative baseline.
  await page.reload();
  await page
    .getByRole("button", {
      name: "Review Audit note persistence fixture",
      exact: true,
    })
    .click();
  await page
    .getByRole("tab", { name: "Evidence & notes", exact: true })
    .click();
  const notes = page.locator(".review-notes");
  await notes.locator("summary").click();
  await notes
    .getByLabel("Private review notes", { exact: true })
    .fill("First private note [fixture].");
  await expect(
    notes.getByRole("button", {
      name: "Save private quality note",
      exact: true,
    }),
  ).toBeDisabled();
  readFails = false;
  await notes
    .getByRole("button", { name: "Reload saved quality note", exact: true })
    .click();
  await expect(
    notes.getByLabel("Private review notes", { exact: true }),
  ).toHaveValue("First private note [fixture].");
  await notes
    .getByRole("button", { name: "Save private quality note", exact: true })
    .click();
  await notes
    .getByLabel("Private review notes", { exact: true })
    .fill("Newer private note typed during save [fixture].");
  await page.getByRole("button", { name: /Received chat/ }).click();
  await expect(page.getByRole("status")).toContainText(
    "Save or discard your private review changes",
  );
  release();
  await expect(notes).toContainText(
    "Earlier review saved. Your newer changes still need saving.",
  );
  await expect(
    notes.getByLabel("Private review notes", { exact: true }),
  ).toHaveValue("Newer private note typed during save [fixture].");
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "before saving a new draft revision",
  );
  holdSave = false;
  await notes
    .getByRole("button", { name: "Save private quality note", exact: true })
    .click();
  await expect(notes).toContainText("Private review saved for this revision.");
  await notes
    .getByLabel("Private review notes", { exact: true })
    .fill("An unsaved follow-up [fixture].");
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await notes.screenshot({
    path: "test-results/audit-quality-note-mobile.png",
  });
  await notes
    .getByRole("button", { name: "Discard quality note changes", exact: true })
    .click();
  await expect(
    notes.getByLabel("Private review notes", { exact: true }),
  ).toHaveValue("Newer private note typed during save [fixture].");
  await page.getByRole("button", { name: /Received chat/ }).click();
  await expect(
    page.getByRole("region", { name: "Received chat inbox" }),
  ).toBeVisible();
});

test("evidence failures are visible, original assessments protect edits and invalid correction times are explained", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/creator/suggestions/*", (route) =>
    fail
      ? route.fulfill({
          status: 502,
          json: { error: "Evidence unavailable [audit response fixture]." },
        })
      : route.continue(),
  );
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
  await expect(evidence.getByRole("alert")).toContainText(
    "could not be loaded",
  );
  fail = false;
  await evidence
    .getByRole("button", { name: "Retry original evidence", exact: true })
    .click();
  await evidence
    .getByText("Assess the original suggestion", { exact: true })
    .click();
  await evidence
    .getByLabel("Time spent correcting", { exact: true })
    .fill("1.5");
  await expect(evidence.getByRole("alert")).toContainText("whole number");
  await evidence
    .getByLabel("Time spent correcting", { exact: true })
    .fill("15");
  await evidence
    .getByLabel("Original proposal notes", { exact: true })
    .fill("Audit-only original assessment fixture.");
  await page.getByRole("button", { name: /Received chat/ }).click();
  await expect(page.getByRole("status")).toContainText(
    "private review changes",
  );
  await evidence
    .getByRole("button", {
      name: "Discard original assessment changes",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /Received chat/ }).click();
  await expect(
    page.getByRole("region", { name: "Received chat inbox" }),
  ).toBeVisible();
});

test("an interrupted save can confirm persisted content without repeating the mutation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds) =>
      timeout(milliseconds === 20000 ? 500 : milliseconds);
  });
  await openDraft(page, "Audit uncertain save fixture");
  let writes = 0,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/creator/drafts/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Saved but acknowledgement interrupted [fixture]");
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Save not confirmed",
  );
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Saved but acknowledgement interrupted [fixture]",
  );
  await page
    .getByRole("button", { name: "Check saved revision", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  expect(writes).toBe(1);
  release();
});

test("changing recordings can restore unsaved captions and blocked creation does not claim success", async ({
  page,
}) => {
  await openDraft(page, "Audit recording undo fixture");
  const recording = page.getByRole("combobox", {
    name: "Recording",
    exact: true,
  });
  const previous = await recording.inputValue();
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page.getByText("Advanced caption text", { exact: true }).click();
  const captions = page.getByLabel(
    "Captions (relative start | end | text, one per line)",
  );
  await captions.fill("0 | 1 | Unsaved corrected words [fixture].");
  await page.getByRole("tab", { name: "Response", exact: true }).click();
  const next = await recording
    .locator("option")
    .evaluateAll(
      (options, value) =>
        options.map((o) => o.getAttribute("value")).find((id) => id !== value),
      previous,
    );
  await recording.selectOption(next ?? "");
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Title edited after choosing a different recording");
  await page
    .getByRole("button", { name: "Undo recording change", exact: true })
    .click();
  await expect(recording).toHaveValue(previous);
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Title edited after choosing a different recording",
  );
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await expect(captions).toHaveValue(
    "0 | 1 | Unsaved corrected words [fixture].",
  );
  await page
    .getByRole("button", { name: "Sources & setup", exact: true })
    .click();
  await page.getByRole("button", { name: /03 \/ Create an exchange/ }).click();
  await expect(page.getByRole("status")).toContainText(
    "Save your changes or use Revert",
  );
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Title edited after choosing a different recording",
  );
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
});

test("reader withdrawal remains visible until acknowledgement and library search explains empty results", async ({
  page,
}) => {
  // Each observed transition can include an eight-second request deadline and
  // the 2.5-second poll interval. Keep all state assertions, with bounded waits.
  test.setTimeout(45000);
  let phase = "available";
  let removed = false;
  let retries = 0;
  const publicationId = "audit-reader-response-fixture";
  await page.route("**/api/creator/state", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    const revision = state.drafts[0];
    const publication = {
      id: publicationId,
      revisionId: revision.id,
      state: removed ? "removed" : "published",
      generation: removed ? 2 : 1,
      creator: "Fixture",
      createdAt: "2026-11-01",
      error: null,
      attempts: 0,
      nextAttempt: 0,
      portrait: false,
    };
    await route.fulfill({
      json: {
        ...state,
        readerUrl: "http://localhost:4321",
        publications: [...state.publications, publication],
        publicationContent: [
          ...state.publicationContent,
          {
            publicationId,
            revisionId: revision.id,
            draftId: revision.draftId,
            title: "Labelled reader state response fixture",
            version: revision.version,
            messageId: revision.messageId,
            start: revision.start,
            end: revision.end,
          },
        ],
        synchronization: [
          ...state.synchronization,
          {
            id: publicationId,
            generation: removed ? 2 : 1,
            state: phase,
            attempts: 0,
            nextAttempt: 0,
            error:
              phase === "failed" ? "Reader offline [response fixture]." : null,
          },
        ],
      },
    });
  });
  await page.route("**/api/creator/publications/" + publicationId, (route) => {
    removed = true;
    phase = "queued";
    return route.fulfill({ json: { ok: true } });
  });
  await page.route(
    "**/api/creator/synchronization/" + publicationId + "/retry",
    (route) => {
      retries++;
      phase = "removed";
      return route.fulfill({ json: { ok: true } });
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Published replies/ }).click();
  await expect(
    page.getByRole("button", { name: "Published to reader", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Share in Twitch", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Twitch sharing requires a published HTTPS reader/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  const sync = page.getByRole("region", { name: "Reader synchronization" });
  await expect(sync).toContainText("Reader removal queued");
  phase = "removing";
  await expect(sync).toContainText("Removing replay from reader", {
    timeout: 12000,
  });
  await expect(sync.getByRole("button")).toHaveCount(0);
  phase = "failed";
  await expect(sync).toContainText("Reader removal failed", { timeout: 12000 });
  await sync
    .getByRole("button", { name: "Retry reader removal", exact: true })
    .click();
  await expect(sync).toContainText("Reader removal acknowledged");
  expect(retries).toBe(1);
  await page.getByLabel("Search exchanges").fill("no matching audit exchange");
  await expect(
    page.getByRole("heading", {
      name: "No exchanges match your search.",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear exchange search", exact: true })
    .click();
});

test("upload malformed acknowledgements give safe recovery and allow choosing the same file again", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sources & setup", exact: true })
    .click();
  let uploads = 0;
  await page.route("**/api/creator/media", (route) => {
    uploads++;
    return uploads === 1
      ? route.fulfill({
          status: 200,
          body: "",
          contentType: "application/json",
        })
      : route.fulfill({
          status: 409,
          json: { error: "Unsupported media [audit response fixture]." },
        });
  });
  const input = page.getByRole("dialog").locator('input[type="file"]');
  const file = {
    name: "labelled-response-fixture.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("Labelled upload response fixture; not actual media"),
  };
  await input.setInputFiles(file);
  await expect(page.getByRole("dialog").locator(".setup-status")).toContainText(
    "may have completed",
  );
  await expect(input).toHaveValue("");
  await input.setInputFiles(file);
  await expect(page.getByRole("dialog").locator(".setup-status")).toContainText(
    "Unsupported media",
  );
  expect(uploads).toBe(2);
});

test("a delayed new-draft acknowledgement does not replace edits made in the current editor", async ({
  page,
}) => {
  await openDraft(page, "Audit delayed creation fixture");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let createdId = "";
  await page.route("**/api/creator/drafts/*", async (route) => {
    if (
      route.request().method() !== "PUT" ||
      route.request().postDataJSON().expectedVersion !== 0
    )
      return route.continue();
    const response = await route.fetch();
    createdId = (await response.json()).draftId;
    await held;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Sources & setup", exact: true })
    .click();
  await page.getByRole("button", { name: /03 \/ Create an exchange/ }).click();
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Edits made while another draft was being created");
  await expect.poll(() => createdId).not.toBe("");
  release();
  await expect(page.getByRole("status")).toContainText(
    "current unsaved edits remain open",
  );
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Edits made while another draft was being created",
  );
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Unsaved changes",
  );
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  const state = await (await page.request.get("/api/creator/state")).json();
  expect(
    state.drafts.some((r: { draftId: string }) => r.draftId === createdId),
  ).toBe(true);
});

test("capture finalization still saves acknowledged footage while another creator action is pending", async ({
  page,
}) => {
  await generatedCapture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Capture an exchange" }).click();
  await page.getByRole("button", { name: "Choose screen or tab" }).click();
  await expect(page.getByText(/Recording ·.*chunks saved to disk/)).toBeVisible(
    { timeout: 15000 },
  );
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/creator/messages", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Sources & setup", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Viewer name").fill("CaptureAuditFixture");
  await dialog
    .getByLabel("Original message")
    .fill(
      "Generated capture finalization fixture, not actual audience participation.",
    );
  await dialog
    .getByRole("button", { name: "Add manual message", exact: true })
    .click();
  await page.getByRole("button", { name: "Close setup", exact: true }).click();
  await page.getByRole("button", { name: "Stop & save recording" }).click();
  await expect
    .poll(
      async () => {
        const state = await (
          await page.request.get("/api/creator/state")
        ).json();
        return state.captures.some(
          (capture: { state: string; assetId: string | null }) =>
            capture.state === "finished" && capture.assetId !== null,
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  release();
  await expect(page.getByRole("status")).toContainText(
    "Manually entered source message saved",
  );
});

test("saved-version recovery preserves edits typed while its status read is delayed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds) =>
      timeout(milliseconds === 20000 ? 500 : milliseconds);
  });
  await openDraft(page, "Audit recovery edit-generation fixture");
  let releaseWrite = () => {},
    releaseRead = () => {},
    readStarted = () => {};
  const heldWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const heldRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const started = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  let writes = 0;
  await page.route("**/api/creator/drafts/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    const response = await route.fetch();
    if (writes === 1) await heldWrite;
    await route.fulfill({ response }).catch(() => {});
  });
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("The acknowledged earlier edit [fixture]");
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Save not confirmed",
  );
  let firstRead = true;
  await page.route("**/api/creator/state", async (route) => {
    if (!firstRead) return route.continue();
    firstRead = false;
    const response = await route.fetch();
    readStarted();
    await heldRead;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Check saved revision", exact: true })
    .click();
  await started;
  await page
    .getByLabel("Replay title", { exact: true })
    .fill("Newer edits typed while saved status was loading");
  releaseRead();
  await expect(
    page.getByRole("region", { name: "Saved draft comparison" }),
  ).toBeVisible();
  await expect(page.getByLabel("Replay title", { exact: true })).toHaveValue(
    "Newer edits typed while saved status was loading",
  );
  expect(writes).toBe(1);
  releaseWrite();
  await page
    .getByRole("button", {
      name: "Keep my edits for a new revision",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(page.getByTestId("draft-save-state")).toContainText(
    "Saved privately",
  );
  expect(writes).toBe(2);
});
