import { Waveform } from "../../../../shared/contracts/capture.ts";
import type { ObsCapture } from "../adapters/obs/client.ts";
import type { ObsBuffer } from "../application/obs-buffer.ts";
import type { Assistance } from "../application/assistance.ts";
import type { Publishing } from "../application/publishing.ts";
import type { Captures } from "../application/capture.ts";
import type { Intelligence } from "../application/intelligence.ts";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { Asset, Id } from "../../../../shared/contracts/models.ts";
import { Conflict } from "../domain/rules.ts";
import type { Exchanges } from "../application/exchanges.ts";
import type { Twitch } from "../adapters/twitch/client.ts";
import {
  quietDiagnostics,
  type Diagnostics,
} from "../application/diagnostics.ts";
import { requestDiagnostics } from "./diagnostics.ts";
import { ObsInspection } from "../../../../shared/contracts/studio.ts";
import type { Operations } from "../application/operations.ts";
import { Reviews } from "../application/reviews.ts";
import { InboxQuery } from "../../../../shared/contracts/inbox.ts";
function vtt(captions: { start: number; end: number; text: string }[]) {
  const time = (s: number) =>
    new Date(Math.round(s * 1000)).toISOString().slice(11, 23);
  return (
    "WEBVTT\n\n" +
    captions
      .map(
        (c, i) =>
          `${i + 1}\n${time(c.start)} --> ${time(c.end)}\n${c.text.replace(/-->/g, "→").replace(/[<>]/g, "")}\n`,
      )
      .join("\n")
  );
}
export async function createServer(
  app: Exchanges,
  options: {
    port: number;
    production: boolean;
    twitch?: Twitch;
    intelligence?: Intelligence;
    captures?: Captures;
    publishing?: Publishing;
    obs?: ObsCapture;
    obsBuffer?: ObsBuffer;
    assistance?: Assistance;
    diagnostics?: Diagnostics;
    inspectObs?: () => Promise<z.infer<typeof ObsInspection>>;
    operations?: Operations;
    waveform?: (
      source: string,
      duration: number,
    ) => Promise<ReturnType<typeof Waveform.parse>>;
  },
) {
  const server = Fastify({
    logger: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 250 * 1024 * 1024,
  });
  requestDiagnostics(server, options.diagnostics ?? quietDiagnostics);
  const secret = randomBytes(32).toString("hex");
  const origins = new Set([
    `http://localhost:${options.port}`,
    `http://127.0.0.1:${options.port}`,
  ]);
  server.addContentTypeParser(
    ["video/webm", "video/mp4", "application/octet-stream"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  server.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    const host = req.headers.host;
    if (
      host !== `localhost:${options.port}` &&
      host !== `127.0.0.1:${options.port}`
    )
      return reply.code(403).send({ error: "Untrusted host." });
    if (req.headers.origin && !origins.has(req.headers.origin))
      return reply.code(403).send({ error: "Untrusted origin." });
    if (
      req.url.startsWith("/api/creator/") &&
      req.url !== "/api/creator/session"
    ) {
      const auth = req.headers["x-creator-token"];
      const cookie = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("creator="))
        ?.slice(8);
      const value = typeof auth === "string" ? auth : cookie;
      if (
        !value ||
        value.length !== secret.length ||
        !timingSafeEqual(Buffer.from(value), Buffer.from(secret))
      )
        return reply
          .code(401)
          .send({ error: "Open this app locally to sign in." });
      if (req.method !== "GET" && auth !== secret)
        return reply
          .code(403)
          .send({ error: "Creator action token required." });
    }
  });
  server.setErrorHandler((error, req, reply) => {
    const status =
      error instanceof Conflict
        ? 409
        : error instanceof z.ZodError
          ? 400
          : error instanceof Error &&
              "statusCode" in error &&
              typeof error.statusCode === "number" &&
              error.statusCode >= 400 &&
              error.statusCode <= 599
            ? error.statusCode
            : 500;
    void reply.code(status).send({
      requestId: req.id,
      error:
        status === 500
          ? "Operation failed. Check media availability and configuration."
          : error instanceof Error
            ? error.message
            : "Invalid request",
    });
  });
  server.get("/api/creator/session", async (req, reply) => {
    if (req.headers["sec-fetch-site"] === "cross-site")
      return reply.code(403).send();
    reply.header(
      "Set-Cookie",
      `creator=${secret}; HttpOnly; SameSite=Strict; Path=/api/creator`,
    );
    return { token: secret };
  });
  server.get("/api/creator/state", async () => ({
    ...app.state(),
    twitch: options.twitch?.status ?? "Not configured",
    creator: app.creator,
    obs: options.obs?.status ?? "OBS not configured",
    obsHealth: options.obs?.health(),
    obsSegments: options.obsBuffer?.list() ?? [],
    assistance:
      options.assistance?.status() ?? "Local suggestions not configured",
    readerUrl: options.publishing?.baseUrl ?? "",
    synchronization: options.publishing?.list() ?? [],
    analysisJobs: options.intelligence?.list() ?? [],
    captures: options.captures?.list() ?? [],
  }));
  server.get("/api/creator/assistance", async () => ({
    jobs: options.assistance?.list() ?? [],
  }));
  server.get(
    "/api/creator/suggestions/:draftId",
    async (req) =>
      options.assistance?.evidence(
        z.object({ draftId: Id }).parse(req.params).draftId,
      ) ?? { snapshot: null, transcript: null },
  );
  server.post(
    "/api/creator/assistance/:id/:action",
    { bodyLimit: 1024 },
    async (req) => {
      if (!options.assistance) throw new Conflict("Assistance unavailable.");
      const { id, action } = z
        .object({ id: Id, action: z.enum(["cancel", "retry"]) })
        .parse(req.params);
      const { generation } = z
        .object({ generation: z.number().int().positive() })
        .strict()
        .parse(req.body);
      options.assistance.control(id, generation, action);
      return { ok: true };
    },
  );
  let waveformWork:
    | { key: string; promise: Promise<ReturnType<typeof Waveform.parse>> }
    | undefined;
  server.get("/api/creator/media/:id/waveform", async (req) => {
    const id = z.object({ id: Id }).parse(req.params).id;
    const asset = app.store.get("asset", id, Asset);
    if (!asset || !app.media.exists(id))
      throw new Conflict("Recording unavailable.");
    if (!asset.audio)
      return { duration: asset.duration, peaks: [0], status: "no-audio" };
    const key = asset.sha256 + ":peaks-v1";
    const cached = app.store.get("waveform", key, Waveform);
    if (cached) return cached;
    if (waveformWork?.key === key) return waveformWork.promise;
    if (!options.waveform || waveformWork)
      throw new Conflict(
        "Waveform unavailable or busy. Numeric controls remain available.",
      );
    const generate = options.waveform;
    const promise = Promise.resolve()
      .then(() => generate(app.media.source(id), asset.duration))
      .then((value) => {
        const result = Waveform.parse(value);
        app.store.put("waveform", key, result);
        return result;
      })
      .catch(() => {
        throw new Conflict(
          "Waveform could not be generated. Numeric controls remain available.",
        );
      })
      .finally(() => {
        waveformWork = undefined;
      });
    waveformWork = { key, promise };
    return promise;
  });
  let inspecting = false;
  const reviews = new Reviews(app);
  server.get("/api/creator/inbox", async (req) =>
    app.store.inbox(InboxQuery.parse(req.query)),
  );
  server.get("/api/creator/proposal-reviews/export", async (_req, reply) => {
    reply.header(
      "Content-Disposition",
      'attachment; filename="private-original-proposals.json"',
    );
    return reviews.exportProposals();
  });
  server.get("/api/creator/proposal-reviews/:snapshotId", async (req) => ({
    review: reviews.latestProposal(
      z.object({ snapshotId: Id }).parse(req.params).snapshotId,
    ),
  }));
  server.post(
    "/api/creator/proposal-reviews/:snapshotId",
    { bodyLimit: 4096 },
    async (req) => ({
      review: reviews.recordProposal(
        z.object({ snapshotId: Id }).parse(req.params).snapshotId,
        req.body,
      ),
    }),
  );
  server.get("/api/creator/reviews/export", async (_req, reply) => {
    reply.header(
      "Content-Disposition",
      'attachment; filename="private-reply-reviews.json"',
    );
    return reviews.export();
  });
  server.get("/api/creator/reviews/:revisionId", async (req) => ({
    review: reviews.latest(
      z.object({ revisionId: Id }).parse(req.params).revisionId,
    ),
  }));
  server.post(
    "/api/creator/reviews/:revisionId",
    { bodyLimit: 4096 },
    async (req) => ({
      review: reviews.record(
        z.object({ revisionId: Id }).parse(req.params).revisionId,
        req.body,
      ),
    }),
  );
  server.get("/api/creator/operations", async () => {
    if (!options.operations)
      throw new Conflict("Resource sampling unavailable.");
    return options.operations.sample();
  });
  server.get("/api/creator/obs/inspect", async () => {
    if (!options.inspectObs)
      throw new Conflict(
        "Configure OBS and its authenticated WebSocket before checking audio.",
      );
    if (inspecting) throw new Conflict("An OBS check is already running.");
    inspecting = true;
    try {
      return ObsInspection.parse(await options.inspectObs());
    } catch {
      throw new Conflict(
        "OBS check failed. Keep OBS open and verify its authenticated WebSocket; npm run obs:doctor provides local recovery steps.",
      );
    } finally {
      inspecting = false;
    }
  });
  let clientReports = { at: Date.now(), count: 0 };
  server.post(
    "/api/creator/diagnostics",
    { bodyLimit: 1024 },
    async (req, reply) => {
      const { kind } = z
        .object({ kind: z.enum(["runtime_error", "unhandled_rejection"]) })
        .strict()
        .parse(req.body);
      if (Date.now() - clientReports.at >= 60000)
        clientReports = { at: Date.now(), count: 0 };
      if (++clientReports.count > 10)
        return reply
          .code(429)
          .send({ error: "Diagnostic reporting limit reached." });
      (options.diagnostics ?? quietDiagnostics).event(
        "error",
        "client." + kind,
        { requestId: req.id },
      );
      return reply.code(204).send();
    },
  );
  server.post("/api/creator/obs/snapshot", async (req) => {
    if (!options.obsBuffer) throw new Conflict("OBS buffer unavailable.");
    const { assetIds } = z.object({ assetIds: z.array(Id) }).parse(req.body);
    return options.obsBuffer.snapshot(assetIds);
  });
  server.post("/api/creator/captures", async (req) => {
    if (!options.captures) throw new Conflict("Capture unavailable.");
    return options.captures.start(req.body);
  });
  server.put<{
    Params: { id: string; sequence: string };
    Querystring: { elapsed: string; timecode: string };
  }>(
    "/api/creator/captures/:id/chunks/:sequence",
    { bodyLimit: 8 * 1024 * 1024 },
    async (req) => {
      if (!options.captures || !Buffer.isBuffer(req.body))
        throw new Conflict("Capture unavailable or invalid chunk.");
      return options.captures.append(
        Id.parse(req.params.id),
        z.coerce.number().int().nonnegative().parse(req.params.sequence),
        req.body,
        z.coerce.number().nonnegative().parse(req.query.elapsed),
        z.coerce.number().nonnegative().parse(req.query.timecode),
      );
    },
  );
  server.post<{ Params: { id: string } }>(
    "/api/creator/captures/:id/snapshot",
    async (req) => {
      if (!options.captures) throw new Conflict("Capture unavailable.");
      const b = z
        .object({
          finish: z.boolean(),
          expectedSequence: z.number().int().nonnegative().optional(),
        })
        .parse(req.body);
      return options.captures.snapshot(
        Id.parse(req.params.id),
        b.finish,
        b.expectedSequence,
      );
    },
  );
  server.post<{ Params: { id: string } }>(
    "/api/creator/captures/:id/interrupt",
    async (req) => {
      if (!options.captures) throw new Conflict("Capture unavailable.");
      options.captures.interrupt(Id.parse(req.params.id));
      return { ok: true };
    },
  );
  server.delete<{ Params: { id: string } }>(
    "/api/creator/captures/:id",
    async (req) => {
      if (!options.captures) throw new Conflict("Capture unavailable.");
      await options.captures.discard(Id.parse(req.params.id));
      return { ok: true };
    },
  );
  server.post<{ Params: { id: string } }>(
    "/api/creator/publications/:id/publish",
    async (req) => {
      if (!options.publishing) throw new Conflict("Reader not configured.");
      return options.publishing.queue(Id.parse(req.params.id));
    },
  );
  server.post<{ Params: { id: string } }>(
    "/api/creator/synchronization/:id/retry",
    async (req) => {
      if (!options.publishing) throw new Conflict("Reader not configured");
      options.publishing.retry(Id.parse(req.params.id));
      return { ok: true };
    },
  );
  server.post("/api/creator/media", async (req) => {
    if (!Buffer.isBuffer(req.body))
      throw new Conflict("Upload a recording file.");
    return app.ingest(req.body);
  });
  server.post("/api/creator/messages", async (req) => {
    const b = z
      .object({
        author: z.string().min(1).max(80),
        text: z.string().min(1).max(2000),
      })
      .parse(req.body);
    const id = randomUUID();
    app.message({
      ...b,
      id,
      userId: id,
      sourceId: id,
      receivedAt: new Date().toISOString(),
      source: "manual",
      removed: false,
    });
    return { id };
  });
  server.post<{ Params: { id: string } }>(
    "/api/creator/drafts/:id/transcribe",
    async (req) => {
      if (!options.intelligence)
        throw new Conflict("Local transcription is not configured.");
      return options.intelligence.enqueue(
        Id.parse(req.params.id),
        z.object({ version: z.number().int().positive() }).parse(req.body)
          .version,
      );
    },
  );
  server.get<{ Params: { id: string } }>(
    "/api/creator/analysis/:id",
    async (req) => {
      if (!options.intelligence)
        throw new Conflict("Local transcription is not configured.");
      return options.intelligence.result(Id.parse(req.params.id));
    },
  );
  server.delete<{ Params: { id: string } }>(
    "/api/creator/analysis/:id",
    async (req) => {
      if (!options.intelligence)
        throw new Conflict("Local transcription is not configured.");
      return options.intelligence.cancel(Id.parse(req.params.id));
    },
  );
  server.delete<{ Params: { id: string } }>(
    "/api/creator/drafts/:id",
    async (req) => {
      app.discard(Id.parse(req.params.id));
      return { ok: true };
    },
  );
  server.put<{ Params: { id: string } }>(
    "/api/creator/drafts/:id",
    async (req) => app.save(Id.parse(req.params.id), req.body),
  );
  server.post<{ Params: { id: string } }>(
    "/api/creator/drafts/:id/approve",
    async (req) =>
      app.approve(
        Id.parse(req.params.id),
        z.object({ version: z.number().int() }).parse(req.body).version,
      ),
  );
  server.delete<{ Params: { id: string } }>(
    "/api/creator/publications/:id",
    async (req) => {
      app.remove(Id.parse(req.params.id));
      return { ok: true };
    },
  );
  server.post<{ Params: { id: string } }>(
    "/api/creator/publications/:id/retry-render",
    async (req) => app.retryRender(Id.parse(req.params.id)),
  );
  server.post<{ Params: { id: string } }>(
    "/api/creator/publications/:id/portrait",
    async (req) => {
      await app.portrait(Id.parse(req.params.id));
      return { ok: true };
    },
  );
  server.post<{ Params: { id: string } }>(
    "/api/creator/publications/:id/share",
    async (req) => {
      if (!options.twitch) throw new Conflict("Connect Twitch first.");
      return options.twitch.share(Id.parse(req.params.id));
    },
  );
  async function stream(
    path: string,
    req: { headers: { range?: string | undefined } },
    reply: import("fastify").FastifyReply,
  ) {
    if (!existsSync(path))
      return reply.code(410).send({ error: "Recording unavailable." });
    const size = (await stat(path)).size;
    reply.type("video/webm").header("Accept-Ranges", "bytes");
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (req.headers.range && !match)
      return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    if (match) {
      const start = Number(match[1]);
      const end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1);
      if (start >= size || end < start) return reply.code(416).send();
      reply
        .code(206)
        .header("Content-Range", `bytes ${start}-${end}/${size}`)
        .header("Content-Length", end - start + 1);
      return reply.send(createReadStream(path, { start, end }));
    }
    reply.header("Content-Length", size);
    return reply.send(createReadStream(path));
  }
  server.get<{ Params: { id: string } }>(
    "/api/creator/media/:id",
    async (req, reply) => {
      const a = app.store.get("asset", Id.parse(req.params.id), Asset);
      if (!a) return reply.code(404).send();
      return stream(app.media.source(a.id), req, reply);
    },
  );
  server.get<{ Params: { id: string } }>(
    "/api/public/replies/:id",
    async (req, reply) =>
      app.publicReply(Id.parse(req.params.id)) ??
      reply
        .code(410)
        .send({ error: "This replay is unavailable or has been removed." }),
  );
  server.get<{ Params: { id: string; kind: string } }>(
    "/api/public/replies/:id/:kind",
    async (req, reply) => {
      const id = Id.parse(req.params.id);
      const dto = app.publicReply(id);
      if (!dto) return reply.code(410).send({ error: "Replay unavailable." });
      if (req.params.kind === "captions")
        return reply.type("text/vtt").send(vtt(dto.captions));
      if (req.params.kind === "video" || req.params.kind === "portrait") {
        if (
          req.params.kind === "portrait" &&
          !app.state().publications.find((p) => p.id === id)?.portrait
        )
          return reply.code(404).send();
        return stream(app.media.derived(id, req.params.kind), req, reply);
      }
      return reply.code(404).send();
    },
  );
  if (options.production) {
    await server.register(fastifyStatic, {
      root: resolve("dist"),
      wildcard: false,
    });
    server.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send();
      return reply.sendFile("index.html");
    });
  } else {
    const { createServer: viteServer } = await import("vite");
    const vite = await viteServer({
      configFile: resolve("vite.config.ts"),
      server: { middlewareMode: true, hmr: false },
    });
    server.addHook("onClose", () => vite.close());
    server.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send();
      reply.hijack();
      vite.middlewares(req.raw, reply.raw, () => {
        reply.raw.statusCode = 404;
        reply.raw.end();
      });
    });
  }
  return server;
}
