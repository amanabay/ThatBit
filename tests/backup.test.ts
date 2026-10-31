import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia, run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { Captures } from "../apps/server/src/application/capture.ts";
import { LocalCaptureFiles } from "../apps/server/src/adapters/capture/files.ts";
import {
  SourceTranscript,
  SuggestionSnapshot,
} from "../shared/contracts/assistance.ts";
import { Reviews } from "../apps/server/src/application/reviews.ts";
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
    const original = await app.ingest(bytes, true);
    app.message({
      id: "fixture-message",
      sourceId: "fixture-message",
      userId: "fixture",
      author: "Fixture",
      text: "Authored backup fixture",
      source: "fixture",
      removed: false,
      receivedAt: new Date().toISOString(),
    });
    const edit = {
      expectedVersion: 0,
      messageId: "fixture-message",
      assetId: original.id,
      start: 0,
      end: 1,
      title: "Approved backup fixture",
      captions: [{ start: 0, end: 1, text: "Caption fixture" }],
    };
    app.save("fixture-draft", edit);
    const transcript = SourceTranscript.parse({
      id: "original-asr",
      assetId: original.id,
      checksum: original.sha256,
      provider: "fixture",
      model: "fixture",
      start: 0,
      end: 1,
      segments: [
        { id: "sentence-0", start: 0, end: 1, text: "Raw ASR fixture" },
      ],
    });
    store.put("source-transcript", transcript.id, transcript);
    const snapshot = SuggestionSnapshot.parse({
      id: "fixture-draft",
      draftId: "fixture-draft",
      transcriptId: transcript.id,
      messageId: "fixture-message",
      evidenceIds: ["sentence-0"],
      evidence: "Raw ASR fixture",
      start: 0,
      end: 1,
      policy: "baseline-v1",
    });
    store.put("suggestion-snapshot", snapshot.id, snapshot);
    new Reviews(app).recordProposal(snapshot.id, {
      association: "correct",
      boundaries: "complete",
      transcript: "needs-correction",
      correctionSeconds: 5,
      notes: "Backup fixture assessment",
    });
    const publication = app.approve("fixture-draft", 1);
    await app.work();
    app.save("fixture-draft", {
      ...edit,
      expectedVersion: 1,
      title: "New private revision",
    });
    await writeFile(join(data, "twitch-token.json"), "PRIVATE_TOKEN_FIXTURE");
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
    assert.equal(
      app.publicReply(publication.id)?.title,
      "Approved backup fixture",
    );
    assert.equal(app.latest("fixture-draft")?.title, "New private revision");
    assert.deepEqual(
      store.get("source-transcript", transcript.id, SourceTranscript),
      transcript,
    );
    assert.deepEqual(
      store.get("suggestion-snapshot", snapshot.id, SuggestionSnapshot),
      snapshot,
    );
    assert.equal(
      new Reviews(app).exportProposals().examples[0]?.review.notes,
      "Backup fixture assessment",
    );
    await assert.rejects(stat(join(dest, "twitch-token.json")), {
      code: "ENOENT",
    });
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
