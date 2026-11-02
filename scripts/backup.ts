import { DatabaseSync, backup } from "node:sqlite";
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { CaptureChunk, CaptureEpoch } from "../shared/contracts/capture.ts";
import { Asset } from "../shared/contracts/models.ts";
import { createHash } from "node:crypto";
import { containsPath } from "../apps/server/src/adapters/storage/paths.ts";
const root = resolve(process.env.DATA_DIR ?? ".data");
const dest = process.argv[2];
if (!dest)
  throw new Error(
    "Usage: npm run backup -- /absolute/new/backup-directory (stop app first)",
  );
const target = resolve(dest);
if (containsPath(root, target) || containsPath(target, root))
  throw new Error("Backup must be outside the live data directory.");
try {
  await stat(target);
  throw new Error("Choose a new directory.");
} catch (e) {
  if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
}
const release = claimOwner(join(root, "replylink.sqlite"));
try {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const source = new DatabaseSync(join(root, "replylink.sqlite"));
  await backup(source, join(target, "replylink.sqlite"));
  source.close();
  const snapshot = new DatabaseSync(join(target, "replylink.sqlite"));
  // Legacy PID ownership metadata is neither collection data nor a restore lock.
  snapshot.exec("DROP TABLE IF EXISTS owner");
  snapshot.close();
  try {
    await cp(join(root, "media"), join(target, "media"), { recursive: true });
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
    await mkdir(join(target, "media"), { recursive: true, mode: 0o700 });
  }
  try {
    await cp(join(root, "capture"), join(target, "capture"), {
      recursive: true,
    });
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  const store = new SQLiteStore(join(target, "replylink.sqlite"));
  try {
    const pending = new Set(
      store
        .list("capture", CaptureEpoch)
        .filter((e) => e.state === "recording" || e.state === "interrupted")
        .map((e) => e.id),
    );
    for (const c of store
      .list("capture-chunk", CaptureChunk)
      .filter((c) => pending.has(c.captureId))) {
      const bytes = await readFile(
        join(target, "capture", c.captureId, c.sequence + ".chunk"),
      );
      if (createHash("sha256").update(bytes).digest("hex") !== c.sha256)
        throw new Error("Capture backup integrity failed.");
    }
    for (const a of store.list("asset", Asset)) {
      const bytes = await readFile(join(target, "media", a.id + ".source"));
      if (createHash("sha256").update(bytes).digest("hex") !== a.sha256)
        throw new Error("Backup integrity failed.");
    }
  } finally {
    store.close();
  }
  console.log(
    "Backup copied and source/capture hashes verified. OAuth tokens intentionally excluded. Restore: point DATA_DIR at this directory and restart; log in to Twitch again.",
  );
} finally {
  release();
}
