import { captionVtt } from "../../../../shared/contracts/captions.ts";
// Separate hosted role: no creator services, database, credentials, or intake.
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";
import { Id, PublicReply } from "../../../../shared/contracts/models.ts";
import { randomUUID } from "node:crypto";
import { runLogged } from "../adapters/diagnostics/runtime.ts";
import { requestDiagnostics } from "./diagnostics.ts";
import { readerShell } from "../adapters/publishing/preview.ts";
const root = resolve(process.env.BUNDLE_DIR ?? "public-bundle");
await runLogged(
  "static-reader",
  resolve(process.env.DATA_DIR ?? ".data"),
  async (log) => {
    const server = Fastify({
      logger: false,
      requestIdHeader: false,
      genReqId: () => randomUUID(),
    });
    requestDiagnostics(server, log);
    server.get("/favicon.ico", async (_req, reply) =>
      reply.redirect("/favicon.svg"),
    );
    server.setErrorHandler((_error, req, reply) => {
      void reply
        .code(500)
        .send({ error: "Reader operation failed.", requestId: req.id });
    });
    server.addHook("onRequest", async (_req, reply) => {
      reply
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer");
    });
    const buckets = new Map<string, { at: number; count: number }>();
    server.addHook("onRequest", async (req, reply) => {
      const now = Date.now();
      if (buckets.size > 1000) buckets.clear();
      let b = buckets.get(req.ip);
      if (!b || now - b.at > 60000) {
        b = { at: now, count: 0 };
        buckets.set(req.ip, b);
      }
      if (++b.count > 120)
        return reply
          .code(429)
          .send({ error: "Too many requests. Try again shortly." });
    });
    async function get(id: string) {
      const replies = z
        .array(PublicReply)
        .parse(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
      return replies.find((p) => p.id === id);
    }
    server.get<{ Params: { id: string } }>(
      "/api/public/replies/:id",
      async (req, reply) => {
        const id = Id.safeParse(req.params.id);
        const dto = id.success ? await get(id.data) : undefined;
        return (
          dto ??
          reply.code(410).send({ error: "Replay removed or unavailable." })
        );
      },
    );
    server.get<{ Params: { id: string; kind: string } }>(
      "/api/public/replies/:id/:kind",
      async (req, reply) => {
        const id = Id.safeParse(req.params.id);
        const dto = id.success ? await get(id.data) : undefined;
        if (!dto) return reply.code(410).send({ error: "Replay unavailable." });
        if (req.params.kind === "captions") {
          return reply.type("text/vtt").send(captionVtt(dto.captions));
        }
        if (req.params.kind !== "video") return reply.code(404).send();
        const path = join(root, "media", dto.id + ".webm");
        const size = (await stat(path)).size;
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
        reply.type("video/webm").header("Accept-Ranges", "bytes");
        if (req.headers.range && !m) return reply.code(416).send();
        if (m) {
          const start = Number(m[1]);
          const end = Math.min(Number(m[2] || size - 1), size - 1);
          if (start >= size || end < start) return reply.code(416).send();
          reply
            .code(206)
            .header("Content-Range", `bytes ${start}-${end}/${size}`)
            .header("Content-Length", end - start + 1);
          return reply.send(createReadStream(path, { start, end }));
        }
        return reply
          .header("Content-Length", size)
          .send(createReadStream(path));
      },
    );
    const shell = async () =>
      readerShell(await readFile(join(root, "web", "index.html"), "utf8"));
    for (const url of ["/", "/index.html"])
      server.get(url, async (_req, reply) =>
        reply.type("text/html").send(await shell()),
      );
    await server.register(fastifyStatic, {
      root: join(root, "web"),
      wildcard: false,
      index: false,
      globIgnore: ["index.html"],
    });
    server.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api/"))
        return reply
          .code(404)
          .send({ error: "Reader endpoint not found.", requestId: req.id });
      return reply.type("text/html").send(await shell());
    });
    await server.listen({
      port: Number(process.env.PORT ?? 8080),
      host: process.env.READER_HOST ?? "127.0.0.1",
    });
    log.event("info", "service.ready", {
      port: Number(process.env.PORT ?? 8080),
    });
    let stopping = false;
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        log.event("info", "service.stopping");
        void server.close().then(() => {
          log.event("info", "service.stopped");
          process.exit(0);
        });
      });
  },
);
