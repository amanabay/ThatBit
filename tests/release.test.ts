import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, link, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import type { Media } from "../apps/server/src/application/ports.ts";
import { EmbeddingCache } from "../apps/server/src/adapters/transcription/embedding-cache.ts";
import {
  managedDiskUsage,
  resourceSampler,
} from "../apps/server/src/adapters/diagnostics/resources.ts";
import { InboxQuery } from "../shared/contracts/inbox.ts";
import { Message } from "../shared/contracts/models.ts";
import { summarizeRehearsal } from "../apps/server/src/domain/rehearsal.ts";
import { Operations } from "../apps/server/src/application/operations.ts";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
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
const message = (i: number) =>
  Message.parse({
    id: "message-" + i,
    sourceId: "source-" + i,
    userId: "fixture",
    author: "Fixture",
    text: "Authored fixture " + i,
    receivedAt: new Date().toISOString(),
    source: "fixture",
  });
test("indexed inbox pages remain stable during intake, escape search wildcards and retain older draft context", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-inbox-"));
  let store = new SQLiteStore(join(root, "db"));
  try {
    let app = new Exchanges(store, media, "fixture");
    for (let i = 0; i < 135; i++) app.message(message(i));
    app.message({ ...message(1), id: "duplicate-source" });
    assert.equal(store.inbox(InboxQuery.parse({})).total, 135);
    const first = store.inbox(InboxQuery.parse({}));
    app.message(message(135));
    assert.ok(first.nextCursor);
    const second = store.inbox(InboxQuery.parse({ before: first.nextCursor }));
    assert.ok(second.nextCursor);
    const third = store.inbox(InboxQuery.parse({ before: second.nextCursor }));
    const paged = [...first.items, ...second.items, ...third.items];
    assert.equal(paged.length, 135);
    assert.equal(new Set(paged.map((m) => m.id)).size, 135);
    assert.equal(third.nextCursor, null);
    app.message({ ...message(140), text: "Literal %_ search fixture" });
    assert.equal(store.inbox(InboxQuery.parse({ query: "%_" })).total, 1);
    app.removeMessage("source-140", "fixture");
    assert.equal(store.inbox(InboxQuery.parse({ query: "%_" })).total, 0);
    assert.equal(
      store.inbox(InboxQuery.parse({ query: "%_", removed: "true" })).total,
      1,
    );
    store.put("asset", "a", {
      id: "a",
      duration: 10,
      bytes: 1,
      sha256: "fixture",
      audio: true,
      fixture: true,
      createdAt: new Date().toISOString(),
    });
    const edit = {
      expectedVersion: 0,
      messageId: "message-0",
      assetId: "a",
      start: 0,
      end: 3,
      title: "Fixture title",
      captions: [],
    };
    app.save("old-message-draft", edit);
    const revised = app.save("old-message-draft", {
      ...edit,
      expectedVersion: 1,
      title: "Revised fixture",
    });
    assert.equal(app.state().messages.length, 51);
    assert.ok(app.state().messages.some((m) => m.id === "message-0"));
    assert.equal(app.state().drafts[0]?.id, revised.id);
    store.close();
    store = new SQLiteStore(join(root, "db"));
    app = new Exchanges(store, media, "fixture");
    assert.equal(app.latest("old-message-draft")?.id, revised.id);
    assert.equal(store.inbox(InboxQuery.parse({})).total, 136);
    assert.throws(() => InboxQuery.parse({ before: -1 }));
    assert.throws(() => InboxQuery.parse({ limit: 101 }));
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("envelope acceptance rolls back both domain mutations and deduplication on storage failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-envelope-"));
  const store = new SQLiteStore(join(root, "db"));
  const app = new Exchanges(store, media, "fixture");
  try {
    assert.throws(
      () =>
        app.twitchEvent("envelope", () => {
          app.message(message(1));
          throw Error("ENOSPC fixture");
        }),
      /ENOSPC/,
    );
    assert.equal(store.get("message", "message-1", Message), undefined);
    assert.equal(
      app.twitchEvent("envelope", () => app.message(message(1))),
      true,
    );
    assert.equal(
      app.twitchEvent("envelope", () => app.message(message(2))),
      false,
    );
    assert.equal(store.inbox(InboxQuery.parse({})).total, 1);
    assert.equal(
      app.twitchEvent("different-envelope", () => app.message(message(1))),
      true,
    );
    assert.equal(
      store.inbox(InboxQuery.parse({})).total,
      1,
      "source ID remains independently idempotent",
    );
    store.transaction(() => {
      for (let i = 0; i < 10100; i++)
        store.put("twitch-envelope", "historic-" + i, { id: "historic-" + i });
    });
    const restarted = new Exchanges(store, media, "fixture");
    restarted.twitchEvent("first-after-restart", () => {});
    assert.equal(
      store.list("twitch-envelope", z.object({ id: z.string() })).length,
      10000,
      "first intake after restart prunes the bounded ledger",
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("model-scoped bounded embeddings reuse concurrent text, invalidate edits and recover from provider failure", async () => {
  const calls: string[][] = [];
  let fail = false;
  const cache = new EmbeddingCache(async (texts) => {
    calls.push(texts);
    if (fail) throw Error("fixture");
    return texts.map((t) => new Float32Array([t.length, 1]));
  }, 3);
  const [first, duplicate] = await Promise.all([
    cache.vectors(["one", "two", "one"]),
    cache.vectors(["one", "two"]),
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(first[0], duplicate[0]);
  await cache.vectors(["one corrected"]);
  assert.deepEqual(calls[1], ["one corrected"]);
  await cache.vectors(["three", "four", "five"]);
  await cache.vectors(["one"]);
  assert.deepEqual(calls.at(-1), ["one"]);
  fail = true;
  await assert.rejects(cache.vectors(["retry"]));
  fail = false;
  assert.equal((await cache.vectors(["retry"]))[0]?.[0], 5);
  cache.clear();
  await cache.vectors(["retry"]);
  assert.deepEqual(calls.at(-1), ["retry"]);
});
test("real SQLite page exhaustion rolls back partial writes, preserves the native error and recovers after space is restored", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-sqlite-full-"));
  const store = new SQLiteStore(join(root, "db"));
  try {
    store.put("fixture", "committed", true);
    // Fault injection into this temporary native connection only; no host disk is filled.
    const native: unknown = Reflect.get(store, "db");
    assert.ok(native instanceof DatabaseSync);
    const pages = Number(native.prepare("PRAGMA page_count").get()?.page_count);
    native.exec("PRAGMA max_page_count=" + pages);
    assert.throws(
      () =>
        store.transaction(() => {
          store.put("fixture", "partial", true);
          store.put("fixture", "exhaust", "x".repeat(1024 * 1024));
        }),
      /database or disk is full/,
    );
    assert.equal(store.get("fixture", "committed", z.boolean()), true);
    assert.equal(store.get("fixture", "partial", z.boolean()), undefined);
    native.exec("PRAGMA max_page_count=10000");
    store.transaction(() => store.put("fixture", "recovered", true));
    assert.equal(store.get("fixture", "recovered", z.boolean()), true);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("Linux resource sampling includes configured reader, discloses its exit and counts allocated disk without following links", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-resources-"));
  const data = join(root, "data"),
    readerRoot = join(data, "reader");
  await mkdir(readerRoot, { recursive: true });
  await writeFile(join(data, "fixture"), Buffer.alloc(4096, 1));
  await link(join(data, "fixture"), join(readerRoot, "hardlink"));
  await mkdir(join(root, "outside"));
  await writeFile(
    join(root, "outside", "fixture"),
    Buffer.alloc(1024 * 1024, 1),
  );
  await symlink(
    join(root, "outside"),
    join(data, "do-not-follow"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const child = spawn(
    process.execPath,
    ["-e", "console.log('ready'); setInterval(()=>{},1000)"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const store = new SQLiteStore(join(data, "db"));
  try {
    await once(child.stdout, "data");
    const usage = await managedDiskUsage([data, readerRoot]);
    assert.equal(usage.complete, process.platform !== "win32");
    assert.ok(
      usage.logicalBytes < 1024 * 1024,
      "external symlink target excluded; hardlink deduplicated",
    );
    if (process.platform !== "win32") assert.ok(usage.allocatedBytes > 0);
    const sampler = resourceSampler(data, child.pid, readerRoot);
    const sample = await new Operations(store, sampler).sample();
    if (process.platform === "linux") {
      assert.equal(sample.resources.readerObserved, true);
      assert.equal(sample.resources.processesComplete, true);
      assert.ok(
        sample.resources.processSamples?.some(
          (p) => p.role === "reader" && p.rssBytes > 0,
        ),
      );
      const report = summarizeRehearsal([sample], 0, 1, 1, false);
      assert.equal(report.coverage.localReader, true);
      assert.ok(
        (report.peakSampledApplicationRssBytes ?? 0) >=
          (sample.resources.processSamples?.find((p) => p.role === "reader")
            ?.rssBytes ?? 0),
      );
      assert.match(report.scope, /surviving process identities/);
    }
    const done = once(child, "exit");
    child.kill("SIGTERM");
    await done;
    const after = await new Operations(store, sampler).sample();
    assert.equal(after.resources.readerObserved, false);
    assert.equal(
      summarizeRehearsal([after], 0, 1, 1, false).outcome,
      "incomplete-measurements",
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, "exit");
      child.kill("SIGKILL");
      await done;
    }
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
