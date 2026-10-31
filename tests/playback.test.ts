import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captionParts,
  replayLink,
  replayPosition,
} from "../apps/web/src/viewer/playback.ts";

test("viewer timestamps remain finite and inside the approved replay", () => {
  for (const value of [
    null,
    "",
    "-1",
    "1e3",
    "Infinity",
    "NaN",
    "4#x",
    "4&private=x",
    "1.1234",
    Number.NaN,
    Infinity,
    -10,
  ])
    assert.equal(replayPosition(value, 8), 0);
  assert.equal(replayPosition("3.125", 8), 3.125);
  assert.equal(replayPosition("999", 8), 7.95);
  assert.equal(replayPosition(100, 0.02), 0);
  assert.equal(replayPosition("2", Infinity), 0);
  assert.equal(replayPosition("2", -1), 0);
  assert.equal(
    replayLink(
      "https://reader.example/r/old?secret=value#fragment",
      "approved_1",
      3.159,
    ),
    "https://reader.example/r/approved_1?t=3.1",
  );
  assert.equal(
    replayLink("https://reader.example", "approved_1"),
    "https://reader.example/r/approved_1",
  );
});

test("caption search treats code, regex characters and markup as literal approved words", () => {
  const source = "if (x < 5 && y > 2) --> literal <b>words</b> [x].";
  for (const query of ["<b>", "[x].", "(", "&&", "LITERAL"]) {
    const parts = captionParts(source, query);
    assert.equal(parts.map((part) => part.text).join(""), source);
    assert.equal(parts.filter((part) => part.match).length, 1);
    assert.equal(
      parts.find((part) => part.match)?.text.toLowerCase(),
      query.toLowerCase(),
    );
  }
  assert.equal(
    captionParts("answer Answer", "answer").filter((part) => part.match).length,
    2,
  );
  assert.deepEqual(captionParts(source, "  "), [
    { text: source, match: false },
  ]);
});
