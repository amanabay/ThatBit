import { test } from "node:test";
import assert from "node:assert/strict";
import { hasAnswerEvidence } from "../apps/server/src/domain/answer-evidence.ts";
import { suggest } from "../apps/server/src/domain/matching.ts";
test("explicit deferrals and absent speech abstain without treating all negation as refusal", () => {
  for (const text of [
    "[music] [inaudible]",
    "I don't know that.",
    "We will cover shadows another day.",
    "I cannot answer that right now.",
    "Let me finish this first.",
  ])
    assert.equal(hasAnswerEvidence(text), false, text);
  for (const text of [
    "Do not overwrite the original file; save a new copy.",
    "I cannot use that codec because this build lacks its decoder.",
    "The database transaction prevents partial writes.",
  ])
    assert.equal(hasAnswerEvidence(text), true, text);
  const messages = [
    {
      id: "m",
      sourceId: "m",
      userId: "u",
      author: "Ada",
      text: "How do shadows work?",
      source: "fixture" as const,
      removed: false,
      receivedAt: "2026-10-29T00:00:00.000Z",
    },
  ];
  assert.deepEqual(
    suggest(messages, [
      { start: 0, end: 5, text: "Ada, I will explain shadows later." },
    ]),
    [],
  );
});
