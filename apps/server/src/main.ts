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
if (existsSync(".env")) process.loadEnvFile(".env");
const root = resolve(process.env.DATA_DIR ?? ".data");
await mkdir(root, { recursive: true, mode: 0o700 });
const release = claimOwner(join(root, "replylink.sqlite"));
const store = new SQLiteStore(join(root, "replylink.sqlite"));
const app = new Exchanges(
  store,
  new FFmpegMedia(join(root, "media")),
  process.env.TWITCH_CHANNEL ?? "creator",
);
const port = Number(process.env.PORT ?? 4317);
const twitch = new Twitch(
  app,
  root,
  process.env.TWITCH_CLIENT_ID ?? "",
  process.env.TWITCH_CHANNEL ?? "",
);
const bin = process.env.WHISPER_BIN;
const model = process.env.WHISPER_MODEL;
const intelligence = new Intelligence(
  store,
  app.media,
  bin && model
    ? {
        name: "whisper.cpp",
        model: basename(model),
        transcribe: (source, interval, signal) =>
          transcribe(source, root, bin, model, interval, signal),
      }
    : undefined,
);
const captures = new Captures(
  store,
  new LocalCaptureFiles(join(root, "capture")),
  (bytes, fixture, operationKey) => app.ingest(bytes, fixture, operationKey),
);
const server = await createServer(app, {
  captures,
  intelligence,
  port,
  production: process.env.NODE_ENV === "production",
  twitch,
});
await server.listen({ host: "127.0.0.1", port });
app.recover();
intelligence.recover();
captures.recover();
void twitch.start();
let activeWork: Promise<void> | undefined;
let analysisWork: Promise<void> | undefined;
const timer = setInterval(() => {
  if (!analysisWork)
    analysisWork = intelligence
      .work()
      .catch(() => console.error("ANALYSIS_WORKER_ERROR"))
      .finally(() => {
        analysisWork = undefined;
      });
  if (!activeWork)
    activeWork = app
      .work()
      .catch(() => {
        console.error(
          "RENDER_WORKER_ERROR: processing interrupted; restart to reconcile.",
        );
      })
      .finally(() => {
        activeWork = undefined;
      });
}, 1000);
console.log(`ReplyLink: http://localhost:${port}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    twitch.stop();
    void server.close().then(async () => {
      await activeWork;
      await analysisWork;
      store.close();
      release();
      process.exit(0);
    });
  });
