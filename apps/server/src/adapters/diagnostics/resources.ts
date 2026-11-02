import { statfs, readdir, lstat, readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { containsPath } from "../storage/paths.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { z } from "zod";
import {
  Resources,
  ProcessSample,
} from "../../../../../shared/contracts/operations.ts";
type DiskUsage = NonNullable<z.infer<typeof Resources>["diskUsage"]>;
type Proc = {
  pid: number;
  parent: number;
  started: string;
  rssBytes: number;
  cpuMicros: number;
};
// Allocated bytes deduplicated by inode; never follow symlinks or print names.
export async function managedDiskUsage(roots: string[]): Promise<DiskUsage> {
  const paths = [...new Set(roots.map((p) => resolve(p)))].filter(
    (p, _, all) => !all.some((other) => other !== p && containsPath(other, p)),
  );
  const pending = [...paths],
    seen = new Set<string>();
  const result: DiskUsage = {
    sampledAt: new Date().toISOString(),
    allocatedBytes: 0,
    logicalBytes: 0,
    files: 0,
    complete: true,
  };
  const deadline = performance.now() + 2000;
  while (pending.length) {
    if (seen.size >= 100000 || performance.now() > deadline) {
      result.complete = false;
      break;
    }
    const path = pending.pop();
    if (!path) break;
    try {
      const info = await lstat(path);
      const key = info.dev + ":" + info.ino;
      if (seen.has(key)) continue;
      seen.add(key);
      if (process.platform !== "win32" && Number.isFinite(info.blocks))
        result.allocatedBytes += info.blocks * 512;
      else result.complete = false; // Windows does not supply POSIX allocated blocks.
      result.logicalBytes += info.size;
      if (info.isDirectory()) {
        const entries = await readdir(path);
        if (entries.length + pending.length > 100000) {
          result.complete = false;
          break;
        }
        for (const name of entries) pending.push(join(path, name));
      } else result.files++;
    } catch {
      result.complete = false;
    }
  }
  return result;
}
export function resourceSampler(
  root: string,
  readerPid?: number,
  readerRoot?: string,
) {
  const instanceId = randomUUID();
  let readerStarted: string | undefined;
  let diskCache: DiskUsage | undefined;
  let diskWork: Promise<DiskUsage> | undefined;
  let constants: Promise<{ ticks: number; page: number }> | undefined;
  async function processSamples() {
    if (process.platform !== "linux")
      return {
        processSamples: [],
        processesComplete: false,
        readerObserved: false,
      };
    constants ??= Promise.all(
      ["CLK_TCK", "PAGESIZE"].map(async (name) =>
        Number(
          (
            await promisify(execFile)("getconf", [name], { timeout: 1000 })
          ).stdout.trim(),
        ),
      ),
    ).then(([ticks, page]) => {
      if (!ticks || !page) throw Error("Counters unavailable");
      return { ticks, page };
    });
    const { ticks, page } = await constants;
    const records: Proc[] = [];
    const names = await readdir("/proc");
    let complete = true;
    // No command lines, environment, paths or process names are collected.
    for (const name of names.filter((s) => /^\d+$/.test(s))) {
      try {
        const text = await readFile("/proc/" + name + "/stat", "utf8");
        const fields = text
          .slice(text.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/);
        const parent = Number(fields[1]),
          started = fields[19];
        const rssBytes = Number(fields[21]) * page;
        const cpuMicros =
          ((Number(fields[11]) + Number(fields[12])) * 1e6) / ticks;
        if (!started || ![parent, rssBytes, cpuMicros].every(Number.isFinite)) {
          complete = false;
          continue;
        }
        records.push({
          pid: Number(name),
          parent,
          started,
          rssBytes: Math.max(0, rssBytes),
          cpuMicros,
        });
      } catch {
        /* Processes can exit during enumeration. */
      }
    }
    const reader = records.find((p) => p.pid === readerPid);
    if (reader && readerStarted === undefined) readerStarted = reader.started;
    const readerObserved = Boolean(reader && reader.started === readerStarted);
    const roots = new Map<number, z.infer<typeof ProcessSample>["role"]>([
      [process.pid, "creator"],
    ]);
    if (readerObserved && readerPid) roots.set(readerPid, "reader");
    const samples: z.infer<typeof ProcessSample>[] = [];
    for (let pass = 0; pass < 128; pass++) {
      let added = false;
      for (const proc of records) {
        const parentRole = roots.get(proc.parent);
        if (!roots.has(proc.pid) && parentRole) {
          roots.set(
            proc.pid,
            parentRole.startsWith("reader") ? "reader-child" : "creator-child",
          );
          added = true;
        }
      }
      if (!added) break;
      if (pass === 127) complete = false;
    }
    for (const proc of records) {
      const role = roots.get(proc.pid);
      if (!role) continue;
      if (samples.length === 128) {
        complete = false;
        break;
      }
      samples.push({
        identity: createHash("sha256")
          .update(proc.pid + ":" + proc.started)
          .digest("hex"),
        role,
        rssBytes: proc.rssBytes,
        cpuMicros: proc.cpuMicros,
      });
    }
    if (!samples.some((s) => s.role === "creator")) complete = false;
    return {
      processSamples: samples,
      processesComplete: complete,
      readerObserved,
    };
  }
  return async () => {
    const disk = await statfs(root),
      cpu = process.cpuUsage();
    if (!diskCache || Date.now() - Date.parse(diskCache.sampledAt) > 5000) {
      diskWork ??= managedDiskUsage([
        root,
        ...(readerRoot ? [readerRoot] : []),
      ]).finally(() => {
        diskWork = undefined;
      });
      diskCache = await diskWork;
    }
    const processes = await processSamples().catch(() => ({
      processSamples: [],
      processesComplete: false,
      readerObserved: false,
    }));
    return Resources.parse({
      instanceId,
      rssBytes: process.memoryUsage().rss,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
      uptimeSeconds: process.uptime(),
      diskFreeBytes: disk.bavail * disk.bsize,
      diskUsage: diskCache,
      ...processes,
    });
  };
}
