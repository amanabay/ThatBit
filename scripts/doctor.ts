import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";
import { FFmpegMedia, run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { shareImage } from "../apps/server/src/adapters/media/share-image.ts";
import { LocalCaptureFiles } from "../apps/server/src/adapters/capture/files.ts";
import { Revision, PublicReply } from "../shared/contracts/models.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
if (existsSync(".data/models/runtime.env")) {
  const local = parseEnv(readFileSync(".data/models/runtime.env", "utf8"));
  for (const key of ["WHISPER_BIN", "WHISPER_MODEL", "MATCH_MODEL_DIR"])
    if (!process.env[key] && local[key]) process.env[key] = local[key];
}
let failures = 0;
async function check(label: string, hint: string, work: () => Promise<void>) {
  try {
    await work();
    console.log("PASS: " + label);
  } catch {
    failures++;
    console.error("FAIL: " + label + ". " + hint);
  }
}
console.log(
  `Local setup check · ${process.platform}/${process.arch} · Node ${process.versions.node}`,
);
console.log(
  "Uses temporary generated media only. No collection, OBS controls, Twitch requests or downloads.",
);
await check("Node version", "Install Node 24.14 or newer.", async () => {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 24 || (major === 24 && minor < 14)) throw Error("Node version");
});
await check(
  "FFmpeg and ffprobe",
  "Install both tools and add their bin directory to PATH; open a new terminal.",
  async () => {
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
  },
);
const root = await mkdtemp(join(tmpdir(), "replylink doctor's [media], "));
try {
  await check(
    "SQLite storage and ownership lock",
    "Use a writable local directory on NTFS; avoid cloud-synced/network folders.",
    async () => {
      const path = join(root, "fixture.sqlite");
      const release = claimOwner(path);
      try {
        const store = new SQLiteStore(path);
        try {
          store.put("fixture", "test", true);
          if (!store.get("fixture", "test", z.boolean()))
            throw Error("Roundtrip");
        } finally {
          store.close();
        }
      } finally {
        release();
      }
    },
  );
  await check(
    "Import, capture, replay, portrait captions and reader preview",
    "Use a full FFmpeg build with libvpx-vp9, libopus, drawtext and subtitles/libass. Run from the repository root with bundled fonts present.",
    async () => {
      const source = join(root, "generated.webm");
      await run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=10",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440",
        "-t",
        "1",
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "realtime",
        "-threads",
        "2",
        "-c:a",
        "libopus",
        "-y",
        source,
      ]);
      const bytes = await readFile(source);
      const media = new FFmpegMedia(join(root, "media"));
      const asset = await media.ingest(bytes, true);
      await new LocalCaptureFiles(join(root, "capture")).writeChunk(
        "fixture-capture",
        0,
        bytes,
      );
      const revision = Revision.parse({
        id: "fixture-revision",
        draftId: "fixture-draft",
        version: 1,
        messageId: "fixture-message",
        assetId: asset.id,
        title: "Generated setup fixture",
        start: 0,
        end: 1,
        captions: [
          { start: 0, end: 1, text: "GENERATED SETUP FIXTURE — NOT SPEECH" },
        ],
        createdAt: new Date().toISOString(),
      });
      await media.render(revision, "fixture-publication");
      await media.portrait(
        revision,
        "fixture-publication",
        "Setup fixture",
        "Generated setup check, not audience participation.",
      );
      const reply = PublicReply.parse({
        id: "fixture-publication",
        title: revision.title,
        author: "Setup fixture",
        message: "Generated setup check, not audience participation.",
        creator: "Setup fixture",
        duration: 1,
        captions: revision.captions,
        fixture: true,
        date: revision.createdAt,
      });
      await shareImage(
        media.derived(reply.id, "video"),
        reply,
        join(root, "preview.png"),
      );
    },
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
const bin = process.env.WHISPER_BIN,
  model = process.env.WHISPER_MODEL;
if (bin || model)
  await check(
    "Configured local Whisper files",
    "Rebuild with npm run ai:setup on this OS and replace old Linux paths in .env. This check does not establish speech accuracy.",
    async () => {
      if (
        !bin ||
        !model ||
        !(await stat(bin)).isFile() ||
        !(await stat(model)).isFile()
      )
        throw Error("Missing Whisper files");
    },
  );
else
  console.log(
    "NOT CONFIGURED: local transcription. Run npm run ai:setup when ready.",
  );
const matching = process.env.MATCH_MODEL_DIR;
if (matching)
  await check(
    "Configured matching model files",
    "Re-run npm run ai:setup or correct MATCH_MODEL_DIR. Inference quality is not tested here.",
    async () => {
      for (const file of [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "onnx/model_quantized.onnx",
      ])
        if (!(await stat(join(matching, file))).isFile())
          throw Error("Missing model file");
    },
  );
else
  console.log(
    "NOT CONFIGURED: automatic matching. Manual review remains available.",
  );
console.log(
  "Real microphone/window capture, Twitch intake and playback sync still require your own test. Use npm run obs:doctor for read-only OBS diagnostics.",
);
if (process.platform === "win32")
  console.log(
    "Windows: process-family and physical allocated-disk measurements are incomplete; use Task Manager and OBS Stats alongside rehearsals. File flush/atomic rename is used; POSIX directory fsync is unavailable.",
  );
process.exitCode = failures ? 1 : 0;
