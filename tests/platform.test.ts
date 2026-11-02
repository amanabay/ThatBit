import { test } from "node:test";
import assert from "node:assert/strict";
import path, { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { parseEnv } from "node:util";
import { z } from "zod";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { containsPath } from "../apps/server/src/adapters/storage/paths.ts";
import { run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";
import { creatorDatabase } from "../apps/server/src/adapters/storage/collection.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import {
  whisperExecutable,
  modelEnvironment,
  semanticManifest,
} from "../scripts/lib/local-ai.ts";

test("path containment rejects Windows drive/share escapes and sibling prefixes, while accepting real descendants", () => {
  for (const [root, target, expected] of [
    [
      "C:\\Users\\Aman\\ThatBit",
      "c:\\users\\aman\\ThatBit\\media\\clip.webm",
      true,
    ],
    ["C:\\ThatBit", "C:\\ThatBit", true],
    ["C:\\ThatBit", "C:\\ThatBit-old\\media", false],
    ["C:\\ThatBit", "C:\\ThatBit\\..\\secret", false],
    ["C:\\ThatBit", "D:\\media\\clip.webm", false],
    ["C:\\ThatBit", "C:\\ThatBit\\..cache\\clip", true],
    ["\\\\server\\share\\recordings", "\\\\server\\other\\clip.webm", false],
    [
      "\\\\server\\share\\recordings",
      "\\\\server\\share\\recordings\\clip.webm",
      true,
    ],
  ] as const)
    assert.equal(containsPath(root, target, path.win32), expected);
  assert.equal(containsPath("/data", "/database/file", path.posix), false);
  assert.equal(containsPath("/data", "/data/../secret", path.posix), false);
  assert.equal(containsPath("/data", "/data/media/file", path.posix), true);
});

test("explicit Node adapter scripts work without executable bits and preserve shell-sensitive paths and arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit script's [fixture], "));
  try {
    const script = join(root, "fixture adapter.mjs");
    await writeFile(
      script,
      "console.log(JSON.stringify(process.argv.slice(2)))",
      { mode: 0o600 },
    );
    const args = [
      "C:\\Users\\Aman\\Videos\\recording name.mkv",
      "literal $(no-command) `no-command` & %PATH%",
      "quote'and\"quote",
    ];
    assert.deepEqual(JSON.parse(await run(script, args)), args);
    assert.deepEqual(
      JSON.parse(await run("fixture adapter.mjs", args, 5000, undefined, root)),
      args,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AI setup finds Windows Release and single-config executables and writes round-trippable model paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "thatbit-ai-paths-"));
  try {
    await assert.rejects(whisperExecutable(root, "win32"), /usable CLI/);
    await mkdir(join(root, "bin", "Release"), { recursive: true });
    await writeFile(join(root, "bin", "whisper-cli.exe"), "fixture");
    assert.equal(
      await whisperExecutable(root, "win32"),
      join(root, "bin", "whisper-cli.exe"),
    );
    await writeFile(join(root, "bin", "Release", "whisper-cli.exe"), "fixture");
    assert.equal(
      await whisperExecutable(root, "win32"),
      join(root, "bin", "Release", "whisper-cli.exe"),
    );
    await writeFile(join(root, "bin", "whisper-cli"), "fixture");
    assert.equal(
      await whisperExecutable(root, "linux"),
      join(root, "bin", "whisper-cli"),
    );
    const windows = {
      WHISPER_BIN: "C:\\Users\\Aman Space\\#local\\whisper-cli.exe",
      WHISPER_MODEL: "D:\\Models\\base.en.bin",
    };
    assert.deepEqual(parseEnv(modelEnvironment(windows, "win32")), {
      WHISPER_BIN: "C:/Users/Aman Space/#local/whisper-cli.exe",
      WHISPER_MODEL: "D:/Models/base.en.bin",
    });
    assert.equal(
      parseEnv(
        modelEnvironment(
          { WHISPER_BIN: "/home/aman space/#local/whisper-cli" },
          "linux",
        ),
      ).WHISPER_BIN,
      "/home/aman space/#local/whisper-cli",
    );
    assert.throws(() => modelEnvironment({ WHISPER_BIN: "bad\nVALUE=oops" }));
    assert.equal(semanticManifest(root), join(root, "thatbit-manifest.json"));
    await writeFile(join(root, "replylink-manifest.json"), "{}");
    assert.equal(semanticManifest(root), join(root, "replylink-manifest.json"));
    await writeFile(join(root, "thatbit-manifest.json"), "{}");
    assert.equal(semanticManifest(root), join(root, "thatbit-manifest.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const closed = once(server, "close");
  server.close();
  await closed;
  return address.port;
}
test(
  "local supervisor opens a legacy collection, stops both roles through IPC and releases their stores for restart",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "thatbit-supervisor-"));
    const legacy = new SQLiteStore(join(root, "replylink.sqlite"));
    legacy.put("message", "legacy-fixture", {
      id: "legacy-fixture",
      sourceId: "legacy-fixture",
      userId: "fixture",
      author: "Fixture",
      text: "Preserved legacy original [fixture]",
      source: "manual",
      removed: false,
      receivedAt: new Date().toISOString(),
    });
    legacy.close();
    const port = await freePort(),
      readerPort = await freePort();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/dev-local.ts"],
      {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          ...process.env,
          DATA_DIR: root,
          READER_DATA_DIR: join(root, "reader"),
          PORT: String(port),
          LOCAL_READER_PORT: String(readerPort),
          VITE_HMR_PORT: String(await freePort()),
          TWITCH_CLIENT_ID: "",
          TWITCH_CHANNEL: "",
          OBS_RECORD_DIR: "",
          OBS_PASSWORD: "",
          WHISPER_BIN: "fixture-unconfigured",
          WHISPER_MODEL: "fixture-unconfigured",
          MATCH_MODEL_DIR: "fixture-unconfigured",
          LOG_TO_FILE: "false",
          LOG_LEVEL: "info",
          READER_HOST: "127.0.0.1",
        },
      },
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    try {
      const end = Date.now() + 15000;
      let ready = false;
      while (Date.now() < end && child.exitCode === null) {
        ready = await Promise.all([
          fetch(`http://127.0.0.1:${port}/api/creator/session`, {
            signal: AbortSignal.timeout(500),
          })
            .then((r) => r.ok)
            .catch(() => false),
          fetch(`http://127.0.0.1:${readerPort}/healthz`, {
            signal: AbortSignal.timeout(500),
          })
            .then((r) => r.ok)
            .catch(() => false),
        ]).then((r) => r.every(Boolean));
        if (ready) break;
        await delay(100);
      }
      assert.ok(ready, "Both isolated roles must start: " + output);
      const { token } = z
        .object({ token: z.string() })
        .parse(
          await fetch(`http://127.0.0.1:${port}/api/creator/session`).then(
            (r) => r.json(),
          ),
        );
      const state = z
        .object({
          messages: z.array(z.object({ id: z.string(), text: z.string() })),
        })
        .parse(
          await fetch(`http://127.0.0.1:${port}/api/creator/state`, {
            headers: { "x-creator-token": token },
          }).then((r) => r.json()),
        );
      assert.equal(
        state.messages.find((m) => m.id === "legacy-fixture")?.text,
        "Preserved legacy original [fixture]",
      );
      const exited = once(child, "close");
      child.send("thatbit:shutdown");
      const watchdog = setTimeout(() => child.kill("SIGKILL"), 10000);
      const [code] = await exited.finally(() => clearTimeout(watchdog));
      assert.equal(code, 0, output);
      assert.equal((output.match(/service\.stopped/g) ?? []).length, 2, output);
      for (const database of [
        creatorDatabase(root),
        join(root, "reader", "reader.sqlite"),
      ]) {
        const release = claimOwner(database);
        release();
      }
      await assert.rejects(
        fetch(`http://127.0.0.1:${readerPort}/healthz`, {
          signal: AbortSignal.timeout(1000),
        }),
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "close");
        child.kill("SIGKILL");
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
