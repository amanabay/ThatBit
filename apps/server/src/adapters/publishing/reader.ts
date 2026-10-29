import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import {
  mkdir,
  writeFile,
  rename,
  stat,
  open,
  rm,
  readdir,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import staticFiles from "@fastify/static";
import { z } from "zod";
import {
  Manifest,
  RemoteRecord,
} from "../../../../../shared/contracts/publishing.ts";
import { Id } from "../../../../../shared/contracts/models.ts";
import { SQLiteStore } from "../storage/sqlite.ts";
import { FFmpegMedia } from "../media/ffmpeg.ts";
import { claimOwner } from "../storage/owner.ts";
export async function readerServer(
  root: string,
  key: string,
  web = resolve("dist"),
) {
  if (key.length < 32)
    throw new Error("Reader writer key must contain at least 32 characters.");
  await mkdir(join(root, "media"), { recursive: true, mode: 0o700 });
  const release = claimOwner(join(root, "reader.sqlite"));
  const db = new SQLiteStore(join(root, "reader.sqlite"));
  const server = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
  let uploading = false;
  server.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_r, b, done) => done(null, b),
  );
  server.addHook("onClose", async () => {
    db.close();
    release();
  });
  server.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    if (req.routeOptions.url?.startsWith("/management/")) {
      const value = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (
        Buffer.byteLength(value) !== Buffer.byteLength(key) ||
        !timingSafeEqual(Buffer.from(value), Buffer.from(key))
      )
        return reply
          .code(401)
          .send({ error: "Writer authentication required." });
    }
  });
  server.setErrorHandler((e, _r, reply) => {
    void reply.code(e instanceof z.ZodError ? 400 : 409).send({
      error: "Reader operation rejected. Check generation, checksum and media.",
    });
  });
  const record = (id: string) => db.get("remote", id, RemoteRecord);
  const file = (id: string, g: number) =>
    join(root, "media", `${id}.${g}.webm`);
  const prune = async (startup = false) => {
    for (const name of await readdir(join(root, "media"))) {
      const m = /^([a-zA-Z0-9_-]{1,100})\.(\d+)\.webm$/.exec(name);
      if (m?.[1]) {
        const r = record(m[1]);
        if (!r || r.state === "removed" || r.generation !== Number(m[2]))
          await rm(join(root, "media", name), { force: true });
      } else if (startup && name.endsWith(".tmp")) {
        await rm(join(root, "media", name), { force: true });
      }
    }
  };
  await prune(true);
  const limits = new Map<string, { at: number; count: number }>();
  server.addHook("onRequest", async (req, reply) => {
    if (
      req.routeOptions.url?.startsWith("/management/") ||
      req.url === "/healthz"
    )
      return;
    const now = Date.now();
    if (limits.size >= 1000) limits.clear();
    let bucket = limits.get(req.ip);
    if (!bucket || now - bucket.at > 60000) {
      bucket = { at: now, count: 0 };
      limits.set(req.ip, bucket);
    }
    if (++bucket.count > 120)
      return reply
        .code(429)
        .send({ error: "Too many requests; try again shortly." });
  });
  server.get("/healthz", async () => ({ ok: true }));
  server.get<{ Params: { id: string } }>(
    "/management/replies/:id",
    async (req, reply) =>
      record(Id.parse(req.params.id)) ?? reply.code(404).send(),
  );
  server.put<{ Params: { id: string } }>(
    "/management/replies/:id",
    async (req) => {
      const id = Id.parse(req.params.id);
      const m = Manifest.parse(req.body);
      if (m.reply.id !== id) throw new Error("ID mismatch");
      return db.transaction(() => {
        const prior = record(id);
        if (
          prior &&
          (prior.generation > m.generation ||
            (prior.generation === m.generation && prior.state === "removed"))
        )
          throw new Error("Withdrawn generation");
        if (prior?.generation === m.generation) {
          if (JSON.stringify(prior.manifest) !== JSON.stringify(m))
            throw new Error("Manifest changed");
          return prior;
        }
        if (
          db
            .list("remote", RemoteRecord)
            .reduce((n, r) => n + (r.manifest?.bytes ?? 0), 0) +
            m.bytes >
          5 * 1024 ** 3
        )
          throw new Error("Reader quota exceeded");
        const next = {
          id,
          generation: m.generation,
          state: "staged",
          manifest: m,
        };
        db.put("remote", id, next);
        return next;
      });
    },
  );
  server.put<{ Params: { id: string; generation: string } }>(
    "/management/replies/:id/:generation/video",
    async (req) => {
      if (uploading) throw new Error("Upload busy");
      const id = Id.parse(req.params.id);
      const generation = z.coerce
        .number()
        .int()
        .positive()
        .parse(req.params.generation);
      const initial = record(id);
      if (
        initial?.generation !== generation ||
        initial.state === "removed" ||
        !initial.manifest ||
        !Buffer.isBuffer(req.body)
      )
        throw new Error("Not staged");
      const body = req.body;
      if (
        body.length !== initial.manifest.bytes ||
        createHash("sha256").update(body).digest("hex") !==
          initial.manifest.sha256
      )
        throw new Error("Checksum mismatch");
      if (initial.state === "available") return initial;
      uploading = true;
      const temp = file(id, generation) + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temp, body, { mode: 0o600, flush: true });
        const probe = await new FFmpegMedia(root).inspect(temp);
        if (
          Math.abs(probe.format.duration - initial.manifest.reply.duration) >
          0.25
        )
          throw new Error("Duration mismatch");
        await rename(temp, file(id, generation));
        const dir = await open(join(root, "media"), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
        return db.transaction(() => {
          const current = record(id);
          if (current?.generation !== generation || current.state === "removed")
            throw new Error("Withdrawn during upload");
          const next = { ...current, state: "available" };
          db.put("remote", id, next);
          return next;
        });
      } finally {
        await rm(temp, { force: true });
        uploading = false;
        await prune();
      }
    },
  );
  server.delete<{ Params: { id: string; generation: string } }>(
    "/management/replies/:id/:generation",
    async (req) => {
      const id = Id.parse(req.params.id);
      const generation = z.coerce
        .number()
        .int()
        .positive()
        .parse(req.params.generation);
      const removed = db.transaction(() => {
        const prior = record(id);
        if (prior && prior.generation > generation)
          throw new Error("Stale withdrawal");
        const next = { id, generation, state: "removed", manifest: null };
        db.put("remote", id, next);
        return next;
      });
      await prune();
      return removed;
    },
  );
  server.get<{ Params: { id: string } }>(
    "/api/public/replies/:id",
    async (req, reply) => {
      const r = record(Id.parse(req.params.id));
      return r?.state === "available"
        ? r.manifest?.reply
        : reply.code(410).send({ error: "Replay unavailable." });
    },
  );
  server.get<{ Params: { id: string; kind: string } }>(
    "/api/public/replies/:id/:kind",
    async (req, reply) => {
      const r = record(Id.parse(req.params.id));
      if (r?.state !== "available" || !r.manifest)
        return reply.code(410).send({ error: "Replay unavailable." });
      if (req.params.kind === "captions") {
        const t = (s: number) =>
          new Date(Math.round(s * 1000)).toISOString().slice(11, 23);
        return reply
          .type("text/vtt")
          .send(
            "WEBVTT\n\n" +
              r.manifest.reply.captions
                .map(
                  (c, i) =>
                    `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${c.text.replace(/[<>]/g, "").replace(/-->/g, "→")}\n`,
                )
                .join("\n"),
          );
      }
      if (req.params.kind !== "video") return reply.code(404).send();
      const path = file(r.id, r.generation);
      const size = (await stat(path)).size;
      reply.type("video/webm").header("Accept-Ranges", "bytes");
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      if (req.headers.range && !m) return reply.code(416).send();
      if (m) {
        const start = Number(m[1]),
          end = Math.min(Number(m[2] || size - 1), size - 1);
        if (start >= size || end < start) return reply.code(416).send();
        return reply
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${size}`)
          .header("Content-Length", end - start + 1)
          .send(createReadStream(path, { start, end }));
      }
      return reply.header("Content-Length", size).send(createReadStream(path));
    },
  );
  await server.register(staticFiles, { root: web, wildcard: false });
  server.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/management/"))
      return reply.code(404).send();
    return reply.sendFile("index.html");
  });
  return server;
}
