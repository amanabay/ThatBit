import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ObsCapture } from "../apps/server/src/adapters/obs/client.ts";
import { FFmpegMedia, run } from "../apps/server/src/adapters/media/ffmpeg.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { ObsBuffer } from "../apps/server/src/application/obs-buffer.ts";
import { Retention } from "../apps/server/src/application/retention.ts";
import { assembleSegments } from "../apps/server/src/adapters/obs/assemble.ts";
import { setTimeout as delay } from "node:timers/promises";
import { inspectObs } from "../apps/server/src/adapters/obs/inspect.ts";

test("OBS doctor reads anonymous status/source kinds without recording controls, screenshots, names or paths", async () => {
  const ws = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => ws.once("listening", resolve));
  const address = ws.address();
  assert.ok(address && typeof address !== "string");
  const seen: string[] = [];
  let rejectAudio = false;
  ws.on("connection", (socket) => {
    socket.send(JSON.stringify({ op: 0, d: {} }));
    socket.on("message", (bytes) => {
      const p = JSON.parse(bytes.toString());
      if (p.op === 1) {
        assert.equal(p.d.eventSubscriptions, 0);
        socket.send(JSON.stringify({ op: 2, d: {} }));
        return;
      }
      const kind = p.d.requestType;
      seen.push(kind);
      const responses: Record<string, unknown> = {
        GetVersion: {
          obsVersion: "32.1.1",
          availableRequests: ["SplitRecordFile"],
        },
        GetRecordStatus: {
          outputActive: false,
          outputPaused: false,
          outputDuration: 0,
        },
        GetInputKindList: { inputKinds: ["pipewire-window-capture-source"] },
        GetInputList: {
          inputs: [
            {
              inputKind: "pipewire-screen-capture-source",
              inputName: "PRIVATE_WINDOW_TITLE",
            },
            { inputKind: "pulse_input_capture", inputName: "PRIVATE_MIC" },
            { inputKind: "pulse_output_capture", inputName: "PRIVATE_DESKTOP" },
          ],
        },
        GetCurrentProgramScene: { sceneName: "PRIVATE_SCENE" },
        GetSceneItemList: {
          sceneItems: [
            {
              inputKind: "pipewire-screen-capture-source",
              sceneItemEnabled: true,
              sourceName: "PRIVATE_WINDOW_TITLE",
            },
          ],
        },
        GetInputMute: {
          inputMuted: p.d.requestData.inputName === "PRIVATE_MIC",
        },
        GetInputVolume: { inputVolumeMul: 1 },
        GetInputAudioTracks: {
          inputAudioTracks: {
            "1": true,
            "2": false,
            "3": true,
            "4": false,
            "5": false,
            "6": false,
          },
        },
      };
      assert.ok(
        Object.hasOwn(responses, kind),
        "Doctor must issue read-only requests only",
      );
      socket.send(
        JSON.stringify({
          op: 7,
          d: {
            requestId: p.d.requestId,
            requestStatus:
              kind === "GetInputMute" &&
              p.d.requestData.inputName === "PRIVATE_WINDOW_TITLE"
                ? { result: false, code: 604 }
                : rejectAudio && kind === "GetInputMute"
                  ? { result: false, code: 600 }
                  : { result: true, code: 100 },
            responseData: responses[kind],
          },
        }),
      );
    });
  });
  try {
    const report = await inspectObs(
      "fixture-password",
      `ws://127.0.0.1:${address.port}`,
    );
    assert.equal(report.recording, false);
    assert.equal(report.windowCaptureAvailable, true);
    assert.deepEqual(report.visibleSourceKinds, [
      "pipewire-screen-capture-source",
    ]);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_"));
    assert.ok(!JSON.stringify(report).includes("fixture-password"));
    assert.deepEqual(report.audioInputs, [
      {
        kind: "pulse_input_capture",
        muted: true,
        volumeMul: 1,
        enabledTracks: [1, 3],
      },
      {
        kind: "pulse_output_capture",
        muted: false,
        volumeMul: 1,
        enabledTracks: [1, 3],
      },
    ]);
    assert.equal(seen.length, 13);
    rejectAudio = true;
    await assert.rejects(
      () => inspectObs("fixture-password", `ws://127.0.0.1:${address.port}`),
      /rejected a read-only/,
    );
    await assert.rejects(
      () => inspectObs("fixture", "ws://outside.example"),
      /loopback/,
    );
  } finally {
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
  }
});

