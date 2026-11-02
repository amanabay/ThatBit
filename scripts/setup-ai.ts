import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { whisperExecutable, modelEnvironment } from "./lib/local-ai.ts";
const root = resolve(".data/models");
await mkdir(root, { recursive: true });
const source = join(root, "whisper.cpp");
if (!existsSync(source))
  await run(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      "v1.9.5",
      "https://github.com/ggml-org/whisper.cpp.git",
      source,
    ],
    120000,
  );
const revision = (await run("git", ["-C", source, "rev-parse", "HEAD"])).trim();
if (revision !== "d1be6fde11ac6e0407606b4e42fe72d34add8037")
  throw new Error("Unexpected Whisper source revision");
await run(
  "cmake",
  [
    "-S",
    source,
    "-B",
    join(source, "build"),
    "-DCMAKE_BUILD_TYPE=Release",
    "-DGGML_CUDA=OFF",
  ],
  120000,
);
await run(
  "cmake",
  [
    "--build",
    join(source, "build"),
    "--config",
    "Release",
    "--target",
    "whisper-cli",
    "-j",
    "2",
  ],
  600000,
);
const bin = await whisperExecutable(join(source, "build"));
const model = join(root, "ggml-base.en.bin");
const modelRevision = z
  .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
  .parse(
    await fetch("https://huggingface.co/api/models/ggerganov/whisper.cpp").then(
      (r) => r.json(),
    ),
  ).sha;
const pointer = await fetch(
  `https://huggingface.co/ggerganov/whisper.cpp/raw/${modelRevision}/ggml-base.en.bin`,
).then((r) => r.text());
const expected = /oid sha256:([a-f0-9]{64})/.exec(pointer)?.[1];
const size = Number(/size (\d+)/.exec(pointer)?.[1]);
if (!expected || !size || size > 200 * 1024 * 1024)
  throw new Error("Cannot verify model download metadata");
let bytes = existsSync(model) ? await readFile(model) : Buffer.alloc(0);
if (
  bytes.length !== size ||
  createHash("sha256").update(bytes).digest("hex") !== expected
) {
  console.log(
    "Downloading verified base.en model; an incomplete old file will not be reused.",
  );
  const response = await fetch(
    `https://huggingface.co/ggerganov/whisper.cpp/resolve/${modelRevision}/ggml-base.en.bin`,
    { signal: AbortSignal.timeout(600000) },
  );
  if (!response.ok) throw new Error("Whisper model download failed");
  bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length !== size ||
    createHash("sha256").update(bytes).digest("hex") !== expected
  )
    throw new Error("Whisper checksum mismatch");
  await writeFile(model + ".tmp", bytes, { flush: true, mode: 0o600 });
  await rename(model + ".tmp", model);
}
await writeFile(
  join(root, "manifest.json"),
  JSON.stringify(
    {
      sourceRevision: revision,
      model: "base.en",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    null,
    2,
  ),
);
console.log(
  `Local Whisper prepared. Set WHISPER_BIN=${bin} and WHISPER_MODEL=${model} in .env. No inference has been verified yet.`,
);
// Download semantic model assets from a resolved immutable model revision.

const metadata = z
  .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
  .parse(
    await fetch(
      "https://huggingface.co/api/models/Xenova/all-MiniLM-L6-v2",
    ).then((r) => r.json()),
  );
const semantic = join(root, "semantic");
await mkdir(join(semantic, "onnx"), { recursive: true });
const hashes: Record<string, string> = {};
for (const name of [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_quantized.onnx",
]) {
  const response = await fetch(
    `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${metadata.sha}/${name}`,
  );
  if (!response.ok) throw new Error("Model asset download failed");
  const content = Buffer.from(await response.arrayBuffer());
  await writeFile(join(semantic, name), content);
  hashes[name] = createHash("sha256").update(content).digest("hex");
}
await writeFile(
  join(semantic, "replylink-manifest.json"),
  JSON.stringify({ revision: metadata.sha, hashes }, null, 2),
);
console.log(
  `Set MATCH_MODEL_DIR=${semantic}. This model is used locally; no chat/audio is uploaded.`,
);

await writeFile(
  join(root, "runtime.env"),
  modelEnvironment({
    WHISPER_BIN: bin,
    WHISPER_MODEL: model,
    MATCH_MODEL_DIR: semantic,
  }),
  { mode: 0o600 },
);
