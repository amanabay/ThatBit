import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

// A separate SQLite connection holds an OS-backed exclusive lock for this owner’s
// lifetime. The kernel releases it on exit/crash, including container PID reuse.
// Keep it separate from the collection DB so normal transactions can proceed.
export function claimOwner(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path + ".owner-lock");
  chmodSync(path + ".owner-lock", 0o600);
  try {
    db.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
  } catch {
    db.close();
    throw new Error(
      "Another ReplyLink process owns this data directory. Stop it first.",
    );
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      db.exec("ROLLBACK");
    } finally {
      db.close();
    }
  };
}
