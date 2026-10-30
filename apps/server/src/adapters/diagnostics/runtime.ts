import { createDiagnostics, processDiagnostics } from "./logger.ts";
import type { Diagnostics } from "../../application/diagnostics.ts";
export async function runLogged(
  service: "creator" | "reader" | "static-reader",
  root: string,
  start: (log: Diagnostics) => Promise<void>,
) {
  let log: Diagnostics;
  try {
    log = processDiagnostics(service, root);
  } catch (error) {
    createDiagnostics({ service }).event(
      "error",
      "logging.configuration_failed",
      {},
      error,
    );
    process.exit(1);
  }
  // Continuing after an unexpected asynchronous failure can leave incomplete work.
  process.once("uncaughtException", (error) => {
    log.event("error", "service.crashed", {}, error);
    process.exit(1);
  });
  process.once("unhandledRejection", (error) => {
    log.event("error", "service.rejection", {}, error);
    process.exit(1);
  });
  log.event("info", "service.starting");
  try {
    await start(log);
  } catch (error) {
    log.event("error", "service.startup_failed", {}, error);
    process.exit(1);
  }
}
