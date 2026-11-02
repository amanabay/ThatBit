// SIGTERM force-terminates Windows processes. The local supervisor uses IPC
// instead so SQLite/media work can close through the same normal stop path.
export function onShutdown(stop: () => void) {
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, stop);
  process.on("message", (message: unknown) => {
    if (message === "replylink:shutdown") stop();
  });
  if (process.connected) process.on("disconnect", stop);
}
