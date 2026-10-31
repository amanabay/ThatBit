import { rm, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { seed } from "./demo.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import {
  SourceTranscript,
  SuggestionSnapshot,
} from "../shared/contracts/assistance.ts";
const root = resolve(".data/e2e");
if (process.env.DATA_DIR !== ".data/e2e")
  throw new Error("E2E must use isolated DATA_DIR=.data/e2e");
await rm(root, { recursive: true, force: true });
await seed(root);
const store = new SQLiteStore(join(root, "replylink.sqlite"));
try {
  const media = new FFmpegMedia(join(root, "media"));
  const app = new Exchanges(store, media, "fixture");
  const a = app.state().assets[0];
  if (!a) throw new Error("Missing generated E2E media");
  const draftId = "e2e-original-suggestion";
  app.save(draftId, {
    expectedVersion: 0,
    messageId: "fixture-0",
    assetId: a.id,
    start: 0,
    end: 6,
    title: "Original evidence fixture",
    captions: [
      { start: 1, end: 4, text: "Authored ASR fixture, not actual speech." },
    ],
  });
  const transcript = SourceTranscript.parse({
    id: "e2e-source-asr",
    assetId: a.id,
    checksum: a.sha256,
    provider: "labelled fixture",
    model: "not-real-ASR",
    start: 0,
    end: a.duration,
    segments: [
      {
        id: "sentence-0",
        start: 1,
        end: 4,
        text: "Authored ASR fixture, not actual speech.",
      },
    ],
  });
  store.put("source-transcript", transcript.id, transcript);
  store.put(
    "suggestion-snapshot",
    draftId,
    SuggestionSnapshot.parse({
      id: draftId,
      draftId,
      transcriptId: transcript.id,
      messageId: "fixture-0",
      evidenceIds: ["sentence-0"],
      evidence: transcript.segments[0]?.text,
      start: 0,
      end: 6,
      policy: "context-v2-experimental",
      edge: true,
      method: "name-topic",
    }),
  );
  for (let i = 0; i < 2; i++) {
    const segment = await app.ingest(await readFile(media.source(a.id)), true);
    store.put("obs-segment", segment.id, {
      id: segment.id,
      savedAt: Date.now() + i,
      epoch: "generated-obs-fixture",
      sequence: i,
    });
  }
} finally {
  store.close();
}

// Offline provider contract fixture. This executable does not perform speech recognition.
await writeFile(
  resolve(root, "fixture-transcribe.mjs"),
  `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const wav=process.argv[process.argv.indexOf('-f')+1];
const duration=Number(JSON.parse(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',wav]).stdout).format.duration);
writeFileSync(wav+'.json',JSON.stringify({transcription:[{offsets:{from:0,to:1000},text:'Kai, the duck already has a game. [provider fixture]'},{offsets:{from:1000,to:Math.round(duration*1000)+1040},text:'Final sentence with padded timing. [provider fixture]'}]}));
`,
  { mode: 0o700 },
);
