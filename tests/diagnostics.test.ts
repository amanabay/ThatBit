import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDiagnostics } from "../apps/server/src/adapters/diagnostics/logger.ts";
import { createServer } from "../apps/server/src/http/server.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { Intelligence } from "../apps/server/src/application/intelligence.ts";
import { seed } from "../scripts/demo.ts";
import { z } from "zod";
import { TranscriptionAudioError } from "../apps/server/src/application/transcription-error.ts";

test("diagnostics redact arbitrary content, errors and paths while keeping codes and session/job correlation", () => {
  const lines: string[] = [];
  const log = createDiagnostics({
    service: "creator",
    format: "json",
    write: (line) => lines.push(line),
  });
  const id = randomUUID();
  const privateValue = "SECRET_CHAT_TRANSCRIPT_TOKEN";
  const error = Object.assign(
    new Error(
      `private /recordings/${privateValue}.mkv\nBearer ${privateValue}`,
      { cause: new Error(privateValue) },
    ),
    { code: "ENOSPC" },
  );
  error.stack = `Error: ${privateValue}\n at work (/home/private/project/apps/server/src/application/exchanges.ts:12:4)\n at private (/recordings/${privateValue}.mkv:4:2)`;
  log.event("debug", "http.completed");
  log.event(
    "error",
    "render.failed",
    {
      jobId: id,
      route: "/api/private?token=" + privateValue,
      ...{
        body: privateValue,
        authorization: privateValue,
        path: privateValue,
      },
    },
    error,
  );
  log.event("warn", "logging.test", { requestId: privateValue });
  assert.equal(lines.length, 2);
  const entry = JSON.parse(lines[0] ?? "{}");
  assert.equal(entry.errorCode, "ENOSPC");
  assert.equal(entry.jobId, id);
  assert.deepEqual(entry.locations, [
    "apps/server/src/application/exchanges.ts:12:4",
  ]);
  assert.equal(entry.sessionId, JSON.parse(lines[1] ?? "{}").sessionId);
  assert.ok(!lines.join("").includes(privateValue));
  assert.ok(!lines.join("").includes("/home/private"));
  log.event(
    "error",
    "transcription.failed",
    {},
    new z.ZodError([
      { code: "custom", path: [privateValue], message: privateValue },
    ]),
  );
  assert.equal(JSON.parse(lines[2] ?? "{}").errorCode, "VALIDATION_FAILED");
  assert.ok(!lines.join("").includes(privateValue));
  log.event(
    "error",
    "transcription.failed",
    {},
    new TranscriptionAudioError("silent"),
  );
  assert.equal(
    JSON.parse(lines.at(-1) ?? "{}").errorCode,
    "MEDIA_AUDIO_SILENT",
  );
});

