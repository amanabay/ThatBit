import { statfs } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const instanceId = randomUUID();
export async function processResources(root: string) {
  const disk = await statfs(root),
    cpu = process.cpuUsage();
  return {
    instanceId,
    rssBytes: process.memoryUsage().rss,
    cpuUserMicros: cpu.user,
    cpuSystemMicros: cpu.system,
    uptimeSeconds: process.uptime(),
    diskFreeBytes: disk.bavail * disk.bsize,
  };
}
