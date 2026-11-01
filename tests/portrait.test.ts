import { test } from "node:test";
import assert from "node:assert/strict";
import { portraitHeader } from "../apps/server/src/domain/portrait.ts";
test("portrait wrapping preserves long words, literal directives and Unicode without covering the source frame", () => {
  const author = "a".repeat(80);
  const message =
    "Original URL https://example.test/" +
    "path".repeat(65) +
    " %{pts} <literal> 😃";
  const header = portraitHeader(author, message);
  assert.equal(header.text.replaceAll("\n", ""), "@" + author + message);
  assert.ok((header.fontSize + 4) * header.text.split("\n").length <= 280);
  assert.ok(header.text.includes("%{pts}"));
  const wide = portraitHeader(
    "W".repeat(80),
    "W".repeat(200),
    (text) => Array.from(text).length,
  );
  assert.ok(
    Math.max(...wide.text.split("\n").map((line) => line.length)) *
      wide.fontSize <=
      624,
  );
  assert.throws(() => portraitHeader("author", "x".repeat(401)), /up to 400/);
  assert.throws(
    () => portraitHeader("author", "\n".repeat(30)),
    /too many lines/,
  );
});
