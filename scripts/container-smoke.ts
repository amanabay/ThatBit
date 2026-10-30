import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { seed } from "./demo.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { HttpPublisher } from "../apps/server/src/adapters/publishing/http.ts";
const exec = promisify(execFile);
const name = "replylink-smoke-" + randomBytes(6).toString("hex");
const key = randomBytes(32).toString("hex");
const docker = async (...args: string[]) =>
  (
    await exec("docker", args, {
      env: { ...process.env, READER_WRITE_TOKEN: key },
      timeout: 90000,
    })
  ).stdout.trim();
const root = await mkdtemp(join(tmpdir(), "replylink-container-"));
let store: SQLiteStore | undefined;
try {
  await seed(root);
  store = new SQLiteStore(join(root, "replylink.sqlite"));
  const media = new FFmpegMedia(join(root, "media"));
  const app = new Exchanges(store, media, "fixture-creator");
  const draft = app.state().drafts[0];
  assert.ok(draft);
  const p = app.approve(draft.draftId, draft.version);
  await app.work();
  const reply = app.publicReply(p.id);
  assert.ok(reply);
  await docker("volume", "create", name);
  await docker(
    "run",
    "-d",
    "--name",
    name,
    "-p",
    "127.0.0.1::4320",
    "--env",
    "READER_WRITE_TOKEN",
    "-v",
    name + ":/var/data",
    "replylink-reader:local",
  );
  const address = await docker("port", name, "4320/tcp");
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  let base = "http://" + address;
  const waitHealthy = async () => {
    for (let i = 0; i < 60; i++) {
      if (
        await fetch(base + "/healthz", { signal: AbortSignal.timeout(2000) })
          .then((r) => r.ok)
          .catch(() => false)
      )
        return;
      await delay(500);
    }
    throw new Error("Local container did not become healthy");
  };
  await waitHealthy();
  let publisher = new HttpPublisher(base, key, (id) =>
    media.derived(id, "video"),
  );
  await publisher.send({ reply, generation: p.generation });
  const range = async () =>
    fetch(`${base}/api/public/replies/${p.id}/video`, {
      headers: { Range: "bytes=0-15" },
    });
  assert.equal((await range()).status, 206);
  const image = await fetch(`${base}/api/public/replies/${p.id}/preview`);
  assert.equal(image.status, 200);
  const png = Buffer.from(await image.arrayBuffer());
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.ok(
    (await (await fetch(`${base}/r/${p.id}`)).text()).includes(
      'property="og:image"',
    ),
  );
  assert.equal(
    (await fetch(`${base}/api/public/replies/${p.id}/captions`)).status,
    200,
  );
  assert.equal((await fetch(base + "/api/creator/state")).status, 404);
  assert.equal((await fetch(base + "/management/replies/" + p.id)).status, 401);
  await docker("restart", name);
  base = "http://" + (await docker("port", name, "4320/tcp"));
  publisher = new HttpPublisher(base, key, (id) => media.derived(id, "video"));
  await waitHealthy();
  assert.equal(
    (await range()).status,
    206,
    "available media survives a real container restart",
  );
  assert.equal(
    (await fetch(`${base}/api/public/replies/${p.id}/preview`)).status,
    200,
  );
  await publisher.withdraw(p.id, p.generation + 1);
  assert.equal((await range()).status, 410);
  assert.equal(
    (await fetch(`${base}/api/public/replies/${p.id}/preview`)).status,
    410,
  );
  await docker("restart", name);
  base = "http://" + (await docker("port", name, "4320/tcp"));
  await waitHealthy();
  assert.equal(
    (await range()).status,
    410,
    "withdrawal survives a real container restart",
  );
  assert.equal(
    (await fetch(`${base}/api/public/replies/${p.id}/preview`)).status,
    410,
  );
  console.log(
    "Local container passed: authenticated publish, video range, captions, private-route rejection, two restarts and withdrawal persistence. Generated fixture only; no deployment.",
  );
} catch (error) {
  console.error(
    "Container state:",
    await docker(
      "inspect",
      "--format",
      "{{.State.Status}} exit={{.State.ExitCode}}",
      name,
    ).catch(() => "unavailable"),
  );
  console.error(
    (
      await docker("logs", name).catch(() => "Container logs unavailable")
    ).slice(-2000),
  );
  throw error;
} finally {
  store?.close();
  await docker("rm", "-f", name).catch(() => {});
  await docker("volume", "rm", name).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
