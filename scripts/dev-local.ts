import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { onShutdown } from "../apps/server/src/adapters/runtime/shutdown.ts";
const readerPort = process.env.LOCAL_READER_PORT ?? "4320";
const key = randomBytes(32).toString("hex");
const reader = spawn(
  process.execPath,
  ["--import", "tsx", "apps/server/src/http/managed-reader.ts"],
  {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...process.env, PORT: readerPort, READER_WRITE_TOKEN: key },
  },
);
const creator = spawn(
  process.execPath,
  ["--import", "tsx", "apps/server/src/main.ts"],
  {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
      READER_URL: "http://127.0.0.1:" + readerPort,
      READER_WRITE_TOKEN: key,
      REPLYLINK_READER_PID: String(reader.pid ?? ""),
      REPLYLINK_READER_DATA_DIR: process.env.READER_DATA_DIR ?? ".data/reader",
    },
  },
);
const children = [reader, creator];
const running = new Set(children);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null || c.signalCode !== null) continue;
    if (c.connected)
      c.send("replylink:shutdown", (error) => {
        if (error && c.exitCode === null && c.signalCode === null) c.kill();
      });
    else c.kill();
  }
  // Normal shutdown can wait for bounded media work. Force exit only if a
  // child cannot finish; durable jobs recover on the next launch.
  const timer = setTimeout(() => {
    for (const c of children)
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  }, 15000);
  timer.unref();
}
onShutdown(stop);
for (const c of children) {
  c.on("error", (error) => {
    console.error("Local process could not start:", error.message);
    process.exitCode = 1;
    stop();
  });
  c.on("close", (code) => {
    if (!stopping || code !== 0) process.exitCode = 1;
    stop();
    running.delete(c);
    if (!running.size && process.connected) process.disconnect();
  });
}
console.log(
  `Local reader: http://localhost:${readerPort} · Creator: http://localhost:${process.env.PORT ?? 4317}`,
);
