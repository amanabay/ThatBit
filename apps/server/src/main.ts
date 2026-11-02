import { creatorDatabase } from "./adapters/storage/collection.ts";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import { Retention } from "./application/retention.ts";
import { rm } from "node:fs/promises";
import { ObsCapture } from "./adapters/obs/client.ts";
import { inspectObs } from "./adapters/obs/inspect.ts";
import { waveform } from "./adapters/media/waveform.ts";
import { Operations } from "./application/operations.ts";
import { resourceSampler } from "./adapters/diagnostics/resources.ts";
import { ObsBuffer } from "./application/obs-buffer.ts";
import { assembleSegments } from "./adapters/obs/assemble.ts";
import { Assistance } from "./application/assistance.ts";
import { Publishing } from "./application/publishing.ts";
import { HttpPublisher } from "./adapters/publishing/http.ts";
import { Captures } from "./application/capture.ts";
import { LocalCaptureFiles } from "./adapters/capture/files.ts";
import { Intelligence } from "./application/intelligence.ts";
import { transcribe } from "./adapters/transcription/whisper.ts";
import { claimOwner } from "./adapters/storage/owner.ts";
import { resolve, join, basename } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { SQLiteStore } from "./adapters/storage/sqlite.ts";
import { FFmpegMedia } from "./adapters/media/ffmpeg.ts";
import { Exchanges } from "./application/exchanges.ts";
import { createServer } from "./http/server.ts";
import { Twitch } from "./adapters/twitch/client.ts";
import { runLogged } from "./adapters/diagnostics/runtime.ts";
import type { Diagnostics } from "./application/diagnostics.ts";
import { onShutdown } from "./adapters/runtime/shutdown.ts";
if (existsSync(".env")) process.loadEnvFile(".env");
if (existsSync(".data/models/runtime.env")) {
  const local = parseEnv(readFileSync(".data/models/runtime.env", "utf8"));
  for (const key of ["WHISPER_BIN", "WHISPER_MODEL", "MATCH_MODEL_DIR"])
    if (!process.env[key] && local[key]) process.env[key] = local[key];
}
async function main(log: Diagnostics) {
  const root = resolve(process.env.DATA_DIR ?? ".data");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = claimOwner(creatorDatabase(root));
  const store = new SQLiteStore(creatorDatabase(root));
  const app = new Exchanges(
    store,
    new FFmpegMedia(join(root, "media")),
    process.env.TWITCH_CHANNEL || "creator",
    log,
  );
  const port = Number(process.env.PORT ?? 4317);
  const twitch = new Twitch(
    app,
    root,
    process.env.TWITCH_CLIENT_ID?.trim() ?? "",
    process.env.TWITCH_CHANNEL?.trim() ?? "",
  );
  const bin = process.env.WHISPER_BIN;
  const model = process.env.WHISPER_MODEL;
  const fingerprint =
    bin && model
      ? await import("./adapters/transcription/fingerprint.ts")
          .then((m) => m.fingerprintFiles([bin, model]))
          .catch(() => undefined)
      : undefined;
  const provider =
    bin && model
      ? {
          ...(fingerprint ? { fingerprint } : {}),
          name: "whisper.cpp",
          model: basename(model),
          transcribe: (
            source: string,
            interval: { start: number; end: number },
            signal?: AbortSignal,
          ) => transcribe(source, root, bin, model, interval, signal),
        }
      : undefined;
  const intelligence = new Intelligence(
    store,
    app.media,
    provider,
    Date.now,
    log,
  );
  const matchModelDir = process.env.MATCH_MODEL_DIR;
  type Matcher = Awaited<
    ReturnType<
      (typeof import("./adapters/transcription/semantic.ts"))["createSemanticMatcher"]
    >
  >;
  let matcher: Promise<Matcher> | undefined;
  const assistance = new Assistance(
    app,
    provider,
    matchModelDir
      ? async (messages, segments) => {
          matcher ??= import("./adapters/transcription/semantic.ts")
            .then((m) => m.createSemanticMatcher(matchModelDir))
            .catch((error) => {
              matcher = undefined;
              throw error;
            });
          return (await matcher).suggest(messages, segments);
        }
      : undefined,
    (ids) => obsBuffer.snapshot(ids),
    process.env.ASSISTANCE_V2 !== "false",
  );
  const obs = new ObsCapture(
    process.env.OBS_RECORD_DIR ?? "",
    process.env.OBS_PASSWORD ?? "",
    async (bytes, key, continuity) => {
      const asset = await app.ingest(bytes, false, "obs:" + key);
      app.store.put("obs-segment", asset.id, {
        id: asset.id,
        savedAt: Date.now(),
        ...continuity,
      });
      assistance.queue(asset, obsBuffer.recent(asset.id));
    },
    "ws://127.0.0.1:4455",
    join(root, "obs-tmp"),
    Number(process.env.OBS_AUDIO_TRACK ?? 1),
    log,
  );
  const retention = new Retention(
    store,
    (id) => rm(app.media.source(id), { force: true }),
    Date.now,
    log,
  );
  const obsBuffer = new ObsBuffer(app, (ids) =>
    assembleSegments(ids, (id) => app.media.source(id), join(root, "obs-tmp")),
  );
  obsBuffer.recover();
  const captures = new Captures(
    store,
    new LocalCaptureFiles(join(root, "capture")),
    (bytes, fixture, operationKey) => app.ingest(bytes, fixture, operationKey),
  );
  const publishing = new Publishing(
    app,
    process.env.READER_URL && process.env.READER_WRITE_TOKEN
      ? new HttpPublisher(
          process.env.READER_URL,
          process.env.READER_WRITE_TOKEN,
          (id) => app.media.derived(id, "video"),
        )
      : undefined,
    process.env.READER_URL ?? "",
  );
  const server = await createServer(app, {
    publishing,
    obs,
    obsBuffer,
    assistance,
    captures,
    intelligence,
    port,
    production: process.env.NODE_ENV === "production",
    twitch,
    diagnostics: log,
    waveform,
    operations: new Operations(
      store,
      resourceSampler(
        root,
        Number(
          process.env.THATBIT_READER_PID ?? process.env.REPLYLINK_READER_PID,
        ) || undefined,
        process.env.THATBIT_READER_DATA_DIR ??
          process.env.REPLYLINK_READER_DATA_DIR,
      ),
    ),
    ...(process.env.OBS_PASSWORD
      ? { inspectObs: () => inspectObs(process.env.OBS_PASSWORD ?? "") }
      : {}),
  });
  await server.listen({ host: "127.0.0.1", port });
  app.recover();
  publishing.recover();
  intelligence.recover();
  captures.recover();
  obs.start();
  void twitch.start();
  let activeWork: Promise<void> | undefined;
  let publishWork: Promise<void> | undefined;
  let analysisWork: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!publishWork)
      publishWork = publishing
        .work()
        .catch((error) =>
          log.event("error", "publishing.worker_failed", {}, error),
        )
        .finally(() => {
          publishWork = undefined;
        });
    if (!analysisWork)
      analysisWork = intelligence
        .work()
        .then(() => assistance.work())
        .then(() => retention.work())
        .catch((error) =>
          log.event("error", "analysis.worker_failed", {}, error),
        )
        .finally(() => {
          analysisWork = undefined;
        });
    if (!activeWork)
      activeWork = app
        .work()
        .catch((error) => log.event("error", "render.worker_failed", {}, error))
        .finally(() => {
          activeWork = undefined;
        });
  }, 1000);
  log.event("info", "service.ready", { port });
  log.event("info", "transcription.configuration", {
    configured: Boolean(bin && model),
  });
  log.event("info", "publishing.configuration", {
    configured: Boolean(
      process.env.READER_URL && process.env.READER_WRITE_TOKEN,
    ),
  });
  let stopping = false;
  onShutdown(() => {
    if (stopping) return;
    stopping = true;
    log.event("info", "service.stopping");
    clearInterval(timer);
    twitch.stop();
    void server.close().then(async () => {
      await activeWork;
      await publishWork;
      await analysisWork;
      if (matcher) await (await matcher).close();
      await obs.stop();
      store.close();
      release();
      log.event("info", "service.stopped");
      process.exit(0);
    });
  });
}
await runLogged("creator", resolve(process.env.DATA_DIR ?? ".data"), main);
