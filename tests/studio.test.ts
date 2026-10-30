import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { createServer } from "../apps/server/src/http/server.ts";
import type { Media } from "../apps/server/src/application/ports.ts";
import { StudioState } from "../shared/contracts/studio.ts";
import { Operations } from "../apps/server/src/application/operations.ts";

test("creator library retains exact approved metadata across edits/discard and OBS inspection remains authenticated and allowlisted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-studio-"));
  const store = new SQLiteStore(join(dir, "db"));
  const media: Media = {
    exists: () => true,
    source: () => "",
    derived: () => "",
    ingest: async () => {
      throw Error("unused");
    },
    render: async () => {},
    portrait: async () => {},
  };
  const app = new Exchanges(store, media, "fixture");
  store.put("asset", "asset", {
    id: "asset",
    duration: 10,
    bytes: 1,
    sha256: "fixture",
    audio: true,
    fixture: true,
    createdAt: "2026-10-30",
  });
  app.message({
    id: "message",
    sourceId: "source",
    author: "Fixture",
    userId: "fixture",
    source: "fixture",
    text: "Original fixture message",
    receivedAt: "2026-10-30",
    removed: false,
  });
  const edit = {
    expectedVersion: 0,
    messageId: "message",
    assetId: "asset",
    start: 0,
    end: 5,
    title: "Approved original",
    captions: [],
  };
  const revision = app.save("draft", edit),
    publication = app.approve("draft", 1);
  app.save("draft", {
    ...edit,
    expectedVersion: 1,
    title: "New private title",
    start: 1,
  });
  app.discard("draft");
  let fail = false,
    reads = 0;
  const server = await createServer(app, {
    port: 4317,
    production: true,
    operations: new Operations(store, async () => ({
      instanceId: "fixture-creator",
      rssBytes: 10,
      cpuUserMicros: 1,
      cpuSystemMicros: 1,
      uptimeSeconds: 1,
      diskFreeBytes: 10,
      ...{ privatePath: "PRIVATE_METRIC_PATH" },
    })),
    inspectObs: async () => {
      reads++;
      if (fail) throw Error("PRIVATE_DEVICE_PATH_PASSWORD");
      return {
        version: "32.1.1",
        splitSupported: true,
        recording: false,
        paused: false,
        durationMs: 0,
        inputKinds: [],
        visibleSourceKinds: [],
        windowCaptureAvailable: false,
        audioInputs: [
          {
            kind: "pulse_input_capture",
            muted: true,
            volumeMul: 1,
            enabledTracks: [1],
          },
        ],
        ...{ privateSourceName: "PRIVATE_SOURCE_NAME" },
      };
    },
  });
  try {
    const unauth = await server.inject({
      url: "/api/creator/obs/inspect",
      headers: { host: "localhost:4317" },
    });
    assert.equal(unauth.statusCode, 401);
    assert.equal(reads, 0);
    const session = await server.inject({
      url: "/api/creator/session",
      headers: { host: "localhost:4317" },
    });
    const headers = {
      host: "localhost:4317",
      "x-creator-token": session.json().token as string,
    };
    const state = StudioState.parse(
      (await server.inject({ url: "/api/creator/state", headers })).json(),
    );
    assert.equal(state.drafts.length, 0);
    assert.deepEqual(state.publicationContent, [
      {
        publicationId: publication.id,
        revisionId: revision.id,
        draftId: "draft",
        title: "Approved original",
        version: 1,
        messageId: "message",
        start: 0,
        end: 5,
      },
    ]);
    const inspected = await server.inject({
      url: "/api/creator/obs/inspect",
      headers,
    });
    assert.equal(inspected.statusCode, 200);
    assert.equal(inspected.json().audioInputs[0].muted, true);
    assert.ok(!inspected.body.includes("PRIVATE_"));
    fail = true;
    const failed = await server.inject({
      url: "/api/creator/obs/inspect",
      headers,
    });
    assert.equal(failed.statusCode, 409);
    assert.ok(!failed.body.includes("PRIVATE_"));
    const publicAttempt = await server.inject({
      url: "/api/public/obs/inspect",
      headers: { host: "localhost:4317" },
    });
    assert.equal(publicAttempt.statusCode, 404);
    const note = {
      association: "correct",
      boundaries: "complete",
      notes: "Fixture review, not human acceptance",
    };
    const unauthReview = await server.inject({
      url: "/api/creator/reviews/export",
      headers: { host: "localhost:4317" },
    });
    assert.equal(unauthReview.statusCode, 401);
    for (const notes of ["Initial fixture note", note.notes]) {
      const result = await server.inject({
        method: "POST",
        url: "/api/creator/reviews/" + revision.id,
        headers,
        payload: { ...note, notes },
      });
      assert.equal(result.statusCode, 200);
      assert.equal(result.json().review.revisionId, revision.id);
    }
    const exported = await server.inject({
      url: "/api/creator/reviews/export",
      headers,
    });
    assert.equal(exported.json().summary.reviewedRevisions, 1);
    assert.equal(
      exported.json().examples[0].revision.title,
      "Approved original",
    );
    assert.equal(exported.json().examples[0].review.notes, note.notes);
    assert.match(exported.headers["content-disposition"] ?? "", /attachment/);
    assert.equal(app.state().publications[0]?.revisionId, revision.id);
    const telemetry = await server.inject({
      url: "/api/creator/operations",
      headers,
    });
    assert.equal(telemetry.statusCode, 200);
    assert.ok(!telemetry.body.includes("PRIVATE_"));
    assert.equal(telemetry.json().queues.render, 1);
    assert.equal(
      (
        await server.inject({
          url: "/api/creator/operations",
          headers: { host: "localhost:4317" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await server.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
