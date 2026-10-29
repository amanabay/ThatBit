import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
// OS liveness is checked while SQLite serializes ownership changes. A reused PID
// conservatively refuses ownership rather than evicting a live process.
export function claimOwner(path: string) {
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL)",
  );
  const nonce = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT pid FROM owner WHERE id=1").get();
    if (row) {
      try {
        process.kill(Number(row.pid), 0);
        throw new Error(
          "Another ReplyLink process owns this data directory. Stop it first.",
        );
      } catch (e) {
        if (!(e instanceof Error && "code" in e && e.code === "ESRCH")) throw e;
      }
    }
    db.prepare("INSERT OR REPLACE INTO owner VALUES(1,?,?)").run(
      process.pid,
      nonce,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.close();
    throw e;
  }
  return () => {
    db.prepare("DELETE FROM owner WHERE id=1 AND nonce=?").run(nonce);
    db.close();
  };
}
