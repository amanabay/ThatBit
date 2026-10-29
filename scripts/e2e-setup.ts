import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { seed } from "./demo.ts";
const root = resolve(".data/e2e");
if (process.env.DATA_DIR !== ".data/e2e")
  throw new Error("E2E must use isolated DATA_DIR=.data/e2e");
await rm(root, { recursive: true, force: true });
await seed(root);

// Offline provider contract fixture. This executable does not perform speech recognition.
await writeFile(
  resolve(root, "fixture-transcribe.mjs"),
  `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
const wav=process.argv[process.argv.indexOf('-f')+1];writeFileSync(wav+'.json',JSON.stringify({transcription:[{offsets:{from:0,to:1000},text:'Kai, the duck already has a game. [provider fixture]'}]}));
`,
  { mode: 0o700 },
);
