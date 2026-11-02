import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { creatorDatabase } from "../apps/server/src/adapters/storage/collection.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";

test("legacy creator data keeps its ownership lock and backs up to the branded collection without shadowing records", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-upgrade-"));
  const source = join(root, "source");
  await mkdir(source);
  try {
    assert.equal(creatorDatabase(source), join(source, "thatbit.sqlite"));
    const legacy = join(source, "replylink.sqlite");
    const original = new SQLiteStore(legacy);
    original.put("fixture", "original", "Immutable legacy metadata [fixture]");
    original.close();
    assert.equal(creatorDatabase(source), legacy);
    const release = claimOwner(legacy);
    try {
      assert.throws(
        () => claimOwner(creatorDatabase(source)),
        /Another ThatBit/,
      );
    } finally {
      release();
    }
    const target = join(root, "backup");
    await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/backup.ts", target],
      { env: { ...process.env, DATA_DIR: source } },
    );
    assert.equal(creatorDatabase(target), join(target, "thatbit.sqlite"));
    const restored = new SQLiteStore(creatorDatabase(target));
    try {
      assert.equal(
        restored.get("fixture", "original", z.string()),
        "Immutable legacy metadata [fixture]",
      );
    } finally {
      restored.close();
    }
    await assert.rejects(stat(join(target, "replylink.sqlite")), {
      code: "ENOENT",
    });
    await assert.rejects(stat(join(source, "thatbit.sqlite")), {
      code: "ENOENT",
    });
    await writeFile(join(source, "thatbit.sqlite"), "");
    assert.throws(() => creatorDatabase(source), /Two creator collections/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
