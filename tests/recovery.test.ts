import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";
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
    const approvedRevision = q.revisionId;
    app.save("retry", {
      ...edit,
      expectedVersion: 1,
      title: "Newer private edit",
    });
    media.exists = () => false;
    assert.throws(
      () => app.retryRender(q.id),
      /approved source is unavailable/,
    );
    media.exists = () => true;
    const retry = app.retryRender(q.id);
    assert.equal(retry.revisionId, approvedRevision);
    assert.equal(retry.generation, q.generation + 1);
    assert.equal(retry.attempts, 0);
    assert.equal(retry.state, "queued");
    fail = false;
    const retried = app.work();
    finish();
    await retried;
    assert.equal(app.publicReply(q.id)?.title, "Test");
    assert.throws(() => app.retryRender(q.id), /Only a failed render/);
    app.remove(q.id);
    assert.throws(() => app.retryRender(q.id), /Only a failed render/);
    assert.throws(() => app.retryRender(p.id), /Only a failed render/);
    app.discard("draft");
    assert.equal(
      app.state().drafts.some((r) => r.draftId === "draft"),
      false,
    );
    app.message({
      ...m,
      id: "moderated",
      sourceId: "moderated-source",
      source: "twitch",
      receivedAt: "2026-10-30T10:00:00Z",
    });
    app.save("moderated-draft", { ...edit, messageId: "moderated" });
    const moderated = app.approve("moderated-draft", 1);
    const moderatingWork = app.work();
    app.clearTwitchMessages("2026-10-30T10:00:01Z", m.userId);
    finish();
    await moderatingWork;
    assert.equal(
      store.get("publication", moderated.id, Publication)?.state,
      "removed",
    );
    assert.equal(app.publicReply(moderated.id), undefined);
    assert.equal(
      store.get("message", m.id, Message)?.removed,
      false,
      "Twitch clears do not remove fixture/manual sources",
    );
    app.message({
      ...m,
      id: "late-cleared",
      sourceId: "late-cleared-source",
      source: "twitch",
      receivedAt: "2026-10-30T10:00:00Z",
    });
    app.message({
      ...m,
      id: "after-clear",
      sourceId: "after-clear-source",
      source: "twitch",
      receivedAt: "2026-10-30T10:00:02Z",
    });
    assert.equal(store.get("message", "late-cleared", Message)?.removed, true);
    assert.equal(store.get("message", "after-clear", Message)?.removed, false);
    app.clearTwitchMessages("2026-10-30T10:00:03.000000002Z", m.userId);
    app.message({
      ...m,
      id: "after-submillisecond-clear",
      sourceId: "new-after-submillisecond-clear",
      source: "twitch",
      receivedAt: "2026-10-30T10:00:03.000000003Z",
    });
    assert.equal(
      store.get("message", "after-submillisecond-clear", Message)?.removed,
      false,
      "a later message in the same millisecond survives the clear",
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

test("SIGKILL during a SQLite transaction preserves the prior commit and rolls back partial records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-transaction-crash-"));
  const path = join(dir, "db");
  const module = new URL(
    "../apps/server/src/adapters/storage/sqlite.ts",
    import.meta.url,
  ).href;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {SQLiteStore} from ${JSON.stringify(module)}; const store=new SQLiteStore(${JSON.stringify(path)}); store.put('fixture','committed',true); store.transaction(()=>{store.put('fixture','partial',true); console.log('uncommitted'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw Error("Fixture exited early");
      }),
    ]);
    const done = once(child, "exit");
    child.kill("SIGKILL");
    await done;
    const store = new SQLiteStore(path);
    try {
      assert.equal(store.get("fixture", "committed", z.boolean()), true);
      assert.equal(store.get("fixture", "partial", z.boolean()), undefined);
      store.put("fixture", "recovered", true);
      assert.equal(store.get("fixture", "recovered", z.boolean()), true);
    } finally {
      store.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, "exit");
      child.kill("SIGKILL");
      await done;
    }
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
