import { mkdir, cp, writeFile, stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";
import { readerShell } from "../apps/server/src/adapters/publishing/preview.ts";
import { containsPath } from "../apps/server/src/adapters/storage/paths.ts";
const root = resolve(process.env.DATA_DIR ?? ".data");
const dest = process.argv[2];
if (!dest)
  throw new Error(
    "Usage: npm run export:public -- /absolute/new/bundle-directory (stop app first)",
  );
const target = resolve(dest);
if (containsPath(root, target) || containsPath(target, root))
  throw new Error("Bundle must be outside private data directory.");
try {
  await stat(target);
  throw new Error("Choose a new directory for a consistent snapshot.");
} catch (e) {
  if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
}
const release = claimOwner(join(root, "replylink.sqlite"));
const store = new SQLiteStore(join(root, "replylink.sqlite"));
try {
  const media = new FFmpegMedia(join(root, "media"));
  const app = new Exchanges(
    store,
    media,
    process.env.TWITCH_CHANNEL ?? "creator",
  );
  await mkdir(join(target, "media"), { recursive: true, mode: 0o700 });
  const manifest = [];
  for (const p of app.state().publications) {
    const dto = app.publicReply(p.id);
    if (!dto) continue;
    await cp(
      media.derived(p.id, "video"),
      join(target, "media", p.id + ".webm"),
    );
    manifest.push(dto);
  }
  await writeFile(join(target, "manifest.json"), JSON.stringify(manifest));
  await cp(resolve("dist"), join(target, "web"), { recursive: true });
  const index = join(target, "web", "index.html");
  await writeFile(index, readerShell(await readFile(index, "utf8")));
  console.log(
    `Prepared ${manifest.length} approved replays, UI, and public metadata. No raw sources, tokens, or drafts copied. Not uploaded or deployed.`,
  );
} finally {
  store.close();
  release();
}