test("diagnostic files rotate, use private permissions and degrade to CLI if their destination fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-logs-"));
  try {
    const console: string[] = [];
    const log = createDiagnostics({
      service: "creator",
      directory: dir,
      maxBytes: 700,
      write: (line) => console.push(line),
    });
    for (let i = 0; i < 30; i++)
      log.event("info", "render.started", { attempt: i });
    assert.deepEqual((await readdir(dir)).sort(), [
      "creator.log",
      "creator.log.1",
      "creator.log.2",
    ]);
    for (const file of await readdir(dir)) {
      const path = join(dir, file);
      assert.ok((await stat(path)).size <= 700);
      if (process.platform !== "win32")
        assert.equal((await stat(path)).mode & 0o777, 0o600);
      for (const line of (await readFile(path, "utf8")).trim().split("\n"))
        assert.ok(JSON.parse(line).sessionId);
    }
    const blocker = join(dir, "not-a-directory");
    await writeFile(blocker, "fixture");
    const broken = createDiagnostics({
      service: "reader",
      directory: join(blocker, "logs"),
      write: (line) => console.push(line),
    });
    assert.doesNotThrow(() => broken.event("error", "publishing.failed"));
    assert.equal(
      console.filter((line) => line.includes("logging.file_unavailable"))
        .length,
      1,
    );
    assert.ok(console.at(-1)?.includes("publishing.failed"));
    const silent = createDiagnostics({
      service: "creator",
      level: "silent",
      directory: join(dir, "silent"),
      write: () => {
        throw Error("Must not write");
      },
    });
    silent.event("error", "service.failed");
    assert.ok(!(await readdir(dir)).includes("silent"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP failures and actions log safe route templates, fresh request IDs and actionable failure codes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-log-http-"));
  const lines: string[] = [];
  const log = createDiagnostics({
    service: "creator",
    format: "json",
    write: (line) => lines.push(line),
  });
  const store = new SQLiteStore(join(dir, "db"));
  const app = new Exchanges(
    store,
    new FFmpegMedia(join(dir, "media")),
    "fixture",
    log,
  );
  const server = await createServer(app, {
    port: 4317,
    production: true,
    diagnostics: log,
  });
  try {
    const session = await server.inject({
      url: "/api/creator/session",
      headers: { host: "localhost:4317" },
    });
    const headers = {
      host: "localhost:4317",
      "x-creator-token": session.json().token as string,
      authorization: "Bearer PRIVATE_TOKEN",
      "x-request-id": "PRIVATE_UNTRUSTED_ID",
    };
    const failed = await server.inject({
      method: "PUT",
      url: "/api/creator/drafts/PRIVATE_DRAFT?token=PRIVATE_QUERY",
      headers,
      payload: { title: "PRIVATE_TITLE", captions: "PRIVATE_TRANSCRIPT" },
    });
    assert.equal(failed.statusCode, 400);
    const unmatched = await server.inject({
      url: "/api/creator/PRIVATE_MISSING?token=PRIVATE_QUERY",
      headers,
    });
    assert.equal(unmatched.statusCode, 404);
    const missingLog = lines
      .map((line) => JSON.parse(line))
      .find((entry) => entry.requestId === unmatched.headers["x-request-id"]);
    assert.equal(missingLog?.route, "unmatched");
    assert.equal(missingLog?.requestKind, "creator-api");
    assert.ok(!lines.join("").includes("PRIVATE_MISSING"));
    assert.equal(
      (await server.inject({ url: "/favicon.ico", headers })).headers.location,
      "/favicon.svg",
    );
    const id = failed.headers["x-request-id"];
    assert.equal(failed.json().requestId, id);
    assert.notEqual(id, "PRIVATE_UNTRUSTED_ID");
    assert.ok(
      lines.some(
        (line) =>
          line.includes(String(id)) &&
          line.includes("VALIDATION_FAILED") &&
          line.includes("/api/creator/drafts/:id"),
      ),
    );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/api/creator/diagnostics",
          headers: { host: "localhost:4317" },
          payload: { kind: "runtime_error" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/api/creator/diagnostics",
          headers,
          payload: { kind: "runtime_error", message: "PRIVATE_ERROR" },
        })
      ).statusCode,
      400,
    );
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await server.inject({
            method: "POST",
            url: "/api/creator/diagnostics",
            headers,
            payload: { kind: "runtime_error" },
          })
        ).statusCode,
        204,
      );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/api/creator/diagnostics",
          headers,
          payload: { kind: "runtime_error" },
        })
      ).statusCode,
      429,
    );
    assert.equal(
      lines.filter((line) => line.includes('"event":"client.runtime_error"'))
        .length,
      10,
    );
    const saved = await server.inject({
      method: "POST",
      url: "/api/creator/messages",
      headers,
      payload: { author: "PRIVATE_AUTHOR", text: "PRIVATE_CHAT" },
    });
    assert.equal(saved.statusCode, 200);
    assert.ok(
      lines.some(
        (line) =>
          line.includes("http.completed") &&
          line.includes("/api/creator/messages"),
      ),
    );
    assert.ok(!lines.join("").includes("PRIVATE_"));
  } finally {
    await server.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("caught render/transcription failures emit job diagnostics without changing bounded retries or leaking source content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-log-jobs-"));
  await seed(dir);
  const lines: string[] = [];
  const log = createDiagnostics({
    service: "creator",
    format: "json",
    write: (line) => lines.push(line),
  });
  const store = new SQLiteStore(join(dir, "replylink.sqlite"));
  const media = new FFmpegMedia(join(dir, "media"));
  const app = new Exchanges(store, media, "fixture", log);
  try {
    const r = app.state().drafts[0];
    assert.ok(r);
    media.render = async () => {
      throw new Error(
        "Media tool failed (1): PRIVATE_RECORDING stream map matches no streams",
      );
    };
    const p = app.approve(r.draftId, r.version);
    await app.work();
    assert.ok(
      lines.some(
        (line) =>
          line.includes(p.id) &&
          line.includes("MEDIA_AUDIO_TRACK_MISSING") &&
          line.includes('"retry":true'),
      ),
    );
    const analysis = new Intelligence(
      store,
      media,
      {
        name: "fixture",
        model: "PRIVATE_MODEL_PATH",
        transcribe: async () => {
          throw Object.assign(new Error("PRIVATE_TRANSCRIPT"), {
            code: "ENOENT",
          });
        },
      },
      Date.now,
      log,
    );
    const job = analysis.enqueue(r.draftId, r.version);
    await analysis.work();
    assert.equal(analysis.list()[0]?.state, "failed");
    assert.ok(
      lines.some(
        (line) =>
          line.includes(job.id) &&
          line.includes("transcription.failed") &&
          line.includes('"retry":false') &&
          line.includes("ENOENT"),
      ),
    );
    assert.ok(!lines.join("").includes("PRIVATE_"));
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("startup and unexpected runtime failures are logged once and exit unsuccessfully with sanitized output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-log-runtime-"));
  try {
    for (const operation of [
      'throw new Error("PRIVATE_STARTUP")',
      'setTimeout(() => { throw new Error("PRIVATE_ASYNC") }, 1)',
      'void Promise.reject(new Error("PRIVATE_REJECTION"))',
    ]) {
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `import {runLogged} from ${JSON.stringify(resolve("apps/server/src/adapters/diagnostics/runtime.ts"))}; await runLogged("creator", ${JSON.stringify(dir)}, async () => { ${operation}; });`,
        ],
        {
          env: {
            ...process.env,
            LOG_LEVEL: "info",
            LOG_FORMAT: "json",
            LOG_TO_FILE: "false",
          },
          timeout: 10000,
        },
      ).then(
        () => {
          throw Error("Expected process failure");
        },
        (error) => error as { code: number; stderr: string },
      );
      assert.equal(result.code, 1);
      assert.ok(
        /service\.(startup_failed|crashed|rejection)/.test(result.stderr),
      );
      assert.ok(!result.stderr.includes("PRIVATE_"));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
