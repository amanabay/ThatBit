import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { Intelligence } from "../apps/server/src/application/intelligence.ts";
import { Assistance } from "../apps/server/src/application/assistance.ts";
import { Reviews } from "../apps/server/src/application/reviews.ts";
import { Retention } from "../apps/server/src/application/retention.ts";
import type { Media } from "../apps/server/src/application/ports.ts";
import {
  SourceTranscript,
  SuggestionSnapshot,
  AutoJob,
} from "../shared/contracts/assistance.ts";
import {
  responseRange,
  evidenceSpans,
} from "../apps/server/src/domain/response-range.ts";
const media: Media = {
  exists: () => true,
  source: (id) => id,
  derived: (id) => id,
  ingest: async () => {
    throw Error("unused");
  },
  render: async () => {},
  portrait: async () => {},
};
test("cancellation during assembly fences draft creation and leaves the unused prepared source eligible for retention", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-assembly-cancel-"));
  const store = new SQLiteStore(join(root, "db"));
  const app = new Exchanges(store, media, "fixture");
  const asset = {
    id: "head",
    duration: 10,
    bytes: 1,
    sha256: "fixture",
    audio: true,
    fixture: true,
    createdAt: new Date().toISOString(),
  };
  for (const id of ["head", "tail", "prepared"])
    store.put("asset", id, { ...asset, id });
  let finish: (value: typeof asset) => void = () => {};
  const provider = {
    name: "fixture",
    model: "fixture",
    transcribe: async () => {
      throw Error("Cancelled job must not transcribe");
    },
  };
  const assistance = new Assistance(
    app,
    provider,
    async () => [],
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    assistance.queue({ ...asset, id: "tail" }, ["head", "tail"]);
    const pending = assistance.work();
    assistance.control("tail", 1, "cancel");
    finish({ ...asset, id: "prepared" });
    await pending;
    assert.equal(store.get("auto-job", "tail", AutoJob)?.state, "cancelled");
    assert.equal(app.state().drafts.length, 0);
    const removed: string[] = [];
    await new Retention(
      store,
      async (id) => {
        removed.push(id);
      },
      () => Date.now() + 16 * 60000,
    ).work();
    assert.deepEqual(removed, ["prepared"]);
    assert.deepEqual(
      app.state().assets.map((a) => a.id),
      ["head", "tail"],
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("original ASR and proposals survive corrections; multiple automatic drafts commit atomically, cancellation fences late work", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-evidence-"));
  const store = new SQLiteStore(join(root, "db"));
  const app = new Exchanges(store, media, "fixture");
  const asset = {
    id: "asset",
    duration: 30,
    bytes: 1,
    sha256: "fixture",
    audio: true,
    fixture: true,
    createdAt: new Date().toISOString(),
  };
  store.put("asset", asset.id, asset);
  for (let i = 0; i < 3; i++)
    app.message({
      id: "m" + i,
      sourceId: "s" + i,
      userId: "u" + i,
      source: "fixture",
      author: "Fixture" + i,
      text: "Original fixture message " + i,
      receivedAt: asset.createdAt,
      removed: false,
    });
  const segments = [
    { start: 2, end: 4, text: "Fixture0 explains types." },
    { start: 6, end: 8, text: "Fixture1 explains loops." },
    { start: 10, end: 12, text: "Fixture2 explains arrays." },
  ];
  let calls = 0;
  const provider = {
    name: "fixture",
    model: "fixture",
    fingerprint: "fixed-fixture",
    transcribe: async () => {
      calls++;
      return segments;
    },
  };
  const matcher = async () =>
    segments.map((s, i) => ({
      messageId: "m" + i,
      start: s.start,
      end: s.end,
      evidence: s.text,
    }));
  try {
    const assistance = new Assistance(app, provider, matcher, undefined, true);
    assistance.queue(asset);
    await assistance.work();
    assert.equal(app.state().drafts.length, 3);
    assert.equal(app.state().publications.length, 0);
    const original = store.list("source-transcript", SourceTranscript)[0];
    assert.ok(original);
    assert.equal(calls, 1);
    const draft = app.state().drafts[0];
    assert.ok(draft);
    app.save(draft.draftId, {
      ...draft,
      expectedVersion: draft.version,
      captions: [],
      title: "Corrected fixture draft",
    });
    assert.deepEqual(
      store.list("source-transcript", SourceTranscript)[0],
      original,
    );
    const snapshot = store
      .list("suggestion-snapshot", SuggestionSnapshot)
      .find((s) => s.draftId === draft.draftId);
    assert.ok(snapshot);
    const reviews = new Reviews(app);
    for (const notes of [
      "Initial fixture assessment",
      "Updated fixture assessment",
    ])
      reviews.recordProposal(snapshot.id, {
        association: "correct",
        boundaries: "complete",
        transcript: "needs-correction",
        correctionSeconds: 12,
        notes,
      });
    reviews.record(app.latest(draft.draftId)?.id ?? "", {
      association: "unsure",
      boundaries: "unsure",
      notes: "Different corrected revision assessment",
    });
    const proposalExport = reviews.exportProposals();
    assert.equal(proposalExport.examples.length, 1);
    assert.equal(
      proposalExport.examples[0]?.snapshot.evidence,
      snapshot.evidence,
    );
    assert.deepEqual(proposalExport.examples[0]?.transcript, original);
    assert.equal(
      proposalExport.examples[0]?.review.notes,
      "Updated fixture assessment",
    );
    assert.equal(proposalExport.examples[0]?.review.correctionSeconds, 12);
    assert.equal(
      reviews.export().examples[0]?.revision.title,
      "Corrected fixture draft",
    );
    assert.equal(
      store.list("suggestion-snapshot", SuggestionSnapshot).length,
      3,
    );
    const other = { ...asset, id: "cancelled" };
    store.put("asset", other.id, other);
    let release: (v: unknown) => void = () => {};
    const slow = new Assistance(
      app,
      {
        ...provider,
        transcribe: () =>
          new Promise((r) => {
            release = r;
          }),
      },
      matcher,
    );
    slow.queue(other);
    const work = slow.work();
    slow.control(other.id, 1, "cancel");
    release(segments);
    await work;
    assert.equal(store.get("auto-job", other.id, AutoJob)?.state, "cancelled");
    assert.equal(app.state().drafts.length, 3);
    const failed = { ...asset, id: "rollback" };
    store.put("asset", failed.id, failed);
    // One removed message invalidates the entire proposed batch, including earlier valid proposals.
    // Existing original messages are deduped, so use fresh source identities for this batch.
    for (let i = 0; i < 3; i++)
      app.message({
        id: "n" + i,
        sourceId: "n-source" + i,
        userId: "n" + i,
        source: "fixture",
        author: "NewFixture" + i,
        text: "New fixture",
        receivedAt: asset.createdAt,
        removed: false,
      });
    const rollback = new Assistance(
      app,
      provider,
      async () => {
        app.removeMessage("n-source1");
        return (await matcher()).map((s, i) => ({ ...s, messageId: "n" + i }));
      },
      undefined,
      true,
    );
    rollback.queue(failed);
    await rollback.work();
    assert.equal(app.state().drafts.length, 3);
    assert.equal(store.get("auto-job", failed.id, AutoJob)?.state, "queued");
    const cachedAsset = { ...asset, id: "cache-retry" };
    store.put("asset", cachedAsset.id, cachedAsset);
    let failMatch = true;
    const caching = new Assistance(app, provider, async () => {
      if (failMatch) {
        failMatch = false;
        throw Error("Transient fixture matcher failure");
      }
      return [];
    });
    caching.queue(cachedAsset);
    await caching.work();
    const count = calls;
    const cachedJob = store.get("auto-job", cachedAsset.id, AutoJob);
    assert.ok(cachedJob);
    store.put("auto-job", cachedAsset.id, { ...cachedJob, nextAttempt: 0 });
    await caching.work();
    assert.equal(
      calls,
      count,
      "completed verified-model ASR reused after matching failure",
    );
    assert.equal(
      store.get("auto-job", cachedAsset.id, AutoJob)?.outcome,
      "abstained",
    );
    app.save("manual-cached", {
      expectedVersion: 0,
      messageId: "m0",
      assetId: asset.id,
      start: 0,
      end: 30,
      title: "Cached source review",
      captions: [],
    });
    const manual = new Intelligence(store, media, provider);
    const manualJob = manual.enqueue("manual-cached", 1);
    const beforeManual = calls;
    await manual.work();
    assert.equal(
      calls,
      beforeManual,
      "manual exact-range transcription shares validated original ASR cache",
    );
    assert.equal(manual.result(manualJob.id).job?.state, "completed");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("context spans preserve order and stop at pauses; range captions stay relative and complete", () => {
  const s = [
    { start: 0, end: 2, text: "Lead" },
    { start: 3, end: 5, text: "Answer" },
    { start: 6, end: 8, text: "Context" },
    { start: 20, end: 22, text: "Other" },
  ];
  assert.ok(evidenceSpans(s).some((v) => v.text === "Lead Answer Context"));
  assert.ok(!evidenceSpans(s).some((v) => v.text.includes("Context Other")));
  const r = responseRange(s, 3, 5, 25);
  assert.equal(r.start, 0);
  assert.equal(r.end, 10);
  assert.deepEqual(r.captions, s.slice(0, 3));
  assert.throws(() => responseRange(s, 3, 7, 25));
});

test("private waveform streams bounded peaks from generated tone and silence", async () => {
  const { waveform } =
    await import("../apps/server/src/adapters/media/waveform.ts");
  const { run } = await import("../apps/server/src/adapters/media/ffmpeg.ts");
  const root = await mkdtemp(join(tmpdir(), "thatbit-waveform-"));
  try {
    for (const filter of [
      "sine=frequency=440:sample_rate=8000",
      "anullsrc=r=8000:cl=mono",
    ]) {
      const file = join(root, "fixture.wav");
      await run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        filter,
        "-t",
        "1",
        "-y",
        file,
      ]);
      const result = await waveform(file, 1);
      assert.ok(result.peaks.length <= 2048);
      assert.equal(
        result.status,
        filter.startsWith("sine") ? "signal-present" : "silent",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
