import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCaptions,
  rebaseCaptionText,
  draftCaptionVtt,
} from "../apps/web/src/creator/captions.ts";
import {
  transcriptCaptions,
  mergeTranscriptCaptions,
  nextCaptionInterval,
} from "../apps/web/src/creator/transcript-selection.ts";
test("transcript selection keeps complete source sentences and merges without overwriting corrections", () => {
  const sentences = [
    { start: 10, end: 11, text: "literal <b>words</b>" },
    { start: 11, end: 13, text: "second sentence" },
  ];
  assert.deepEqual(transcriptCaptions(sentences, 10.5, 13), [
    { start: 0.5, end: 2.5, text: "second sentence" },
  ]);
  const added = transcriptCaptions(sentences, 10, 15);
  const merged = mergeTranscriptCaptions("4 | 5 | Corrected words", added, 5);
  assert.equal(merged.error, "");
  assert.deepEqual(merged.captions, [
    ...added,
    { start: 4, end: 5, text: "Corrected words" },
  ]);
  assert.equal(
    mergeTranscriptCaptions("0 | 1 | literal <b>words</b>", added, 5).captions
      .length,
    2,
  );
  assert.match(
    mergeTranscriptCaptions("0 | 1 | Corrected words", added, 5).error,
    /overlap/,
  );
  assert.match(mergeTranscriptCaptions("0 |", added, 5).error, /incomplete/);
  assert.equal(
    mergeTranscriptCaptions("", [{ start: -1, end: 2, text: "outside" }], 5)
      .captions.length,
    0,
  );
});
test("manual caption creation finds a usable gap and refuses a zero-length interval", () => {
  assert.deepEqual(nextCaptionInterval([], 8), { start: 0, end: 3 });
  assert.deepEqual(
    nextCaptionInterval(
      [
        { start: 0, end: 3, text: "first" },
        { start: 6, end: 8, text: "last" },
      ],
      8,
    ),
    { start: 3, end: 6 },
  );
  assert.equal(
    nextCaptionInterval([{ start: 0, end: 8, text: "full" }], 8),
    undefined,
  );
});
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
  assert.ok(shell.includes('name="thatbit-app" content="reader"'));
  const upgraded = readerShell(
    '<html><head><meta name="replylink-app" content="reader"></head></html>',
  );
  assert.ok(upgraded.includes('name="thatbit-app" content="reader"'));
  assert.ok(!upgraded.includes('name="replylink-app"'));
  assert.equal(readerShell(upgraded), upgraded);
  assert.ok(unavailable.includes("Replay unavailable — ThatBit"));
});
