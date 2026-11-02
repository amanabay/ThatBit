import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, rename, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFmpegMedia, run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { Revision } from "../shared/contracts/models.ts";
test("actual FFmpeg trim, durable restart, stale approval, fencing, captions and public allowlist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink media's [fixture], "));
  let store = new SQLiteStore(join(dir, "db"));
  try {
    const fixtureMessage =
      "Show me that? https://fixture.example/" + "path".repeat(35) + " %{pts}";
    const media = new FFmpegMedia(join(dir, "media"));
    let app = new Exchanges(store, media, "creator");
    const fixture = join(dir, "input.webm");
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
      "-cpu-used",
      "8",
      "-threads",
      "2",
      "-c:a",
      "libopus",
      "-y",
      fixture,
    ]);
    const a = await app.ingest(await readFile(fixture), true);
    app.message({
      id: "m",
      sourceId: "source",
      userId: "viewer",
      author: "Mira",
      text: fixtureMessage,
      receivedAt: "2026-10-29T00:00:00Z",
      source: "fixture",
      removed: false,
    });
    const r = app.save("draft", {
      expectedVersion: 0,
      messageId: "m",
      assetId: a.id,
      start: 1,
      end: 3,
      title: "Actual trim",
      captions: [{ start: 0, end: 1, text: "Tone fixture" }],
    });
    assert.throws(() => app.approve("draft", 0));
    assert.throws(() => app.save("draft", { ...r, expectedVersion: 0 }));
    assert.throws(() =>
      app.save("draft", { ...r, expectedVersion: 1, end: 50 }),
    );
    const p = app.approve("draft", 1);
    assert.equal(app.publicReply(p.id), undefined);
    store.close();
    store = new SQLiteStore(join(dir, "db"));
    app = new Exchanges(store, media, "creator");
    assert.equal(app.latest("draft")?.assetId, a.id);
    app.recover();
    await app.work();
    const dto = app.publicReply(p.id);
    assert.equal(dto?.duration, 2);
    assert.equal(dto?.message, fixtureMessage);
    assert.equal("assetId" in (dto ?? {}), false);
    const probe = await media.inspect(media.derived(p.id, "video"));
    assert.ok(Math.abs(probe.format.duration - 2) < 0.2);
    await app.portrait(p.id);
    const portrait = await media.inspect(media.derived(p.id, "portrait"));
    assert.ok(Math.abs(portrait.format.duration - 2) < 0.2);
    await run("ffmpeg", [
      "-v",
      "error",
      "-i",
      media.derived(p.id, "portrait"),
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      join(tmpdir(), "replylink-audit-portrait.png"),
    ]);
    const preserved = await readFile(media.derived(p.id, "portrait"));
    const produce = media.portrait.bind(media);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    media.portrait = async (...args) => {
      await held;
      await produce(...args);
    };
    const exportInFlight = app.portrait(p.id);
    await assert.rejects(() => app.portrait(p.id), /already running/);
    release();
    await exportInFlight;
    media.portrait = produce;
    const latestExport = await readFile(media.derived(p.id, "portrait"));
    const videoPath = media.derived(p.id, "video");
    await rename(videoPath, videoPath + ".offline");
    try {
      await assert.rejects(() => app.portrait(p.id));
    } finally {
      await rename(videoPath + ".offline", videoPath);
    }
    assert.deepEqual(
      await readFile(media.derived(p.id, "portrait")),
      latestExport,
    );
    assert.ok(preserved.length > 0);
    assert.equal(
      (await readdir(join(dir, "media"))).some(
        (name) =>
          /\.(?:vtt|txt|tmp)$/.test(name) || name.startsWith("portrait-"),
      ),
      false,
    );
    const revised = app.save("draft", {
      ...r,
      expectedVersion: 1,
      title: "New private revision",
    });
    assert.equal(revised.version, 2);
    assert.equal(app.publicReply(p.id)?.title, "Actual trim");
    const renamed = new Exchanges(store, media, "different-login");
    assert.equal(renamed.publicReply(p.id)?.creator, "creator");
    assert.ok(store.get("revision", r.id, Revision));
    app.removeMessage("source");
    assert.equal(app.publicReply(p.id), undefined);
    await app.work();
    assert.equal(app.publicReply(p.id), undefined);
    assert.throws(() => app.approve("draft", 2));
    await assert.rejects(() => app.ingest(Buffer.from("corrupt")));
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
