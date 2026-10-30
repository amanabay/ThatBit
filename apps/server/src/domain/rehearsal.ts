import type { OperationsSnapshot } from "../../../../shared/contracts/operations.ts";
export function summarizeRehearsal(
  samples: OperationsSnapshot[],
  gaps: number,
  requestedSeconds: number,
  elapsedSeconds: number,
  interrupted: boolean,
) {
  const peak = (values: number[]) =>
    values.length ? Math.max(...values) : null;
  const cpu: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1],
      b = samples[i];
    if (!a || !b) continue;
    if (a.resources.instanceId !== b.resources.instanceId) continue;
    const seconds = b.resources.uptimeSeconds - a.resources.uptimeSeconds;
    const micros =
      b.resources.cpuUserMicros +
      b.resources.cpuSystemMicros -
      a.resources.cpuUserMicros -
      a.resources.cpuSystemMicros;
    if (seconds > 0 && micros >= 0)
      cpu.push(Math.round((micros / seconds / 10000) * 100) / 100);
  }
  const thresholdExceeded = samples.some(
    (s) =>
      s.resources.rssBytes > 1024 ** 3 ||
      s.storage.sourceBytes > 5 * 1024 ** 3 ||
      s.queues.render > 10 ||
      s.queues.transcription > 10 ||
      s.queues.suggestions > 10,
  );
  return {
    purpose:
      requestedSeconds < 1800
        ? "short diagnostic; not a rehearsal acceptance run"
        : "resource observation; human/device acceptance recorded separately",
    thresholdExceeded,
    outcome: interrupted
      ? "interrupted"
      : !samples.length || gaps || elapsedSeconds < requestedSeconds - 1
        ? "incomplete-gaps"
        : thresholdExceeded
          ? "threshold-exceeded"
          : "observed-within-sampled-limits",
    requestedSeconds,
    elapsedSeconds,
    samples: samples.length,
    gaps,
    peakCreatorRssBytes: peak(samples.map((s) => s.resources.rssBytes)),
    peakCreatorCpuCorePercent: peak(cpu),
    peakSourceBytes: peak(samples.map((s) => s.storage.sourceBytes)),
    peakQueues: {
      render: peak(samples.map((s) => s.queues.render)),
      transcription: peak(samples.map((s) => s.queues.transcription)),
      suggestions: peak(samples.map((s) => s.queues.suggestions)),
      reader: peak(samples.map((s) => s.queues.reader)),
    },
    scope:
      "Sampled creator process RSS/CPU and metadata source quota only. Reader/OBS/subprocess resources, physical total disk usage, dropped frames, audible synchronization, UI latency and unaided usability are not measured.",
    humanAcceptance: "NOT TESTED by this tool",
  };
}
