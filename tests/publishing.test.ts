import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  readdir,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readerServer } from "../apps/server/src/adapters/publishing/reader.ts";
import { seed } from "../scripts/demo.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { Publishing } from "../apps/server/src/application/publishing.ts";
test("managed reader stages privately, verifies real media, persists availability, and fences stale resurrection", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-reader-"));
  const key = "fixture-writer-key-with-at-least-32-characters";
  const web = join(root, "web");
  await mkdir(web);
  await writeFile(
    join(web, "index.html"),
    '<!doctype html><html><head><title>ThatBit</title><meta name="description" content="Default"></head><body><div id="root"></div></body></html>',
  );
  await seed(join(root, "creator"));
  const db = new SQLiteStore(join(root, "creator", "thatbit.sqlite"));
  const media = new FFmpegMedia(join(root, "creator", "media"));
  const app = new Exchanges(db, media, "creator");
  let reader = await readerServer(
    join(root, "reader"),
    key,
    web,
    "https://reader.example",
  );
  try {
    for (const path of ["/", "/index.html", "/unknown-page"]) {
      const home = await reader.inject(path);
      assert.equal(home.statusCode, 200);
      assert.ok(
        home.body.includes('<meta name="thatbit-app" content="reader">'),
      );
    }
    const privateRoute = await reader.inject("/api/creator/session");
    assert.equal(privateRoute.statusCode, 404);
    assert.equal(privateRoute.json().error, "Reader endpoint not found.");
    const revision = app.state().drafts[0];
    assert.ok(revision);
    const changed = app.save(revision.draftId, {
      ...revision,
      expectedVersion: revision.version,
      title: 'A <script>alert(1)</script> & "quote"',
    });
    const p = app.approve(changed.draftId, changed.version);
    await app.work();
    const reply = app.publicReply(p.id);
    assert.ok(reply);
    const bytes = await readFile(media.derived(p.id, "video"));
    const manifest = {
      reply,
      generation: 1,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const headers = { authorization: "Bearer " + key };
    assert.equal(
      (
        await reader.inject({
          method: "PUT",
          url: "/management/replies/" + p.id,
          payload: manifest,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await reader.inject({
          method: "PUT",
          url: "/management/replies/" + p.id,
          headers,
          payload: manifest,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await reader.inject("/api/public/replies/" + p.id)).statusCode,
      410,
    );
    assert.equal(
      (await reader.inject(`/api/public/replies/${p.id}/preview`)).statusCode,
      410,
    );
    const staged = await reader.inject(`/r/${p.id}`);
    assert.equal(staged.statusCode, 410);
    assert.ok(!staged.body.includes('property="og:title"'));
    assert.equal(
      (
        await reader.inject({
          method: "PUT",
          url: `/management/replies/${p.id}/1/video`,
          headers: { ...headers, "content-type": "application/octet-stream" },
          payload: Buffer.from("wrong"),
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await reader.inject({
          method: "PUT",
          url: `/management/replies/${p.id}/1/video`,
          headers: { ...headers, "content-type": "application/octet-stream" },
          payload: bytes,
        })
      ).statusCode,
      200,
    );
    await writeFile(
      join(root, "reader", "media", `${p.id}.1.png`),
      "Legacy preview cache fixture",
    );
    await reader.close();
    reader = await readerServer(
      join(root, "reader"),
      key,
      web,
      "https://reader.example",
    );
    assert.equal(
      (await reader.inject("/api/public/replies/" + p.id)).statusCode,
      200,
    );
    const range = await reader.inject({
      url: `/api/public/replies/${p.id}/video`,
      headers: { range: "bytes=0-9" },
    });
    assert.equal(range.statusCode, 206);
    assert.equal(range.rawPayload.length, 10);
    const image = await reader.inject(`/api/public/replies/${p.id}/preview`);
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/png");
    assert.equal(image.rawPayload.subarray(1, 4).toString(), "PNG");
    assert.equal(image.rawPayload.readUInt32BE(16), 1200);
    assert.equal(image.rawPayload.readUInt32BE(20), 630);
    assert.ok(
      !(await readdir(join(root, "reader", "media"))).includes(`${p.id}.1.png`),
    );
    await writeFile(
      join(tmpdir(), "thatbit-brand-preview.png"),
      image.rawPayload,
    );
    await rm(join(root, "reader", "media", `${p.id}.1.thatbit.png`));
    const legacyPreview = await reader.inject(
      `/api/public/replies/${p.id}/preview`,
    );
    assert.equal(legacyPreview.statusCode, 200);
    assert.equal(legacyPreview.rawPayload.readUInt32BE(16), 1200);
    const page = await reader.inject({
      url: `/r/${p.id}`,
      headers: { host: "evil.example", "x-forwarded-proto": "http" },
    });
    assert.equal(page.statusCode, 200);
    assert.ok(page.body.includes('<meta name="thatbit-app" content="reader">'));
    assert.ok(page.body.includes('property="og:site_name" content="ThatBit"'));
    assert.ok(
      page.body.includes(
        'property="og:image" content="https://reader.example/',
      ),
    );
    assert.ok(page.body.includes("&lt;script&gt;"));
    assert.ok(!page.body.includes("<script>alert(1)</script>"));
    assert.ok(!page.body.includes("evil.example"));
    assert.equal((await reader.inject("/api/creator/state")).statusCode, 404);
    await reader.inject({
      method: "DELETE",
      url: `/management/replies/${p.id}/2`,
      headers,
    });
    for (const kind of ["", "/video", "/captions", "/preview"])
      assert.equal(
        (await reader.inject("/api/public/replies/" + p.id + kind)).statusCode,
        410,
      );
    const removed = await reader.inject(`/r/${p.id}`);
    assert.equal(removed.statusCode, 410);
    assert.ok(!removed.body.includes('property="og:image"'));
    assert.ok(!removed.body.includes("alert(1)"));
    assert.deepEqual(
      await readdir(join(root, "reader", "media")),
      [],
      "withdrawal removes managed media while retaining its tombstone",
    );
    assert.equal(
      (
        await reader.inject({
          method: "PUT",
          url: "/management/replies/" + p.id,
          headers,
          payload: manifest,
        })
      ).statusCode,
      409,
    );
    await reader.close();
    reader = await readerServer(
      join(root, "reader"),
      key,
      web,
      "https://reader.example",
    );
    assert.equal(
      (await reader.inject("/api/public/replies/" + p.id)).statusCode,
      410,
    );
  } finally {
    await reader.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("publisher recovers interrupted work and withdraws after removal races an upload", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-sync-"));
  await seed(root);
  const db = new SQLiteStore(join(root, "thatbit.sqlite"));
  const app = new Exchanges(
    db,
    new FFmpegMedia(join(root, "media")),
    "creator",
  );
  try {
    const draft = app.state().drafts[0];
    assert.ok(draft);
    const p = app.approve(draft.draftId, draft.version);
    await app.work();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const withdrawn: number[] = [];
    const publishing = new Publishing(
      app,
      {
        send: async () => {
          await gate;
        },
        withdraw: async (_id, g) => {
          withdrawn.push(g);
        },
      },
      "http://localhost:4320",
    );
    publishing.queue(p.id);
    const work = publishing.work();
    app.remove(p.id);
    release();
    await work;
    await publishing.work();
    assert.deepEqual(withdrawn, [2]);
    assert.equal(publishing.list()[0]?.state, "removed");
    assert.throws(() => publishing.queue(p.id), /exact revision/);
    db.put("sync", p.id, { ...publishing.list()[0], state: "removing" });
    publishing.recover();
    await publishing.work();
    assert.deepEqual(
      withdrawn,
      [2, 2],
      "restart safely repeats the same withdrawal generation",
    );
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
