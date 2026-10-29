import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { Assistance } from "../apps/server/src/application/assistance.ts";
import { Retention } from "../apps/server/src/application/retention.ts";
import { Asset } from "../shared/contracts/models.ts";
import type { Media } from "../apps/server/src/application/ports.ts";
test("automatic suggestions remain private and retention preserves referenced sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-auto-"));
  const store = new SQLiteStore(join(dir, "db"));
  try {
    const media: Media = {
      exists: () => true,
      source: (id) => id,
      derived: (id) => id,
      render: async () => {},
      portrait: async () => {},
      ingest: async () => {
        throw new Error("unused");
      },
    };
    const app = new Exchanges(store, media, "creator");
    const a: Asset = {
      id: "asset",
      duration: 30,
      bytes: 1,
      sha256: "hash",
      audio: true,
      createdAt: new Date().toISOString(),
      fixture: true,
    };
    store.put("asset", a.id, a);
    app.message({
      id: "message",
      sourceId: "source",
      userId: "user",
      text: "How does this code work?",
      author: "fixture",
      receivedAt: new Date().toISOString(),
      source: "fixture",
      removed: false,
    });
    const service = new Assistance(
      app,
      {
        name: "fixture",
        model: "fixture",
        transcribe: async () => [
          { start: 0, end: 2, text: "Actual fixture excerpt" },
        ],
      },
      async () => [
        {
          messageId: "message",
          start: 0,
          end: 2,
          evidence: "Actual fixture excerpt",
        },
      ],
    );
    service.queue(a);
    await service.work();
    assert.equal(app.state().drafts.length, 1);
    assert.equal(app.state().publications.length, 0);
    store.put("obs-segment", a.id, { id: a.id, savedAt: 0 });
    store.put("asset", "unreferenced", { ...a, id: "unreferenced" });
    store.put("obs-segment", "unreferenced", {
      id: "unreferenced",
      savedAt: 0,
    });
    const removed: string[] = [];
    await new Retention(
      store,
      async (id) => {
        removed.push(id);
      },
      () => 99999999,
    ).work();
    assert.deepEqual(removed, ["unreferenced"]);
    assert.ok(store.get("asset", a.id, Asset));
    assert.equal(store.get("asset", "unreferenced", Asset), undefined);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
