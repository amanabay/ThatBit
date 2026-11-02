import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { containsPath } from "../storage/paths.ts";
import { z } from "zod";
import { run } from "../media/ffmpeg.ts";
import type { ObsHealth } from "../../../../../shared/contracts/studio.ts";
import {
  quietDiagnostics,
  type Diagnostics,
} from "../../application/diagnostics.ts";
const Packet = z.object({
  op: z.number(),
  d: z.record(z.string(), z.unknown()),
});
export class ObsCapture {
  status = "OBS not configured";
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private splitTimer: ReturnType<typeof setInterval> | undefined;
  private phase: ObsHealth["phase"] = "unconfigured";
  private checkedAt: number | null = null;
  private lastSegmentAt: number | null = null;
  private checking = false;
  private splitting = false;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private previous: string | undefined;
  private epoch = randomUUID();
  private sequence = 0;
  private discontinuous = false;
  private stopped = false;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private captureError = "";
  private requests = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private root: string,
    private password: string,
    private onSegment: (
      bytes: Buffer,
      key: string,
      continuity: { epoch: string | null; sequence: number },
    ) => Promise<void>,
    private url = "ws://127.0.0.1:4455",
    private scratchRoot = resolve(".data/obs-tmp"),
    private audioTrack = 1,
    private diagnostics: Diagnostics = quietDiagnostics,
  ) {
    if (!Number.isInteger(audioTrack) || audioTrack < 1 || audioTrack > 6)
      throw new Error(
        "OBS_AUDIO_TRACK must be a recorded audio track from 1 to 6.",
      );
  }
  health(): ObsHealth {
    return {
      phase: this.captureError ? "error" : this.phase,
      audioTrack: this.audioTrack,
      queueDepth: this.pending,
      checkedAt: this.checkedAt,
      lastSegmentAt: this.lastSegmentAt,
    };
  }
  private async checkRecording() {
    if (this.checking) return;
    this.checking = true;
    try {
      const state = z
        .object({ outputActive: z.boolean(), outputPaused: z.boolean() })
        .parse(await this.request("GetRecordStatus"));
      this.checkedAt = Date.now();
      this.phase = state.outputPaused
        ? "paused"
        : state.outputActive
          ? this.previous
            ? "recording"
            : "warming"
          : "stopped";
      this.status =
        this.captureError ||
        (this.phase === "paused"
          ? "OBS paused"
          : this.phase === "warming"
            ? "OBS warming up; first usable closed footage normally arrives around 60 seconds"
            : this.phase === "recording"
              ? `OBS recording · audio stream ${this.audioTrack}`
              : "OBS connected; recording stopped");
    } finally {
      this.checking = false;
    }
  }
  async request(
    requestType: string,
    requestData: Record<string, unknown> = {},
  ) {
    const requestId = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error("OBS request timed out"));
      }, 5000);
      this.requests.set(requestId, { resolve, reject, timer });
      this.socket?.send(
        JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }),
      );
    });
  }
  start() {
    if (!this.password || !this.root) {
      this.diagnostics.event("info", "obs.not_configured", {
        configured: false,
      });
      return;
    }
    const u = new URL(this.url);
    if (
      u.protocol !== "ws:" ||
      !["localhost", "127.0.0.1"].includes(u.hostname)
    )
      throw new Error("OBS must stay on loopback.");
    this.stopped = false;
    const s = new WebSocket(this.url);
    let connected = false;
    s.onopen = () => {
      connected = true;
    };
    this.previous = undefined;
    this.epoch = randomUUID();
    this.sequence = 0;
    this.discontinuous = false;
    this.socket = s;
    this.status = "Connecting OBS";
    this.phase = "connecting";
    this.checkedAt = null;
    this.diagnostics.event("info", "obs.connecting", {
      audioTrack: this.audioTrack,
    });
    s.onmessage = (e) => {
      void Promise.resolve()
        .then(() => this.packet(Packet.parse(JSON.parse(String(e.data)))))
        .catch((error) => {
          this.diagnostics.event("error", "obs.capture_failed", {}, error);
          this.status =
            "OBS configuration or capture failed. Verify split recording and selected audio mix.";
          this.phase = "error";
        });
    };
    s.onclose = (event) => {
      this.diagnostics.event(
        this.stopped ? "info" : "warn",
        this.stopped ? "obs.stopped" : "obs.disconnected",
        {
          status: event.code,
          retry: !this.stopped && event.code !== 4011 && event.code !== 4009,
        },
      );
      this.status = connected
        ? "OBS connection closed; retrying. Recording continuity is unknown."
        : `OBS unreachable on ${u.host}. Open OBS and enable its WebSocket server; retrying automatically.`;
      this.phase = "disconnected";
      if (event.code === 4011 || event.code === 4009) {
        this.stopped = true;
        this.status =
          "OBS access ended. Check WebSocket authentication and restart ReplyLink.";
      }
      if (this.timer) clearInterval(this.timer);
      if (this.splitTimer) clearInterval(this.splitTimer);
      for (const r of this.requests.values()) {
        clearTimeout(r.timer);
        r.reject(new Error("OBS disconnected"));
      }
      this.requests.clear();
      if (!this.stopped)
        this.reconnect = setTimeout(() => {
          if (!this.stopped) this.start();
        }, 5000);
    };
    s.onerror = () => {
      this.diagnostics.event("warn", "obs.unreachable");
      this.status =
        "OBS unreachable. Open OBS and enable its authenticated WebSocket server.";
      this.phase = "disconnected";
    };
  }
  private async packet(p: z.infer<typeof Packet>) {
    if (p.op === 0) {
      const hello = z
        .object({
          authentication: z
            .object({ salt: z.string(), challenge: z.string() })
            .optional(),
        })
        .parse(p.d);
      const hash = (s: string) =>
        createHash("sha256").update(s).digest("base64");
      const authentication = hello.authentication
        ? hash(
            hash(this.password + hello.authentication.salt) +
              hello.authentication.challenge,
          )
        : undefined;
      this.socket?.send(
        JSON.stringify({
          op: 1,
          d: {
            rpcVersion: 1,
            eventSubscriptions: 64,
            ...(authentication ? { authentication } : {}),
          },
        }),
      );
    } else if (p.op === 2) {
      const version = z
        .object({ availableRequests: z.array(z.string()) })
        .parse(await this.request("GetVersion"));
      if (!version.availableRequests.includes("SplitRecordFile"))
        throw new Error("OBS needs SplitRecordFile");
      this.status = "OBS connected; start recording in OBS";
      this.diagnostics.event("info", "obs.connected", {
        audioTrack: this.audioTrack,
      });
      await this.checkRecording();
      this.timer = setInterval(() => {
        void this.checkRecording().catch((error) => {
          this.phase = "error";
          this.status =
            "OBS recording status unavailable; check the connection.";
          this.diagnostics.event("warn", "obs.status_failed", {}, error);
        });
      }, 5000);
      this.splitTimer = setInterval(() => {
        if (this.splitting || !["warming", "recording"].includes(this.phase))
          return;
        this.splitting = true;
        void this.request("SplitRecordFile")
          .catch((error) => {
            this.diagnostics.event("error", "obs.split_failed", {}, error);
            this.phase = "error";
            this.status =
              "OBS split failed; import finalized recording manually.";
          })
          .finally(() => {
            this.splitting = false;
          });
      }, 30000);
    } else if (p.op === 7) {
      const response = z
        .object({
          requestId: z.string(),
          requestStatus: z.object({ result: z.boolean() }),
          responseData: z.unknown().optional(),
        })
        .parse(p.d);
      const pending = this.requests.get(response.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.requests.delete(response.requestId);
        if (response.requestStatus.result)
          pending.resolve(response.responseData ?? {});
        else pending.reject(new Error("OBS rejected request"));
      }
    } else if (p.op === 5) {
      const event = z
        .object({
          eventType: z.string(),
          eventData: z.record(z.string(), z.unknown()),
        })
        .parse(p.d);
      if (event.eventType === "RecordStateChanged") {
        const data = z
          .object({
            outputState: z.string(),
            outputPath: z.string().nullable().optional(),
          })
          .parse(event.eventData);
        if (data.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED") {
          this.diagnostics.event("info", "obs.recording_started");
          this.epoch = randomUUID();
          this.sequence = 0;
          this.discontinuous = false;
          this.previous = undefined;
          this.phase = "warming";
        }
        if (
          [
            "OBS_WEBSOCKET_OUTPUT_PAUSED",
            "OBS_WEBSOCKET_OUTPUT_RESUMED",
          ].includes(data.outputState)
        ) {
          this.diagnostics.event("warn", "obs.recording_discontinuity");
          this.phase =
            data.outputState === "OBS_WEBSOCKET_OUTPUT_PAUSED"
              ? "paused"
              : "warming";
          this.discontinuous = true;
          this.epoch = randomUUID();
          this.sequence = 0;
        }
        if (
          data.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED" &&
          data.outputPath
        )
          this.previous = data.outputPath;
        if (
          data.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED" &&
          data.outputPath
        ) {
          this.phase = "stopped";
          this.diagnostics.event("info", "obs.recording_stopped");
          this.ingest(data.outputPath);
          this.previous = undefined;
        }
      } else if (event.eventType === "RecordFileChanged") {
        const data = z
          .object({ newOutputPath: z.string() })
          .parse(event.eventData);
        if (this.previous) this.ingest(this.previous);
        this.previous = data.newOutputPath;
        this.discontinuous = false;
      }
    }
  }
  private ingest(path: string) {
    const continuity = {
      epoch: this.discontinuous ? null : this.epoch,
      sequence: this.sequence++,
    };
    if (this.pending >= 4) {
      this.diagnostics.event("warn", "obs.queue_full", {
        queueDepth: this.pending,
      });
      this.captureError = this.status =
        "OBS processing queue full; original recording retained. Import missed footage manually.";
      return;
    }
    this.pending++;
    this.diagnostics.event("info", "obs.segment_queued", {
      queueDepth: this.pending,
    });
    this.queue = this.queue
      .then(async () => {
        const started = Date.now();
        const base = await realpath(this.root),
          file = await realpath(path);
        if (!containsPath(base, file))
          throw new Error("OBS file outside configured recording directory");
        const info = await stat(file);
        if (info.size > 250 * 1024 * 1024)
          throw new Error("OBS segment too large");
        await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 });
        const output = join(this.scratchRoot, randomUUID() + ".webm");
        try {
          await run("ffmpeg", [
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            file,
            "-map",
            "0:v:0",
            "-map",
            `0:a:${this.audioTrack - 1}`,
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
            "-f",
            "webm",
            "-y",
            output,
          ]);
          await this.onSegment(
            await readFile(output),
            file + ":" + info.size,
            continuity,
          );
          this.lastSegmentAt = Date.now();
          this.diagnostics.event("info", "obs.segment_saved", {
            durationMs: Date.now() - started,
            bytes: info.size,
            audioTrack: this.audioTrack,
          });
        } finally {
          await rm(output, { force: true });
        }
      })
      .catch((error) => {
        this.diagnostics.event(
          "error",
          "obs.segment_failed",
          { audioTrack: this.audioTrack, queueDepth: this.pending },
          error,
        );
        this.captureError = this.status =
          "OBS segment could not be saved. Original recording retained; import it manually.";
      })
      .finally(() => {
        this.pending--;
      });
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.splitTimer) clearInterval(this.splitTimer);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.socket?.close();
    await this.queue;
  }
}
