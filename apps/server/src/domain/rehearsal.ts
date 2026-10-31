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
  const combinedCpu: number[] = [];
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
    if (
      seconds > 0 &&
      a.resources.processSamples &&
      b.resources.processSamples
    ) {
      let delta = 0,
        compared = 0;
      for (const proc of b.resources.processSamples) {
        const prior = a.resources.processSamples.find(
          (p) => p.identity === proc.identity,
        );
        if (prior && proc.cpuMicros >= prior.cpuMicros) {
          delta += proc.cpuMicros - prior.cpuMicros;
          compared++;
        }
      }
      if (compared) combinedCpu.push(Math.round(delta / seconds / 100) / 100);
    }
  }
  const extended = samples.some(
    (s) => s.resources.processSamples !== undefined,
  );
  const combinedRss = samples.flatMap((s) =>
    s.resources.processSamples?.length
      ? [s.resources.processSamples.reduce((n, p) => n + p.rssBytes, 0)]
      : [],
  );
  const coverage = {
    activeProcesses:
      samples.length > 0 &&
      samples.every((s) => s.resources.processesComplete === true),
    localReader:
      samples.length > 0 &&
      samples.every((s) => s.resources.readerObserved === true),
    managedDisk:
      samples.length > 0 &&
      samples.every((s) => s.resources.diskUsage?.complete === true),
  };
  const thresholdExceeded = samples.some(
    (s) =>
      s.resources.rssBytes > 1024 ** 3 ||
      (s.resources.processSamples?.reduce((n, p) => n + p.rssBytes, 0) ?? 0) >
        1024 ** 3 ||
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
          : extended && Object.values(coverage).some((v) => !v)
            ? "incomplete-measurements"
            : "observed-within-sampled-limits",
    requestedSeconds,
    elapsedSeconds,
    samples: samples.length,
    gaps,
    peakCreatorRssBytes: peak(samples.map((s) => s.resources.rssBytes)),
    peakCreatorCpuCorePercent: peak(cpu),
    peakSampledApplicationRssBytes: peak(combinedRss),
    peakSampledApplicationCpuCorePercent: peak(combinedCpu),
    peakManagedAllocatedBytes: peak(
      samples.flatMap((s) =>
        s.resources.diskUsage ? [s.resources.diskUsage.allocatedBytes] : [],
      ),
    ),
    coverage,
    peakSourceBytes: peak(samples.map((s) => s.storage.sourceBytes)),
    peakQueues: {
      render: peak(samples.map((s) => s.queues.render)),
      transcription: peak(samples.map((s) => s.queues.transcription)),
      suggestions: peak(samples.map((s) => s.queues.suggestions)),
      reader: peak(samples.map((s) => s.queues.reader)),
    },
    scope: extended
      ? "Sampled creator, active descendants, configured local reader and allocated managed-data bytes. Reader absence and incomplete scans remain explicit. RSS sums include shared pages; CPU compares surviving process identities only. Between-sample peaks, exited subprocess CPU, OBS, dropped frames, audible synchronization, UI latency and unaided usability are not measured."
      : "Legacy creator-only samples; reader/subprocess resources and physical total disk were not measured. OBS, dropped frames, synchronization, latency and unaided usability remain separate.",
    humanAcceptance: "NOT TESTED by this tool",
  };
}
