import { diagnosticContext } from "../adapters/diagnostics/context.ts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Conflict } from "../domain/rules.ts";
import type {
  Diagnostics,
  DiagnosticFields,
} from "../application/diagnostics.ts";

// Keeps the request ID through awaited calls without coupling application code to HTTP.
export function requestFields(req: FastifyRequest) {
  const path = req.url.split("?")[0] ?? "";
  const requestKind: NonNullable<DiagnosticFields["requestKind"]> =
    path === "/favicon.ico" || path === "/favicon.svg"
      ? "favicon"
      : path === "/.well-known/appspecific/com.chrome.devtools.json"
        ? "devtools-probe"
        : path.startsWith("/assets/") ||
            path.startsWith("/@vite/") ||
            path.startsWith("/src/")
          ? "asset"
          : path.startsWith("/api/creator/")
            ? "creator-api"
            : path.startsWith("/api/public/")
              ? "public-api"
              : "other";
  return {
    requestId: req.id,
    method: req.method,
    route: req.routeOptions.url ?? "unmatched",
    ...(!req.routeOptions.url ? { requestKind } : {}),
  };
}
export function requestDiagnostics(server: FastifyInstance, log: Diagnostics) {
  const failed = new WeakMap<FastifyRequest, Error>();
  server.addHook("onRequest", (req, reply, done) => {
    reply.header("X-Request-Id", req.id);
    diagnosticContext.run({ requestId: req.id }, done);
  });
  server.addHook("onError", async (req, _reply, error) => {
    failed.set(req, error);
  });
  server.addHook("onResponse", async (req, reply) => {
    const error = failed.get(req);
    log.event(
      reply.statusCode >= 500 ||
        (error &&
          reply.statusCode >= 400 &&
          !(error instanceof z.ZodError) &&
          !(error instanceof Conflict))
        ? "error"
        : reply.statusCode >= 400
          ? "warn"
          : ["GET", "HEAD"].includes(req.method)
            ? "debug"
            : "info",
      error ? "http.failed" : "http.completed",
      {
        ...requestFields(req),
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      error,
    );
  });
}
