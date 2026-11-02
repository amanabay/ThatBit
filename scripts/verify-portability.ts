import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { z } from "zod";
import { PublicReply } from "../shared/contracts/models.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
const backup = join(tmpdir(), "replylink-verified-backup");
const bundle = join(tmpdir(), "replylink-verified-public");
const store = new SQLiteStore(join(backup, "replylink.sqlite"));
try {
  const app = new Exchanges(
    store,
    new FFmpegMedia(join(backup, "media")),
    "creator",
  );
  assert.equal(app.state().drafts.length, 3);
  for (const a of app.state().assets) assert.ok(app.media.exists(a.id));
} finally {
  store.close();
}
const original = await readFile(join(bundle, "manifest.json"), "utf8");
const replies = z.array(PublicReply).parse(JSON.parse(original));
const id = replies[0]?.id;
if (!id) throw new Error("Prepare fixture publication bundle first.");
const child = spawn(
  process.execPath,
  ["--import", "tsx", "apps/server/src/http/reader.ts"],
  {
    env: { ...process.env, PORT: "4319", BUNDLE_DIR: bundle },
    stdio: "ignore",
  },
);
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch("http://localhost:4319/api/public/replies/" + id);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Reader may still be starting; retry within the bounded window. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Reader must start");
  for (const path of [
    "/api/creator/state",
    "/api/creator/session",
    "/api/public/replies/" + id + "/source",
  ])
    assert.equal((await fetch("http://localhost:4319" + path)).status, 404);
  const video = await fetch(
    "http://localhost:4319/api/public/replies/" + id + "/video",
    { headers: { Range: "bytes=0-99" } },
  );
  assert.equal(video.status, 206);
  assert.equal((await video.arrayBuffer()).byteLength, 100);
  await writeFile(join(bundle, "manifest.json"), "[]");
  assert.equal(
    (await fetch("http://localhost:4319/api/public/replies/" + id + "/video"))
      .status,
    410,
  );
  console.log(
    "PASS: restored metadata/source collection; local separate reader denies creator/source access, serves range video, and revokes via manifest. Not external playback acceptance.",
  );
} finally {
  child.kill("SIGTERM");
  await writeFile(join(bundle, "manifest.json"), original);
}