test("unreachable OBS reports connection setup rather than inventing a recording gap", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const obs = new ObsCapture(
    "/unused-fixture-recordings",
    "fixture-password",
    async () => {},
    `ws://127.0.0.1:${address.port}`,
  );
  try {
    obs.start();
    const deadline = Date.now() + 3000;
    while (
      !obs.status.includes("retrying automatically") &&
      Date.now() < deadline
    )
      await delay(10);
    assert.match(obs.status, /OBS unreachable/);
    assert.match(obs.status, /Open OBS/);
    assert.doesNotMatch(obs.status, /recording gap/);
  } finally {
    await obs.stop();
  }
});
test("OBS handshake and closed-file events ingest actual media while preserving the original (protocol fixture)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replylink-obs-"));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((r) => server.on("listening", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const file = join(dir, "record.webm");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=green:size=160x90:rate=10",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880",
    "-t",
    "2",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-map",
    "2:a:0",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-threads",
    "2",
    "-c:a",
    "libopus",
    "-y",
    file,
  ]);
  const original = await readFile(file);
  let received: (value: Buffer) => void = () => {};
  const ready = new Promise<Buffer>((r) => {
    received = r;
  });
  const hash = (s: string) => createHash("sha256").update(s).digest("base64");
  let authenticated = false;
  server.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        op: 0,
        d: { authentication: { salt: "salt", challenge: "challenge" } },
      }),
    );
    socket.on("message", (bytes) => {
      const p = z
        .object({ op: z.number(), d: z.record(z.string(), z.unknown()) })
        .parse(JSON.parse(bytes.toString()));
      if (p.op === 1) {
        assert.equal(
          p.d.authentication,
          hash(hash("passwordsalt") + "challenge"),
        );
        authenticated = true;
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      } else if (p.op === 6) {
        socket.send(
          JSON.stringify({
            op: 7,
            d: {
              requestId: p.d.requestId,
              requestStatus: { result: true },
              responseData: { availableRequests: ["SplitRecordFile"] },
            },
          }),
        );
        setTimeout(() => {
          socket.send(
            JSON.stringify({
              op: 5,
              d: {
                eventType: "RecordStateChanged",
                eventData: {
                  outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
                  outputPath: null,
                },
              },
            }),
          );
          socket.send(
            JSON.stringify({
              op: 5,
              d: {
                eventType: "RecordFileChanged",
                eventData: { newOutputPath: file },
              },
            }),
          );
          socket.send(
            JSON.stringify({
              op: 5,
              d: {
                eventType: "RecordFileChanged",
                eventData: { newOutputPath: join(dir, "next.webm") },
              },
            }),
          );
        }, 20);
      }
    });
  });
  const obs = new ObsCapture(
    dir,
    "password",
    async (bytes) => {
      received(bytes);
    },
    `ws://127.0.0.1:${address.port}`,
    join(dir, "scratch"),
    2,
  );
  try {
    obs.start();
    const timeout = setTimeout(() => {
      received(Buffer.alloc(0));
    }, 15000);
    const bytes = await ready;
    clearTimeout(timeout);
    assert.ok(
      bytes.length > 0,
      "OBS fixture must deliver a normalized segment",
    );
    assert.ok(authenticated);
    assert.deepEqual(await readFile(file), original);
    const output = join(dir, "output.webm");
    await writeFile(output, bytes);
    const p = await new FFmpegMedia(dir).inspect(output);
    assert.ok(Math.abs(p.format.duration - 2) < 0.2);
    assert.ok(p.streams.some((s) => s.codec_type === "audio"));
    const wav = join(dir, "selected-track.wav");
    await run("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-vn",
      "-ar",
      "8000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-y",
      wav,
    ]);
    const pcm = await readFile(wav);
    let offset = 12;
    while (
      pcm.toString("ascii", offset, offset + 4) !== "data" &&
      offset + 8 < pcm.length
    )
      offset +=
        8 + pcm.readUInt32LE(offset + 4) + (pcm.readUInt32LE(offset + 4) % 2);
    const data = pcm.subarray(
      offset + 8,
      offset + 8 + pcm.readUInt32LE(offset + 4),
    );
    let crossings = 0;
    for (let i = 2; i < data.length; i += 2)
      if (data.readInt16LE(i - 2) <= 0 && data.readInt16LE(i) > 0) crossings++;
    assert.ok(
      Math.abs(crossings / (data.length / 2 / 8000) - 880) < 20,
      "selected second recorded audio track must contain its 880 Hz tone",
    );
  } finally {
    await obs.stop();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("contiguous OBS exchange assembly preserves both real segments, pins work against retention, and rejects gaps", async () => {
  const root = await mkdtemp(join(tmpdir(), "replylink-obs-buffer-"));
  const store = new SQLiteStore(join(root, "db"));
  const media = new FFmpegMedia(join(root, "media"));
  const app = new Exchanges(store, media, "creator");
  try {
    const assets = [];
    for (const [i, color] of ["red", "blue"].entries()) {
      const file = join(root, `${i}.webm`);
      await run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=${color}:size=160x90:rate=10`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${440 + i * 220}`,
        "-t",
        "2",
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "realtime",
        "-threads",
        "2",
        "-c:a",
        "libopus",
        "-y",
        file,
      ]);
      const a = await app.ingest(await readFile(file), true);
      assets.push(a);
      store.put("obs-segment", a.id, {
        id: a.id,
        savedAt: i,
        epoch: "epoch-one",
        sequence: i,
      });
    }
    const ids = assets.map((a) => a.id);
    const retention = new Retention(
      store,
      (id) => rm(media.source(id), { force: true }),
      () => 99999999,
    );
    const buffer = new ObsBuffer(app, async (selected) => {
      await retention.work();
      assert.ok(
        ids.every((id) => media.exists(id)),
        "assembly must protect its source files",
      );
      return assembleSegments(
        selected,
        (id) => media.source(id),
        join(root, "scratch"),
      );
    });
    const saved = await buffer.snapshot(ids);
    assert.ok(Math.abs(saved.duration - 4) < 0.25);
    assert.ok(saved.audio);
    const frame = async (at: number) =>
      run("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(at),
        "-i",
        media.source(saved.id),
        "-frames:v",
        "1",
        "-f",
        "framemd5",
        "-",
      ]);
    assert.notEqual(
      (await frame(0.5)).split("\n").at(-2)?.split(",").at(-1),
      (await frame(2.5)).split("\n").at(-2)?.split(",").at(-1),
      "both colored source segments must appear in the output",
    );
    assert.equal(
      (await buffer.snapshot(ids)).id,
      saved.id,
      "retry reuses its durable snapshot",
    );
    await assert.rejects(buffer.snapshot([...ids].reverse()), /recording gap/);
    if (ids[1])
      store.put("obs-segment", ids[1], {
        id: ids[1],
        savedAt: 1,
        epoch: "epoch-two",
        sequence: 0,
      });
    await assert.rejects(buffer.snapshot(ids), /recording gap/);
    await retention.work();
    assert.ok(
      ids.every((id) => !media.exists(id)),
      "unreferenced old originals can expire",
    );
    assert.ok(
      media.exists(saved.id),
      "saved exchange remains independent from rolling retention",
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
