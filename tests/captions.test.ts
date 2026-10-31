import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCaptions,
  rebaseCaptionText,
  draftCaptionVtt,
} from "../apps/web/src/creator/captions.ts";
test("private caption preview uses actual source timing, escapes cue markup and refuses incomplete or cut captions", () => {
  const vtt = draftCaptionVtt("0.5 | 2 | <b>literal & corrected</b>", 30, 10);
  assert.ok(vtt?.includes("00:00:30.500 --> 00:00:32.000"));
  assert.ok(vtt?.includes("&lt;b&gt;literal &amp; corrected&lt;/b&gt;"));
  assert.equal(draftCaptionVtt("0 |", 30, 10), undefined);
  assert.equal(draftCaptionVtt("-1 | 2 | cut words", 30, 10), undefined);
  assert.equal(draftCaptionVtt("", 30, 10), undefined);
  assert.equal(draftCaptionVtt("0 | 1 | invalid source", 1e13, 10), undefined);
});
import {
  readerOrigin,
  previewPage,
  readerShell,
} from "../apps/server/src/adapters/publishing/preview.ts";
test("caption editing preserves incomplete input, bounds timing and keeps source timing when trimming", () => {
  assert.equal(parseCaptions("0 |", 10).valid, false);
  assert.equal(
    parseCaptions("0 | 2 | first\n1 | 3 | overlap", 10).valid,
    false,
  );
  assert.equal(parseCaptions("0 | 11 | outside", 10).valid, false);
  assert.equal(
    parseCaptions("0 | 2 | text with | delimiter", 10).captions[0]?.text,
    "text with | delimiter",
  );
  assert.equal(
    parseCaptions("0 | 2 | trailing ", 10).rows[0]?.text,
    "trailing ",
  );
  const moved = rebaseCaptionText("2 | 4 | source words", -1);
  assert.deepEqual(parseCaptions(moved, 5).captions, [
    { start: 1, end: 3, text: "source words" },
  ]);
  const cut = rebaseCaptionText("0 | 2 | retain words", -1);
  assert.equal(parseCaptions(cut, 5).valid, false);
  assert.ok(cut.includes("retain words"));
  assert.equal(
    parseCaptions(rebaseCaptionText("2 | 4 | source | words ", -1), 5).rows[0]
      ?.text,
    "source | words ",
  );
});
test("reader preview origins are configured and unavailable HTML has no rich reply metadata", () => {
  assert.equal(readerOrigin("https://example.com/"), "https://example.com");
  for (const origin of [
    "http://example.com",
    "https://secret@example.com",
    "https://example.com/path",
  ])
    assert.throws(() => readerOrigin(origin));
  const unavailable = previewPage(
    "<html><head><title>Default</title></head></html>",
    undefined,
    "https://example.com",
  );
  assert.ok(unavailable.includes("noindex"));
  assert.ok(!unavailable.includes("og:image"));
  const shell = readerShell("<html><head></head><body></body></html>");
  assert.equal(readerShell(shell), shell);
  assert.ok(shell.includes('name="replylink-app" content="reader"'));
});
