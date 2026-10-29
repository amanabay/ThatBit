import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { Asset, Message, Publication } from "../shared/contracts/models.ts";
import type { Media } from "../apps/server/src/application/ports.ts";
test("withdrawal fences a running job, source deletion tombstones, failed saves and bounded retries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-recovery-"));
  const store = new SQLiteStore(join(dir, "db"));
  try {
    let finish: () => void = () => {};
    let fail = false;
    const media: Media = {
      ingest: async () => {
        throw new Error("ENOSPC");
      },
      exists: () => true,
      source: () => "",
      derived: () => "",
      portrait: async () => {},
      render: async () => {
        if (fail) throw new Error("corrupt");
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    };
    const app = new Exchanges(store, media, "creator");
    const asset: Asset = {
      id: "a",
      duration: 10,
      bytes: 20,
      sha256: "hash",
      audio: true,
      fixture: true,
      createdAt: "2026-10-29",
    };
    store.put("asset", "a", asset);
    const m: Message = {
      id: "m",
      sourceId: "source",
      userId: "u",
      author: "Viewer",
      text: "hello",
      source: "fixture",
      receivedAt: "2026-10-29",
      removed: false,
    };
    app.message(m);
    app.removeMessage("late-source");
    app.message({ ...m, id: "late", sourceId: "late-source" });
    assert.equal(store.get("message", "late", Message)?.removed, true);
    const edit = {
      expectedVersion: 0,
      messageId: "m",
      assetId: "a",
      start: 1,
      end: 3,
      title: "Test",
      captions: [],
    };
    app.save("draft", edit);
    const p = app.approve("draft", 1);
    const work = app.work();
    assert.equal(
      store.get("publication", p.id, Publication)?.state,
      "rendering",
    );
    app.remove(p.id);
    finish();
    await work;
    assert.equal(store.get("publication", p.id, Publication)?.state, "removed");
    assert.equal(app.publicReply(p.id), undefined);
    await assert.rejects(() => app.ingest(Buffer.from("upload")));
    assert.equal(app.state().assets.length, 1);
    app.save("retry", edit);
    const q = app.approve("retry", 1);
    fail = true;
    for (let i = 0; i < 3; i++) {
      const current = store.get("publication", q.id, Publication);
      assert.ok(current);
      store.put("publication", q.id, { ...current, nextAttempt: 0 });
      await app.work();
    }
    assert.equal(store.get("publication", q.id, Publication)?.state, "failed");
    app.discard("draft");
    assert.equal(
      app.state().drafts.some((r) => r.draftId === "draft"),
      false,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("single owner cannot be evicted by a second process claim", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-owner-"));
  try {
    const path = join(dir, "db");
    const release = claimOwner(path);
    assert.throws(() => claimOwner(path), /Another ReplyLink/);
    release();
    claimOwner(path)();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ownership locks exclude another live process and release after SIGKILL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-owner-crash-"));
  const path = join(dir, "db");
  const module = new URL(
    "../apps/server/src/adapters/storage/owner.ts",
    import.meta.url,
  ).href;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {claimOwner} from ${JSON.stringify(module)}; claimOwner(${JSON.stringify(path)}); console.log('ready'); setInterval(()=>{},1000);`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw new Error("Owner subprocess exited before acquiring lock");
      }),
    ]);
    assert.throws(() => claimOwner(path), /Another ReplyLink/);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    claimOwner(path)();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
