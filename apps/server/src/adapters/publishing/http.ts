import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  RemoteRecord,
  type Manifest,
} from "../../../../../shared/contracts/publishing.ts";
import type { Publisher } from "../../application/publishing.ts";
export class HttpPublisher implements Publisher {
  constructor(
    private base: string,
    private key: string,
    private derived: (id: string) => string,
  ) {
    const u = new URL(base);
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname)
      )
    )
      throw new Error("Remote readers require HTTPS.");
  }
  private async call(path: string, method: string, body?: string | Buffer) {
    const r = await fetch(this.base + path, {
      method,
      redirect: "error",
      headers: {
        Authorization: "Bearer " + this.key,
        "Content-Type":
          typeof body === "string"
            ? "application/json"
            : "application/octet-stream",
      },
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : new Uint8Array(body) }
        : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Reader rejected operation");
    return RemoteRecord.parse(await r.json());
  }
  async send(value: Omit<Manifest, "sha256" | "bytes">) {
    const bytes = await readFile(this.derived(value.reply.id));
    const manifest = {
      ...value,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    await this.call(
      "/management/replies/" + value.reply.id,
      "PUT",
      JSON.stringify(manifest),
    );
    const r = await this.call(
      `/management/replies/${value.reply.id}/${value.generation}/video`,
      "PUT",
      bytes,
    );
    if (r.state !== "available" || r.generation !== value.generation)
      throw new Error("Reader has not committed this revision");
  }
  async withdraw(id: string, generation: number) {
    const r = await this.call(
      `/management/replies/${id}/${generation}`,
      "DELETE",
    );
    if (r.state !== "removed") throw new Error("Withdrawal not acknowledged");
  }
}
