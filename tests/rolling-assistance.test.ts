import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia, run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { assembleSegments } from "../apps/server/src/adapters/obs/assemble.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { ObsBuffer } from "../apps/server/src/application/obs-buffer.ts";
import { Assistance } from "../apps/server/src/application/assistance.ts";
import { Retention } from "../apps/server/src/application/retention.ts";
import { Asset, Revision } from "../shared/contracts/models.ts";
import { AutoJob } from "../shared/contracts/assistance.ts";
import { z } from "zod";

test("rolling assistance protects both closed segments, retains a joined source through restart, and deduplicates overlap without publication (provider fixture)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-rolling-"));
  let store = new SQLiteStore(join(dir, "db"));
  try {
    const media = new FFmpegMedia(join(dir, "media"));
    let app = new Exchanges(store, media, "fixture");
    const assets: Asset[] = [];
    for (const color of ["red", "blue", "yellow"]) {
      const file = join(dir, "generated.webm");
      await run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=${color}:size=160x90:rate=10`,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440",
        "-t",
        "2",
        "-c:v",
        "libvpx-vp9",
        "-threads",
        "2",
        "-deadline",
        "realtime",
        "-c:a",
        "libopus",
        "-y",
        file,
      ]);
      const asset = await app.ingest(await readFile(file), true);
      store.put("obs-segment", asset.id, {
        id: asset.id,
        epoch: "fixture-epoch",
        sequence: assets.length,
        savedAt: 0,
      });
      assets.push(asset);
    }
    const [first, second, third] = assets;
    assert.ok(first && second && third);
    store.put("obs-segment", third.id, {
      id: third.id,
      epoch: "fixture-epoch",
      sequence: 2,
      savedAt: 999999999,
    });
    app.message({
      id: "message",
      sourceId: "fixture-message",
      author: "Fixture",
      userId: "fixture",
      source: "fixture",
      text: "Generated cross-segment provider fixture, not speech recognition",
      receivedAt: second.createdAt,
      removed: false,
    });
    let buffer = new ObsBuffer(app, (ids) =>
      assembleSegments(ids, (id) => media.source(id), join(dir, "scratch")),
    );
    let failFirst = true;
    const provider = {
      name: "fixture",
      model: "fixture",
      transcribe: async (source: string) => {
        const probe = await media.inspect(source);
        assert.ok(
          probe.format.duration > 3.9,
          "provider receives both real video/audio segments",
        );
        if (failFirst) {
          failFirst = false;
          throw new Error("Transient provider fixture failure");
        }
        return [{ start: 1, end: 3, text: "Fixture evidence spans the split" }];
      },
    };
    const matcher = async () => [
      {
        messageId: "message",
        start: 1,
        end: 3,
        evidence: "Fixture evidence spans the split",
      },
    ];
    let assistance = new Assistance(app, provider, matcher, (ids) =>
      buffer.snapshot(ids),
    );
    assistance.queue(second, buffer.recent(second.id));
    const removed: string[] = [];
    await new Retention(
      store,
      async (id) => {
        removed.push(id);
      },
      () => 999999999,
    ).work();
    assert.ok(
      !removed.includes(first.id) && !removed.includes(second.id),
      "queued windows pin every input",
    );
    assert.deepEqual(buffer.recent(second.id), [first.id, second.id]);
    store.close();
    store = new SQLiteStore(join(dir, "db"));
    app = new Exchanges(store, media, "fixture");
    buffer = new ObsBuffer(app, (ids) =>
      assembleSegments(ids, (id) => media.source(id), join(dir, "scratch")),
    );
    assistance = new Assistance(app, provider, matcher, (ids) =>
      buffer.snapshot(ids),
    );
    await assistance.work();
    const retry = store.get("auto-job", second.id, AutoJob);
    assert.ok(retry?.preparedAssetId);
    assert.equal(retry.state, "queued");
    store.put("auto-job", second.id, { ...retry, nextAttempt: 0 });
    store.close();
    store = new SQLiteStore(join(dir, "db"));
    app = new Exchanges(store, media, "fixture");
    buffer = new ObsBuffer(app, (ids) =>
      assembleSegments(ids, (id) => media.source(id), join(dir, "scratch")),
    );
    assistance = new Assistance(app, provider, matcher, async () => {
      throw Error("Prepared source must be reused after restart");
    });
    await assistance.work();
    const draft = app.state().drafts[0];
    assert.ok(draft);
    assert.notEqual(draft.assetId, first.id);
    assert.notEqual(draft.assetId, second.id);
    assert.ok(draft.end > 3.9);
    assert.equal(draft.captions[0]?.end, 3);
    assert.equal(app.state().suggestionProvenance[0]?.sourceAssetIds.length, 2);
    assert.equal(app.state().publications.length, 0);
    assert.equal(store.get("auto-job", second.id, AutoJob)?.state, "completed");
    app.discard(draft.draftId);
    assistance = new Assistance(app, provider, matcher, (ids) =>
      buffer.snapshot(ids),
    );
    assistance.queue(third, buffer.recent(third.id));
    await assistance.work();
    assert.equal(
      store.list("revision", Revision).length,
      1,
      "discarded suggestions are not regenerated by overlapping windows",
    );
    for (const row of store.list(
      "analysis-source",
      z.object({ id: z.string(), savedAt: z.number() }),
    )) {
      store.put("analysis-source", row.id, { id: row.id, savedAt: 0 });
    }
    removed.length = 0;
    await new Retention(
      store,
      async (id) => {
        removed.push(id);
      },
      () => 999999999,
    ).work();
    assert.ok(
      !removed.includes(draft.assetId),
      "immutable draft revision retains its independent assembled source",
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
