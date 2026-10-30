import { resolve } from "node:path";
import { readerServer } from "../adapters/publishing/reader.ts";
import { runLogged } from "../adapters/diagnostics/runtime.ts";
await runLogged(
  "reader",
  resolve(process.env.READER_DATA_DIR ?? ".data/reader"),
  async (log) => {
    const server = await readerServer(
      resolve(process.env.READER_DATA_DIR ?? ".data/reader"),
      process.env.READER_WRITE_TOKEN ?? "",
      resolve("dist"),
      process.env.READER_PUBLIC_ORIGIN ??
        process.env.RENDER_EXTERNAL_URL ??
        `http://localhost:${process.env.PORT ?? 4320}`,
      log,
    );
    await server.listen({
      host: process.env.READER_HOST ?? "127.0.0.1",
      port: Number(process.env.PORT ?? 4320),
    });
    log.event("info", "service.ready", {
      port: Number(process.env.PORT ?? 4320),
    });
    let stopping = false;
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        log.event("info", "service.stopping");
        void server.close().then(() => {
          log.event("info", "service.stopped");
          process.exit(0);
        });
      });
  },
);
