import { resolve } from "node:path";
import { readerServer } from "../adapters/publishing/reader.ts";
const server = await readerServer(
  resolve(process.env.READER_DATA_DIR ?? ".data/reader"),
  process.env.READER_WRITE_TOKEN ?? "",
  resolve("dist"),
  process.env.READER_PUBLIC_ORIGIN ??
    process.env.RENDER_EXTERNAL_URL ??
    `http://localhost:${process.env.PORT ?? 4320}`,
);
await server.listen({
  host: process.env.READER_HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4320),
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
