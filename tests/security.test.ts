import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { createServer } from "../apps/server/src/http/server.ts";
import { z } from "zod";
test("creator authentication, hostile origin/host, public projections and malformed IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-http-"));
  const store = new SQLiteStore(join(dir, "db"));
  const app = new Exchanges(
    store,
    new FFmpegMedia(join(dir, "media")),
    "creator",
  );
  const server = await createServer(app, { port: 4317, production: true });
  try {
    const inject = (url: string, headers: Record<string, string> = {}) =>
      server.inject({
        method: "GET",
        url,
        headers: { host: "localhost:4317", ...headers },
      });
    assert.equal((await inject("/api/creator/state")).statusCode, 401);
    assert.equal(
      (await inject("/api/creator/session", { origin: "https://evil.example" }))
        .statusCode,
      403,
    );
    assert.equal(
      (await inject("/api/creator/session", { host: "evil.example" }))
        .statusCode,
      403,
    );
    const token = z
      .object({ token: z.string() })
      .parse((await inject("/api/creator/session")).json()).token;
    assert.equal(
      (await inject("/api/creator/state", { "x-creator-token": token }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/api/creator/messages",
          headers: { host: "localhost:4317", cookie: "creator=" + token },
          payload: { author: "a", text: "b" },
        })
      ).statusCode,
      403,
    );
    for (const path of [
      "/api/public/replies/private",
      "/api/public/replies/private/video",
      "/api/public/replies/private/portrait",
      "/api/public/replies/private/captions",
    ])
      assert.equal((await inject(path)).statusCode, 410);
    assert.equal(
      (await inject("/api/public/replies/%3Cscript%3E")).statusCode,
      400,
    );
  } finally {
    await server.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
