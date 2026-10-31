import { spawn } from "node:child_process";
// Stream decoded PCM into bounded peaks; never accumulate the audio or expose it.
export function waveform(
  source: string,
  duration: number,
): Promise<{
  duration: number;
  peaks: number[];
  status: "silent" | "signal-present";
}> {
  return new Promise((resolve, reject) => {
    const peaks = Array<number>(
      Math.min(2048, Math.max(1, Math.ceil(duration * 20))),
    ).fill(0);
    const expected = Math.ceil(duration * 8000),
      width = Math.max(1, Math.ceil(expected / peaks.length));
    let samples = 0,
      pending: Buffer = Buffer.alloc(0),
      settled = false;
    const child = spawn(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "2",
        "-i",
        source,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else
        resolve({
          duration,
          peaks,
          status: peaks.some((p) => p > 0) ? "signal-present" : "silent",
        });
    };
    const timer = setTimeout(
      () => finish(new Error("Waveform processing timed out")),
      120000,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const end = bytes.length - (bytes.length % 2);
      for (let i = 0; i < end; i += 2) {
        const bin = Math.min(peaks.length - 1, Math.floor(samples++ / width));
        peaks[bin] = Math.max(
          peaks[bin] ?? 0,
          Math.abs(bytes.readInt16LE(i)) / 32768,
        );
      }
      pending = bytes.subarray(end);
      if (samples > expected + 16000)
        finish(new Error("Waveform exceeded source duration"));
    });
    child.on("error", () =>
      finish(new Error("Waveform executable unavailable")),
    );
    child.on("close", (code) =>
      finish(
        code === 0 && samples > 0
          ? undefined
          : new Error("Waveform unavailable"),
      ),
    );
  });
}
