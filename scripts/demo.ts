import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia, run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
export async function seed(root: string) {
  await mkdir(root, { recursive: true });
  const release = claimOwner(join(root, "replylink.sqlite"));
  const store = new SQLiteStore(join(root, "replylink.sqlite"));
  const app = new Exchanges(
    store,
    new FFmpegMedia(join(root, "media")),
    "aman",
  );
  if (app.state().assets.length) {
    store.close();
    release();
    return;
  }
  const file = join(root, "sample.webm");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=960x540:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "12",
    "-vf",
    "drawtext=fontfile=shared/assets/fonts/ReplyLinkPreview.ttf:text='REPLYLINK / GENERATED MEDIA FIXTURE':fontcolor=white:fontsize=32:x=40:y=40,drawtext=fontfile=shared/assets/fonts/ReplyLinkPreview.ttf:text='%{pts\\:hms}':fontcolor=white:fontsize=40:x=40:y=100",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-threads",
    "2",
    "-c:a",
    "libopus",
    "-y",
    file,
  ]);
  const asset = await app.ingest(await readFile(file), true);
  await unlink(file);
  for (const [i, author, text, title] of [
    [
      0,
      "mira",
      "How did you make the water look transparent?",
      "A little shader magic",
    ],
    [
      1,
      "kai",
      "That tiny duck deserves its own game.",
      "A very important duck",
    ],
    [
      2,
      "noah",
      "Could you show that last step again?",
      "One more time, slowly",
    ],
  ] as const) {
    const id = "fixture-" + i;
    app.message({
      id,
      sourceId: id,
      userId: id,
      author,
      text,
      source: "fixture",
      receivedAt: new Date().toISOString(),
      removed: false,
    });
    app.save(randomUUID(), {
      expectedVersion: 0,
      messageId: id,
      assetId: asset.id,
      start: i,
      end: i + 6,
      title,
      captions: [],
    });
  }
  store.close();
  release();
}
if (process.argv[1]?.endsWith("demo.ts")) {
  await seed(resolve(process.env.DATA_DIR ?? ".data"));
  console.log(
    "Generated sample media and labelled fixture drafts. Start npm run dev.",
  );
}
