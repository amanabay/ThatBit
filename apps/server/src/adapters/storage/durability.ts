import { open } from "node:fs/promises";

export async function syncDirectory(directory: string) {
  // Node cannot open/sync directory handles on Windows. File contents are
  // still flushed before rename; POSIX additionally syncs the directory entry.
  // Do not suppress real I/O failures on platforms supporting directory fsync.
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
