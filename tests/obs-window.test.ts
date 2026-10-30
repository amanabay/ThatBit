import { test } from "node:test";
import assert from "node:assert/strict";
import { recentObsWindow } from "../apps/server/src/domain/obs-window.ts";
import type { Asset } from "../shared/contracts/models.ts";
import type { ObsSegment } from "../shared/contracts/capture.ts";
test("rolling OBS analysis ends at its target and stops at gaps, unknown epochs, duration and size bounds", () => {
  const assets: Asset[] = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    duration: 30,
    bytes: 1,
    audio: true,
    fixture: true,
    sha256: "fixture",
    createdAt: "2026-10-30",
  }));
  const segments: ObsSegment[] = assets.map((a, sequence) => ({
    id: a.id,
    epoch: "epoch",
    sequence,
    savedAt: sequence,
  }));
  assert.deepEqual(recentObsWindow(segments, assets, "2"), ["0", "1", "2"]);
  assert.deepEqual(recentObsWindow(segments, assets, "3"), ["1", "2", "3"]);
  assert.deepEqual(
    recentObsWindow(
      segments.filter((s) => s.id !== "1"),
      assets,
      "2",
    ),
    ["2"],
  );
  assert.deepEqual(
    recentObsWindow(
      segments.map((s) => (s.id === "1" ? { ...s, epoch: "other" } : s)),
      assets,
      "2",
    ),
    ["2"],
  );
  assert.deepEqual(
    recentObsWindow(
      segments.map((s) => ({ ...s, epoch: null })),
      assets,
      "2",
    ),
    ["2"],
  );
  assert.deepEqual(
    recentObsWindow(
      segments,
      assets.map((a) => ({ ...a, duration: 100 })),
      "2",
    ),
    ["2"],
  );
  assert.deepEqual(
    recentObsWindow(
      segments,
      assets.map((a) => ({ ...a, bytes: 150 * 1024 * 1024 })),
      "2",
    ),
    ["2"],
  );
  assert.deepEqual(recentObsWindow(segments, [], "2"), []);
});
