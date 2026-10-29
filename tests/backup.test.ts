import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia, run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { Captures } from "../apps/server/src/application/capture.ts";
import { LocalCaptureFiles } from "../apps/server/src/adapters/capture/files.ts";
test("backup command verifies and restores unfinished acknowledged recording chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "replylink-backup-capture-"));
  let store: SQLiteStore | undefined;
  try {
    const source = join(root, "fixture.webm");
    await run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=blue:size=160x90:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "2",
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
    const data = join(root, "live");
    store = new SQLiteStore(join(data, "replylink.sqlite"));
    let app = new Exchanges(
      store,
      new FFmpegMedia(join(data, "media")),
      "creator",
    );
    let capture = new Captures(
      store,
      new LocalCaptureFiles(join(data, "capture")),
      (bytes, fixture, key) => app.ingest(bytes, fixture, key),
    );
    const epoch = capture.start({
      mime: "video/webm",
      clientWallAt: "2026-10-29T00:00:00.000Z",
      clientMonotonicMs: 100,
      fixture: true,
    });
    const bytes = await readFile(source);
    await capture.append(epoch.id, 0, bytes, 2000, 0);
    store.close();
    store = undefined;
    const dest = join(root, "restored");
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/backup.ts", dest],
      { env: { ...process.env, DATA_DIR: data } },
    );
    assert.match(result.stdout, /verified/);
    assert.deepEqual(
      await readFile(join(dest, "capture", epoch.id, "0.chunk")),
      bytes,
    );
    store = new SQLiteStore(join(dest, "replylink.sqlite"));
    app = new Exchanges(store, new FFmpegMedia(join(dest, "media")), "creator");
    capture = new Captures(
      store,
      new LocalCaptureFiles(join(dest, "capture")),
      (b, f, k) => app.ingest(b, f, k),
    );
    capture.recover();
    const asset = await capture.snapshot(epoch.id, true);
    assert.ok(asset.audio);
    assert.ok(Math.abs(asset.duration - 2) < 0.2);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
