import { CaptureEpoch } from "../shared/contracts/capture.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia, run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { LocalCaptureFiles } from "../apps/server/src/adapters/capture/files.ts";
import {
  Captures,
  type CaptureFiles,
} from "../apps/server/src/application/capture.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
const start = {
  mime: "video/webm;codecs=vp9,opus",
  clientWallAt: "2026-10-29T00:00:00.000Z",
  clientMonotonicMs: 100,
  fixture: true,
};
test("acknowledged capture chunks survive restart, retries dedupe, and recovered footage becomes a pinned real asset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "thatbit-capture-"));
  let store = new SQLiteStore(join(dir, "db"));
  try {
    const media = new FFmpegMedia(join(dir, "media"));
    let app = new Exchanges(store, media, "creator");
    const files = new LocalCaptureFiles(join(dir, "capture"));
    let captures = new Captures(store, files, (bytes, fixture, operationKey) =>
      app.ingest(bytes, fixture, operationKey),
    );
    const source = join(dir, "fixture.webm");
    await run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=20",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=600",
      "-t",
      "4",
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      "-threads",
      "2",
      "-c:a",
      "libopus",
      "-y",
      source,
    ]);
    const bytes = await readFile(source);
    const boundary = Math.floor(bytes.length / 2);
    const a = bytes.subarray(0, boundary),
      b = bytes.subarray(boundary);
    const e = captures.start(start);
    assert.throws(() => captures.start(start));
    await captures.append(e.id, 0, a, 1000, 0);
    assert.equal((await captures.append(e.id, 0, a, 1000, 0)).nextSequence, 1);
    await assert.rejects(() =>
      captures.append(e.id, 0, Buffer.from("different"), 1000, 0),
    );
    await assert.rejects(() => captures.append(e.id, 2, b, 2000, 1000));
    await assert.rejects(() => captures.append(e.id, 1, b, 500, 1000));
    await captures.append(e.id, 1, b, 4000, 3000);
    await assert.rejects(() => captures.snapshot(e.id, true, 1));
    const snapshot = await captures.snapshot(e.id, false);
    const before = store.get("capture", e.id, CaptureEpoch);
    assert.ok(before);
    // Reconcile a crash after asset commit and before capture-to-asset linkage.
    store.put("capture", e.id, {
      ...before,
      assetId: null,
      snapshotSequence: -1,
    });
    store.close();
    store = new SQLiteStore(join(dir, "db"));
    app = new Exchanges(store, media, "creator");
    captures = new Captures(store, files, (bytes, fixture, operationKey) =>
      app.ingest(bytes, fixture, operationKey),
    );
    captures.recover();
    assert.equal(captures.list()[0]?.state, "interrupted");
    const asset = await captures.snapshot(e.id, true);
    assert.equal(asset.id, snapshot.id);
    assert.equal(app.state().assets.length, 1);
    assert.ok(asset.audio);
    assert.ok(Math.abs(asset.duration - 4) < 0.2);
    assert.equal(asset.fixture, true);
    assert.equal((await captures.snapshot(e.id, true)).id, asset.id);
    await assert.rejects(() => stat(join(dir, "capture", e.id)));
    app.message({
      id: "m",
      sourceId: "m",
      userId: "u",
      author: "Fixture viewer",
      text: "Test message",
      source: "fixture",
      receivedAt: "2026-10-29",
      removed: false,
    });
    app.save("saved", {
      expectedVersion: 0,
      messageId: "m",
      assetId: asset.id,
      start: 0,
      end: 3,
      title: "Recovered fixture",
      captions: [],
    });
    await captures.discard(e.id);
    assert.ok(media.exists(app.latest("saved")?.assetId ?? ""));
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("failed chunk finalization never acknowledges saved data; corrupt chunks remain private", async () => {
  const dir = await mkdtemp(join(tmpdir(), "thatbit-capture-fault-"));
  const store = new SQLiteStore(join(dir, "db"));
  try {
    const files: CaptureFiles = {
      writeChunk: async () => {
        throw new Error("ENOSPC");
      },
      assemble: async () => Buffer.from("bad"),
      remove: async () => {},
    };
    const service = new Captures(store, files, async () => {
      throw new Error("corrupt");
    });
    const e = service.start(start);
    await assert.rejects(() => service.append(e.id, 0, Buffer.from("x"), 1, 0));
    assert.equal(service.list()[0]?.nextSequence, 0);
    service.interrupt(e.id);
    await assert.rejects(() => service.snapshot(e.id, true));
    await service.discard(e.id);
    const local = new LocalCaptureFiles(join(dir, "capture"));
    const real = new Captures(store, local, async () => {
      throw new Error("not valid media");
    });
    const next = real.start(start);
    await real.append(next.id, 0, Buffer.from("bytes"), 1, 0);
    await writeFile(join(dir, "capture", next.id, "0.chunk"), "corrupt");
    await assert.rejects(() => real.snapshot(next.id, true), /corrupt/);
    assert.equal(real.list().find((c) => c.id === next.id)?.assetId, null);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
