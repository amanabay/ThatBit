import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import { diagnosticContext } from "./context.ts";
import { Conflict } from "../../domain/rules.ts";
import type {
  Diagnostics,
  DiagnosticFields,
} from "../../application/diagnostics.ts";

const ranks = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const hints: Record<string, string> = {
  "obs.not_configured":
    "Set OBS_RECORD_DIR, OBS_PASSWORD and OBS_AUDIO_TRACK in local .env, then restart.",
  "obs.unreachable":
    "Open OBS and enable its authenticated WebSocket server on loopback port 4455.",
  "obs.disconnected":
    "Check OBS authentication and recording continuity. The connection retries unless access ended.",
  "obs.split_failed":
    "Check that OBS supports split recording; import the original if a segment was missed.",
  "obs.queue_full":
    "Processing cannot keep up. Original OBS files remain available for manual import.",
  "twitch.login_failed":
    "Check local Twitch configuration and run npm run twitch:login with the app stopped.",
  "twitch.subscription_revoked":
    "Check Twitch login/scopes and restart intake after logging in again.",
  "transcription.model_changed":
    "Retry this analysis explicitly using the current local model.",
  "publishing.failed":
    "Check the managed reader health and writer configuration; retry keeps the approved revision.",
  "withdrawal.failed":
    "Keep creator and reader running; retry until removal is acknowledged.",
  "logging.configuration_failed":
    "Use LOG_LEVEL=debug|info|warn|error|silent, LOG_FORMAT=pretty|json and LOG_TO_FILE=true|false.",
};
const fixes: Record<string, string> = {
  ENOENT: "Check that the configured executable, model or source exists.",
  ENOSPC: "Free local disk space, then retry the operation.",
  EACCES: "Check local file or executable permissions.",
  EADDRINUSE: "Stop the process using this port or choose another port.",
  ECONNREFUSED: "Start the configured local service and check its port.",
  NETWORK_FAILED: "Check the service connection and retry.",
  TIMEOUT: "Check service responsiveness or media length before retrying.",
  CANCELLED: "The operation was cancelled.",
  VALIDATION_FAILED:
    "Check the saved interval, input format and provider output.",
  CONFLICT: "Check source availability, configuration and the saved revision.",
  MEDIA_FAILED:
    "Check FFmpeg support, the source video and selected audio track.",
  MEDIA_AUDIO_TRACK_MISSING:
    "The selected audio track is absent. Check OBS_AUDIO_TRACK and OBS recorded tracks.",
  MEDIA_AUDIO_SILENT:
    "The selected interval is digitally silent. Check OBS mute/device/track routing and record a new clip.",
  MEDIA_CODEC_UNAVAILABLE:
    "The local FFmpeg build lacks the requested encoder or filter.",
  MEDIA_INVALID_INPUT:
    "The media tool could not decode this recording. Verify the closed source file.",
  MODEL_UNAVAILABLE:
    "The local model could not be loaded. Check WHISPER_MODEL and rerun npm run ai:setup if needed.",
  UNKNOWN:
    "Check the component and code locations; verify its local configuration.",
};
function failure(error: unknown) {
  let code = error instanceof z.ZodError ? "VALIDATION_FAILED" : "UNKNOWN";
  if (error instanceof Error) {
    const native = "code" in error ? error.code : undefined;
    if (typeof native === "string" && Object.hasOwn(fixes, native))
      code = native;
    else if (error instanceof z.ZodError) code = "VALIDATION_FAILED";
    else if (error.name === "AbortError") code = "CANCELLED";
    else if (error.name === "TimeoutError" || /timed out/i.test(error.message))
      code = "TIMEOUT";
    else if (error instanceof Conflict) code = "CONFLICT";
    else if (/^Media tool failed/.test(error.message)) {
      code = /matches no streams/i.test(error.message)
        ? "MEDIA_AUDIO_TRACK_MISSING"
        : /unknown encoder|no such filter|encoder .*not found/i.test(
              error.message,
            )
          ? "MEDIA_CODEC_UNAVAILABLE"
          : /failed to (load|open).*model/i.test(error.message)
            ? "MODEL_UNAVAILABLE"
            : /invalid data found|error opening input/i.test(error.message)
              ? "MEDIA_INVALID_INPUT"
              : "MEDIA_FAILED";
    } else if (/fetch failed|Twitch HTTP|OBS disconnected/i.test(error.message))
      code = "NETWORK_FAILED";
    // Fetch stores network failures in cause. Inspect only known system codes.
    if (
      (code === "UNKNOWN" || code === "NETWORK_FAILED") &&
      error.cause instanceof Error &&
      "code" in error.cause &&
      typeof error.cause.code === "string" &&
      Object.hasOwn(fixes, error.cause.code)
    )
      code = error.cause.code;
  }
  // Never serialize Error/message/cause/stderr: they can contain tokens, paths or speech.
  const locations =
    error instanceof Error
      ? [
          ...(error.stack ?? "")
            .split("\n")
            .slice(1)
            .join("\n")
            .matchAll(
              /apps\/server\/src\/[a-zA-Z0-9_./-]+\.(?:ts|js):\d+:\d+/g,
            ),
        ]
          .slice(0, 5)
          .map((m) => m[0])
      : [];
  return {
    errorCode: code,
    hint: fixes[code],
    ...(locations.length ? { locations } : {}),
  };
}
function safeFields(fields: DiagnosticFields) {
  const result: Record<string, string | number | boolean> = {};
  for (const name of [
    "requestId",
    "jobId",
    "revisionId",
    "publicationId",
    "assetId",
  ] as const) {
    const value = fields[name];
    if (value && uuid.test(value)) result[name] = value;
  }
  for (const name of [
    "status",
    "durationMs",
    "attempt",
    "generation",
    "queueDepth",
    "count",
    "bytes",
    "port",
    "audioTrack",
  ] as const) {
    const value = fields[name];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      result[name] = Math.round(value * 100) / 100;
  }
  for (const name of ["retry", "configured"] as const)
    if (typeof fields[name] === "boolean") result[name] = fields[name];
  if (
    fields.method &&
    ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"].includes(
      fields.method,
    )
  )
    result.method = fields.method;
  // Caller supplies only registered route templates, never a raw URL/query/params.
  if (fields.route && /^[a-zA-Z0-9_/:.*-]{1,180}$/.test(fields.route))
    result.route = fields.route;
  return result;
}
export function createDiagnostics(options: {
  service: "creator" | "reader" | "static-reader";
  level?: keyof typeof ranks;
  format?: "pretty" | "json";
  directory?: string;
  maxBytes?: number;
  write?: (line: string) => void;
}): Diagnostics {
  const sessionId = randomUUID();
  const threshold = ranks[options.level ?? "info"];
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  let file = options.directory
    ? join(options.directory, options.service + ".log")
    : undefined;
  const write =
    options.write ??
    ((line: string) => {
      process.stderr.write(line);
    });
  let size = 0;
  const sinkFailed = () => {
    file = undefined;
    try {
      write(
        JSON.stringify({
          time: new Date().toISOString(),
          level: "error",
          service: options.service,
          sessionId,
          event: "logging.file_unavailable",
          hint: "Check log directory permissions and free disk space. CLI logging continues.",
        }) + "\n",
      );
    } catch {
      /* A closed terminal must not interrupt capture. */
    }
  };
  if (file && threshold < ranks.silent) {
    try {
      mkdirSync(options.directory!, { recursive: true, mode: 0o700 });
      if (existsSync(file)) {
        chmodSync(file, 0o600);
        size = statSync(file).size;
      }
    } catch {
      sinkFailed();
    }
  }
  return {
    event(level, event, fields = {}, error) {
      if (ranks[level] < threshold || !/^[a-z][a-z0-9_.]{1,80}$/.test(event))
        return;
      const record = {
        time: new Date().toISOString(),
        level,
        service: options.service,
        sessionId,
        event,
        ...safeFields({ ...diagnosticContext.getStore(), ...fields }),
        ...(error !== undefined ? failure(error) : {}),
        ...(hints[event] ? { hint: hints[event] } : {}),
      };
      const json = JSON.stringify(record) + "\n";
      const details = Object.entries(record)
        .filter(
          ([key]) =>
            ![
              "time",
              "level",
              "service",
              "sessionId",
              "event",
              "locations",
              "hint",
            ].includes(key),
        )
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ");
      const pretty = `${record.time} ${level.toUpperCase()} [${options.service}] ${event} session=${sessionId.slice(0, 8)}${details ? " " + details : ""}${"hint" in record ? " — " + record.hint : ""}${"locations" in record ? " at " + record.locations?.join(", ") : ""}\n`;
      try {
        write(options.format === "json" ? json : pretty);
      } catch {
        /* Closed console. */
      }
      if (file) {
        try {
          if (size + Buffer.byteLength(json) > maxBytes) {
            rmSync(file + ".2", { force: true });
            if (existsSync(file + ".1")) renameSync(file + ".1", file + ".2");
            if (existsSync(file)) renameSync(file, file + ".1");
            size = 0;
          }
          appendFileSync(file, json, { mode: 0o600 });
          size += Buffer.byteLength(json);
        } catch {
          sinkFailed();
        }
      }
    },
  };
}
export function processDiagnostics(
  service: "creator" | "reader" | "static-reader",
  root: string,
) {
  const local = existsSync(".env")
    ? parseEnv(readFileSync(".env", "utf8"))
    : {};
  const setting = (name: string) => process.env[name] ?? local[name];
  const level = setting("LOG_LEVEL") ?? "info";
  const format = setting("LOG_FORMAT") ?? "pretty";
  if (
    !Object.hasOwn(ranks, level) ||
    !["pretty", "json"].includes(format) ||
    ![undefined, "true", "false"].includes(setting("LOG_TO_FILE"))
  )
    throw new Error("Invalid logging configuration");
  return createDiagnostics({
    service,
    level: level as keyof typeof ranks,
    format: format as "pretty" | "json",
    ...(setting("LOG_TO_FILE") === "false"
      ? {}
      : { directory: join(root, "logs") }),
  });
}
