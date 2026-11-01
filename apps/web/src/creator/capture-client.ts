import { Asset } from "../../../../shared/contracts/models.ts";
import { CaptureEpoch } from "../../../../shared/contracts/capture.ts";
import { api, token, refreshCreatorSession } from "../client.ts";
export class BrowserCapture {
  private recorder: MediaRecorder;
  private queue: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private sequence = 0;
  private started: number;
  private failed = false;
  private timer: ReturnType<typeof setTimeout>;
  private done: Promise<void>;
  private saves: Promise<void> = Promise.resolve();
  private notifyStopped: () => void = () => {};
  constructor(
    readonly epoch: CaptureEpoch,
    private stream: MediaStream,
    private notify: (text: string) => void,
  ) {
    this.started = epoch.clientMonotonicMs;
    this.recorder = new MediaRecorder(stream, {
      mimeType: epoch.mime,
      videoBitsPerSecond: 1_200_000,
      audioBitsPerSecond: 96_000,
    });
    this.done = new Promise((resolve) => {
      this.notifyStopped = resolve;
    });
    this.recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      const sequence = this.sequence++;
      const elapsed = performance.now() - this.started;
      const timecode = e.timecode;
      this.queuedBytes += e.data.size;
      if (
        this.queuedBytes > 16 * 1024 * 1024 ||
        e.data.size > 8 * 1024 * 1024
      ) {
        this.failed = true;
        this.notify(
          "Recording stopped: upload backlog exceeded the safe limit. Recover acknowledged footage.",
        );
        if (this.recorder.state !== "inactive") this.recorder.stop();
      }
      this.queue = this.queue.then(async () => {
        try {
          if (this.failed) return;
          await this.upload(sequence, e.data, elapsed, timecode);
          this.notify(`Recording · ${sequence + 1} chunks saved to disk`);
        } catch {
          this.failed = true;
          this.notify(
            "Recording upload failed. Acknowledged footage is recoverable; the final tail may be missing.",
          );
          if (this.recorder.state !== "inactive") this.recorder.stop();
        } finally {
          this.queuedBytes -= e.data.size;
        }
      });
    };
    this.recorder.onstop = () => {
      clearTimeout(this.timer);
      stream.getTracks().forEach((t) => t.stop());
      this.notifyStopped();
    };
    this.recorder.onerror = () => {
      this.failed = true;
      this.notify(
        "Recording device or encoder failed. Recover acknowledged footage.",
      );
      if (this.recorder.state !== "inactive") this.recorder.stop();
    };
    for (const t of stream.getTracks())
      t.addEventListener("ended", () => {
        if (this.recorder.state !== "inactive") {
          this.notify(
            "Selected source ended. Finalizing the available recording.",
          );
          this.recorder.stop();
        }
      });
    this.timer = setTimeout(() => {
      if (this.recorder.state !== "inactive") {
        this.notify(
          "One-hour recording limit reached. Finalizing this recording.",
        );
        this.recorder.stop();
      }
    }, 3_600_000);
    this.recorder.start(1500);
  }
  private async upload(
    sequence: number,
    blob: Blob,
    elapsed: number,
    timecode: number,
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(
          `/api/creator/captures/${this.epoch.id}/chunks/${sequence}?elapsed=${elapsed}&timecode=${timecode}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              "x-creator-token": token,
            },
            body: blob,
            signal: AbortSignal.timeout(10000),
          },
        );
        if (response.ok) {
          CaptureEpoch.parse(await response.json());
          return;
        }
        if (response.status === 401) await refreshCreatorSession();
        if (response.status === 400 || response.status === 413) break;
      } catch {
        /* Retry the same bytes/sequence after network failure or uncertain acknowledgment. */
      }
      await new Promise((r) => setTimeout(r, (attempt + 1) * 400));
    }
    throw new Error("Recording chunk not acknowledged.");
  }
  async untilStopped() {
    await this.done;
  }
  save(finish: boolean) {
    const result = this.saves.then(() => this.snapshot(finish));
    this.saves = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private async snapshot(finish: boolean) {
    if (finish) {
      if (this.recorder.state !== "inactive") this.recorder.stop();
      await this.done;
    } else {
      if (this.recorder.state === "inactive")
        throw new Error("Recording stopped. Finish or recover it first.");
      await new Promise<void>((resolve) => {
        this.recorder.addEventListener("dataavailable", () => resolve(), {
          once: true,
        });
        this.recorder.requestData();
      });
    }
    await this.queue;
    if (this.failed) {
      await api("creator/captures/" + this.epoch.id + "/interrupt", "POST");
      throw new Error(
        "Recording interrupted. Recover acknowledged footage from Sources & setup.",
      );
    }
    return Asset.parse(
      await api(
        "creator/captures/" + this.epoch.id + "/snapshot",
        "POST",
        {
          finish,
          ...(finish ? { expectedSequence: this.sequence } : {}),
        },
        AbortSignal.timeout(120000),
      ),
    );
  }
  stop() {
    if (this.recorder.state !== "inactive") this.recorder.stop();
  }
}
export async function beginCapture(notify: (text: string) => void) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  try {
    if (!stream.getAudioTracks().length)
      throw new Error(
        "No shared audio was provided. Browser window sharing may be video-only on Linux. Use an OBS recording with your intended audio mix, or choose a browser tab with Share audio. No microphone was added.",
      );
    const mime = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime)
      throw new Error(
        "This browser cannot record WebM. Import a recording instead.",
      );
    const epoch = CaptureEpoch.parse(
      await api("creator/captures", "POST", {
        mime,
        clientWallAt: new Date().toISOString(),
        clientMonotonicMs: performance.now(),
        fixture: false,
      }),
    );
    return new BrowserCapture(epoch, stream, notify);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
}
