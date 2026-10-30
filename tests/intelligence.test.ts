import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import {
  Intelligence,
  type TranscriptionProvider,
} from "../apps/server/src/application/intelligence.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import type { Media } from "../apps/server/src/application/ports.ts";
import { AnalysisJob, Transcript } from "../shared/contracts/intelligence.ts";
import { transcribe } from "../apps/server/src/adapters/transcription/whisper.ts";
import { run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { TranscriptionAudioError } from "../apps/server/src/application/transcription-error.ts";
const media: Media = {
  exists: () => true,
  source: (id) => id,
  derived: (id) => id,
  render: async () => {},
  portrait: async () => {},
  ingest: async () => {
    throw new Error("not used");
  },
};
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "replylink-analysis-"));
  const store = new SQLiteStore(join(dir, "db"));
  const app = new Exchanges(store, media, "creator");
  store.put("asset", "asset", {
    id: "asset",
    duration: 600,
    bytes: 1,
    sha256: "hash",
    audio: true,
    createdAt: "2026-10-29",
    fixture: true,
  });
  app.message({
    id: "message",
    sourceId: "source",
    userId: "viewer",
    author: "Mira",
    text: "How does water work?",
    receivedAt: "2026-10-29",
    source: "fixture",
    removed: false,
  });
  const edit = {
    expectedVersion: 0,
    messageId: "message",
    assetId: "asset",
    start: 310,
    end: 320,
    title: "Late answer",
    captions: [],
  };
  const revision = app.save("draft", edit);
  return { dir, store, app, revision, edit };
}
test("analysis is durably queued, deduped by exact revision, survives reopen, and preserves selected interval", async () => {
  const f = await setup();
  let store = f.store;
  try {
    let seen: { start: number; end: number } | undefined;
    const provider: TranscriptionProvider = {
      name: "fixture",
      model: "fixture-v1",
      transcribe: async (_source, interval) => {
        seen = interval;
        return [
          { start: 311, end: 314, text: "Mira, water uses alpha blending." },
        ];
      },
    };
    let service = new Intelligence(store, media, provider);
    const j = service.enqueue("draft", 1);
    assert.equal(service.enqueue("draft", 1).id, j.id);
    assert.throws(() => service.enqueue("draft", 2));
    store.close();
    store = new SQLiteStore(join(f.dir, "db"));
    service = new Intelligence(store, media, provider);
    service.recover();
    await service.work();
    assert.deepEqual(seen, { start: 310, end: 320 });
    assert.equal(service.result(j.id).job?.state, "completed");
    assert.equal(service.result(j.id).suggestions[0]?.messageId, "message");
    const app = new Exchanges(store, media, "creator");
    app.save("draft", { ...f.edit, expectedVersion: 1, start: 315 });
    assert.equal(service.result(j.id).stale, true);
    assert.equal(
      service.result(j.id).transcript?.sourceRevisionId,
      f.revision.id,
    );
    assert.equal(app.state().publications.length, 0);
    store.close();
    store = new SQLiteStore(join(f.dir, "db"));
    assert.equal(
      new Intelligence(store, media, undefined).result(j.id).transcript
        ?.segments[0]?.start,
      311,
    );
  } finally {
    store.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("cancel and restart fence in-flight results; malformed output is private and cannot retry indefinitely", async () => {
  const f = await setup();
  try {
    let complete: (value: unknown) => void = () => {};
    const provider: TranscriptionProvider = {
      name: "fixture",
      model: "fixture",
      transcribe: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    };
    const service = new Intelligence(f.store, media, provider);
    const j = service.enqueue("draft", 1);
    const work = service.work();
    service.cancel(j.id);
    complete([{ start: 311, end: 312, text: "cancelled" }]);
    await work;
    assert.equal(service.result(j.id).job?.state, "cancelled");
    assert.equal(f.store.list("transcript", Transcript).length, 0);
    service.enqueue("draft", 1);
    const again = service.work();
    const recovered = new Intelligence(f.store, media, provider);
    recovered.recover();
    complete([{ start: 311, end: 312, text: "stale worker" }]);
    await again;
    assert.equal(service.result(j.id).job?.state, "queued");
    const invalid = new Intelligence(f.store, media, {
      name: "fixture",
      model: "fixture",
      transcribe: async () => [{ start: 0, end: 1, text: "wrong interval" }],
    });
    await invalid.work();
    assert.equal(invalid.result(j.id).job?.state, "failed");
    assert.match(invalid.result(j.id).job?.error ?? "", /invalid/);
    assert.equal(f.store.list("transcript", Transcript).length, 0);
    service.enqueue("draft", 1);
    let now = 1;
    const failing = new Intelligence(
      f.store,
      media,
      {
        name: "fixture",
        model: "fixture",
        transcribe: async () => {
          throw new Error("secret must never appear");
        },
      },
      () => now,
    );
    for (let i = 0; i < 3; i++) {
      await failing.work();
      now += 30000;
    }
    assert.equal(failing.result(j.id).job?.state, "failed");
    assert.equal(failing.result(j.id).job?.attempts, 3);
    assert.ok(!JSON.stringify(failing.result(j.id)).includes("secret"));
    const current = f.store.get("analysis-job", j.id, AnalysisJob);
    assert.ok(current);
    f.store.put("analysis-job", j.id, { ...current, state: "queued" });
    f.app.discard("draft");
    await failing.work();
    assert.equal(failing.result(j.id).job?.state, "cancelled");
  } finally {
    f.store.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("Whisper adapter extracts selected audio, bounds padded timestamps and converts offsets into source seconds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-whisper-"));
  try {
    const source = join(dir, "source.webm");
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
    const bin = join(dir, "fixture-cli.mjs");
    const model = join(dir, "fixture-model");
    await writeFile(
      bin,
      `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';const a=process.argv;const wav=a[a.indexOf('-f')+1];const model=a[a.indexOf('-m')+1];writeFileSync(model+'.observed',spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',wav]).stdout);writeFileSync(wav+'.json',JSON.stringify({transcription:[{offsets:{from:0,to:1000},text:'fixture transcript, not real inference'},{offsets:{from:1000,to:2540},text:'final sentence extends into model padding'},{offsets:{from:2000,to:3000},text:'entirely in padding, must not appear'}]}));`,
      { mode: 0o700 },
    );
    const segments = await transcribe(source, dir, bin, model, {
      start: 2,
      end: 3.5,
    });
    assert.equal(segments[0]?.start, 2);
    assert.equal(segments[0]?.end, 3);
    assert.equal(segments.length, 2);
    assert.equal(segments[1]?.start, 3);
    assert.equal(segments[1]?.end, 3.5);
    const probe = JSON.parse(await readFile(model + ".observed", "utf8"));
    assert.ok(Math.abs(Number(probe.format.duration) - 1.5) < 0.05);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Whisper rejects missing/silent audio before inference, preserves quiet and late signal, and cleans temporary files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-silent-"));
  try {
    const source = join(dir, "source.webm");
    const bin = join(dir, "fixture-cli.mjs");
    const observed = join(dir, "inference-called");
    await writeFile(
      bin,
      `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';const args=process.argv;writeFileSync(${JSON.stringify(observed)},'fixture');writeFileSync(args[args.indexOf('-f')+1]+'.json',JSON.stringify({transcription:[]}));`,
      { mode: 0o700 },
    );
    for (const audio of [
      null,
      "anullsrc=r=16000:cl=mono",
      "sine=frequency=440:sample_rate=16000,volume=0.001",
      "aevalsrc=if(lt(t\\,1)\\,0\\,0.01*sin(440*2*PI*t)):s=16000",
    ]) {
      await rm(observed, { force: true });
      await run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=blue:size=160x90:rate=10",
        ...(audio ? ["-f", "lavfi", "-i", audio] : []),
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
      const result = transcribe(source, dir, bin, "fixture-model", {
        start: 0,
        end: 2,
      });
      if (audio === null || audio.startsWith("anullsrc")) {
        await assert.rejects(
          result,
          (error: unknown) =>
            error instanceof TranscriptionAudioError &&
            error.code ===
              (audio === null
                ? "MEDIA_AUDIO_TRACK_MISSING"
                : "MEDIA_AUDIO_SILENT"),
        );
        await assert.rejects(readFile(observed));
      } else {
        assert.deepEqual(await result, []);
        assert.equal(await readFile(observed, "utf8"), "fixture");
      }
      assert.ok(
        !(await readdir(dir)).some(
          (name) => name.endsWith(".wav") || name.endsWith(".wav.json"),
        ),
      );
    }
    // A tone outside the selected interval cannot make a silent selection pass.
    await run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(lt(t\\,1)\\,sin(440*2*PI*t)\\,0):s=16000",
      "-t",
      "3",
      "-y",
      join(dir, "interval.wav"),
    ]);
    await assert.rejects(
      transcribe(join(dir, "interval.wav"), dir, bin, "fixture-model", {
        start: 1.5,
        end: 2.5,
      }),
      (error: unknown) =>
        error instanceof TranscriptionAudioError &&
        error.code === "MEDIA_AUDIO_SILENT",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("silent-audio analysis fails once with actionable feedback and no fabricated transcript or publication", async () => {
  const f = await setup();
  try {
    let attempts = 0;
    const service = new Intelligence(f.store, media, {
      name: "fixture",
      model: "fixture",
      transcribe: async () => {
        attempts++;
        throw new TranscriptionAudioError("silent");
      },
    });
    const job = service.enqueue("draft", 1);
    await service.work();
    await service.work();
    assert.equal(attempts, 1);
    const result = service.result(job.id);
    assert.equal(result.job?.state, "failed");
    assert.match(result.job?.error ?? "", /silent audio.*OBS microphone mute/);
    assert.equal(result.transcript, null);
    assert.equal(f.app.state().publications.length, 0);
  } finally {
    f.store.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("media subprocess cancellation terminates work rather than merely hiding its result", async () => {
  const controller = new AbortController();
  const work = run(
    process.execPath,
    ["-e", "setTimeout(()=>{},60000)"],
    10000,
    controller.signal,
  );
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    work,
    (e: unknown) => e instanceof Error && e.name === "AbortError",
  );
});
