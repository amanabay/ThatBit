import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const readerPort = process.env.LOCAL_READER_PORT ?? "4320";
const key = randomBytes(32).toString("hex");
const children = [
  spawn(
    process.execPath,
    ["--import", "tsx", "apps/server/src/http/managed-reader.ts"],
    {
      stdio: "inherit",
      env: { ...process.env, PORT: readerPort, READER_WRITE_TOKEN: key },
    },
  ),
  spawn(process.execPath, ["--import", "tsx", "apps/server/src/main.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      READER_URL: "http://127.0.0.1:" + readerPort,
      READER_WRITE_TOKEN: key,
    },
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
}
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, stop);
for (const c of children)
  c.on("exit", (code) => {
    if (!stopping && code !== 0) process.exitCode = 1;
    stop();
  });
console.log(
  `Local reader: http://localhost:${readerPort} · Creator: http://localhost:${process.env.PORT ?? 4317}`,
);
