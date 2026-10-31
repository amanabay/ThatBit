import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import type { Store } from "../../application/ports.ts";
import { Message, Revision } from "../../../../../shared/contracts/models.ts";
import type { InboxQuery } from "../../../../../shared/contracts/inbox.ts";
export class SQLiteStore implements Store {
  private db: DatabaseSync;
  private depth = 0;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));",
    );
    if (
      Number(this.db.prepare("PRAGMA user_version").get()?.user_version) > 2
    ) {
      this.db.close();
      throw new Error(
        "Collection schema is newer than this application. Use its matching release.",
      );
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS message_source ON records(json_extract(json,'$.source'),json_extract(json,'$.sourceId')) WHERE kind='message';
      CREATE INDEX IF NOT EXISTS revision_draft ON records(json_extract(json,'$.draftId'),json_extract(json,'$.version') DESC) WHERE kind='revision';
      PRAGMA user_version=2;
    `);
  }
  get<T>(kind: string, id: string, schema: z.ZodType<T>) {
    const row = this.db
      .prepare("SELECT json FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? schema.parse(JSON.parse(String(row.json))) : undefined;
  }
  list<T>(kind: string, schema: z.ZodType<T>) {
    return this.db
      .prepare("SELECT json FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((r) => schema.parse(JSON.parse(String(r.json))));
  }
  put(kind: string, id: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json",
      )
      .run(kind, id, JSON.stringify(value));
  }
  inbox(query: InboxQuery) {
    const where = ["kind='message'"];
    const args: (string | number)[] = [];
    if (query.source !== "all") {
      where.push("json_extract(json,'$.source')=?");
      args.push(query.source);
    }
    if (query.removed !== "true")
      where.push("COALESCE(json_extract(json,'$.removed'),0)=0");
    if (query.query) {
      where.push(
        "(json_extract(json,'$.author') LIKE ? ESCAPE '\\' OR json_extract(json,'$.text') LIKE ? ESCAPE '\\')",
      );
      const pattern = "%" + query.query.replace(/[\\%_]/g, "\\$&") + "%";
      args.push(pattern, pattern);
    }
    const total = Number(
      this.db
        .prepare(
          "SELECT count(*) AS total FROM records WHERE " + where.join(" AND "),
        )
        .get(...args)?.total ?? 0,
    );
    if (query.before !== undefined) {
      where.push("rowid < ?");
      args.push(query.before);
    }
    const rows = this.db
      .prepare(
        "SELECT rowid,json FROM records WHERE " +
          where.join(" AND ") +
          " ORDER BY rowid DESC LIMIT ?",
      )
      .all(...args, query.limit + 1);
    const selected = rows.slice(0, query.limit);
    return {
      items: selected.map((r) => Message.parse(JSON.parse(String(r.json)))),
      nextCursor:
        rows.length > query.limit ? Number(selected.at(-1)?.rowid) : null,
      total,
    };
  }
  messageBySource(source: Message["source"], sourceId: string) {
    const row = this.db
      .prepare(
        "SELECT json FROM records WHERE kind='message' AND json_extract(json,'$.source')=? AND json_extract(json,'$.sourceId')=? LIMIT 1",
      )
      .get(source, sourceId);
    return row ? Message.parse(JSON.parse(String(row.json))) : undefined;
  }
  latestRevision(draftId: string) {
    const row = this.db
      .prepare(
        "SELECT json FROM records WHERE kind='revision' AND json_extract(json,'$.draftId')=? ORDER BY json_extract(json,'$.version') DESC LIMIT 1",
      )
      .get(draftId);
    return row ? Revision.parse(JSON.parse(String(row.json))) : undefined;
  }
  latestRevisions() {
    return this.db
      .prepare(
        `SELECT r.json FROM records r WHERE r.kind='revision' AND NOT EXISTS (
      SELECT 1 FROM records newer WHERE newer.kind='revision' AND json_extract(newer.json,'$.draftId')=json_extract(r.json,'$.draftId')
      AND json_extract(newer.json,'$.version') > json_extract(r.json,'$.version')) ORDER BY r.rowid`,
      )
      .all()
      .map((r) => Revision.parse(JSON.parse(String(r.json))));
  }
  transaction<T>(fn: () => T): T {
    const depth = this.depth++;
    const name = "nested_" + depth;
    try {
      this.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : "SAVEPOINT " + name);
    } catch (e) {
      this.depth--;
      throw e;
    }
    try {
      const result = fn();
      this.db.exec(depth === 0 ? "COMMIT" : "RELEASE " + name);
      return result;
    } catch (e) {
      // SQLITE_FULL may already have rolled back the entire native transaction.
      if (this.db.isTransaction) {
        this.db.exec(depth === 0 ? "ROLLBACK" : "ROLLBACK TO " + name);
        if (depth) this.db.exec("RELEASE " + name);
      }
      throw e;
    } finally {
      this.depth--;
    }
  }
  delete(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  close() {
    this.db.close();
  }
}
