import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { OperationsSnapshot } from "../shared/contracts/operations.ts";
import { summarizeRehearsal } from "../apps/server/src/domain/rehearsal.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      minutes: { type: "string" },
      seconds: { type: "string" },
      interval: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      "npm run rehearse -- --minutes 30 [--interval 5] [--out .data/rehearsals/session.jsonl]\nUse --seconds for short diagnostics (1–3600). Run dev:local for reader/descendant process and managed-disk observations. Reports expose missing measurements and sampling limitations. Reads only loopback metrics; human/device acceptance is separate.",
    );
    return;
  }
  if (existsSync(".env")) process.loadEnvFile(".env");
  if (values.minutes && values.seconds)
    throw Error("Choose minutes or seconds");
  const seconds = Number(values.seconds ?? Number(values.minutes ?? 30) * 60),
    interval = Number(values.interval ?? 5),
    port = Number(process.env.PORT ?? 4317);
  if (
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > 3600 ||
    !Number.isFinite(interval) ||
    interval < 1 ||
    interval > 60 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw Error("Invalid duration, interval or port");
  const path = resolve(
    values.out ??
      `.data/rehearsals/${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
  );
  const rel = relative(resolve(".data"), path);
  if (!rel || rel.startsWith("..") || rel.startsWith("/"))
    throw Error("Report must be inside private .data");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, "wx", 0o600);
  let summaryFile;
  try {
    summaryFile = await open(path + ".summary.json", "wx", 0o600);
  } catch (e) {
    await file.close();
    throw e;
  }
  const controller = new AbortController();
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const start = performance.now(),
    samples: OperationsSnapshot[] = [];
  let gaps = 0;
  console.log(
    `Observing local creator for ${seconds} seconds. No recording or publication controls are invoked.`,
  );
  try {
    while (!interrupted && performance.now() - start <= seconds * 1000) {
      try {
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(5000),
        ]);
        const session = await fetch(
          `http://127.0.0.1:${port}/api/creator/session`,
          { signal },
        );
        if (!session.ok) throw Error("Unavailable");
        const { token } = z
          .object({ token: z.string() })
          .parse(await session.json());
        const response = await fetch(
          `http://127.0.0.1:${port}/api/creator/operations`,
          { signal, headers: { "x-creator-token": token } },
        );
        if (!response.ok) throw Error("Unavailable");
        const snapshot = OperationsSnapshot.parse(await response.json());
        samples.push(snapshot);
        await file.write(JSON.stringify(snapshot) + "\n");
        console.log(
          `Sample ${samples.length}: creator RSS ${Math.round(snapshot.resources.rssBytes / 1024 ** 2)} MiB; render ${snapshot.queues.render}, transcription ${snapshot.queues.transcription}, suggestions ${snapshot.queues.suggestions} queued.`,
        );
      } catch {
        if (interrupted) break;
        gaps++;
        await file.write(
          JSON.stringify({
            sampledAt: new Date().toISOString(),
            error: "CREATOR_UNAVAILABLE",
          }) + "\n",
        );
        console.log(
          "Observation gap: creator unavailable; continuing without inventing values.",
        );
      }
      const left = seconds * 1000 - (performance.now() - start);
      if (left <= 0) break;
      await sleep(Math.min(left, interval * 1000), undefined, {
        signal: controller.signal,
      }).catch(() => {});
    }
    const summary = summarizeRehearsal(
      samples,
      gaps,
      seconds,
      (performance.now() - start) / 1000,
      interrupted,
    );
    await summaryFile.writeFile(JSON.stringify(summary, null, 2) + "\n");
    await file.sync();
    await summaryFile.sync();
    console.log(JSON.stringify(summary, null, 2));
    if (summary.outcome !== "observed-within-sampled-limits")
      process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await file.close();
    await summaryFile.close();
  }
}
void main().catch(() => {
  console.error(
    "REHEARSAL_FAILED: Check duration (1–3600 seconds), interval (1–60 seconds), PORT, local creator availability and a new output filename inside .data. No credentials, messages or recording paths were printed.",
  );
  process.exitCode = 1;
});
