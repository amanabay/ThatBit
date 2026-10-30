import { existsSync, accessSync, constants } from "node:fs";
import { inspectObs } from "../apps/server/src/adapters/obs/inspect.ts";
try {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const directory = process.env.OBS_RECORD_DIR,
    password = process.env.OBS_PASSWORD;
  if (!directory || !password) throw new Error("OBS settings missing");
  let directoryReadable = false;
  try {
    accessSync(directory, constants.R_OK);
    directoryReadable = true;
  } catch {
    /* Report only a flag, never the path. */
  }
  const audioTrack = Number(process.env.OBS_AUDIO_TRACK ?? 1);
  const report = await inspectObs(password);
  const next: string[] = [];
  if (!directoryReadable)
    next.push("Check OBS_RECORD_DIR and its local read permissions.");
  if (!Number.isInteger(audioTrack) || audioTrack < 1 || audioTrack > 6)
    next.push(
      "Set OBS_AUDIO_TRACK to the intended recorded audio track (1–6).",
    );
  if (!report.recording)
    next.push(
      "Start Recording in OBS after verifying the intended window in its preview.",
    );
  else if (report.paused)
    next.push(
      "OBS is paused. Resume recording when ready; gaps are kept separate.",
    );
  if (
    report.visibleSourceKinds.some(
      (k) => k.includes("pipewire") && k.includes("screen"),
    ) &&
    !report.visibleSourceKinds.some((k) => k.includes("window"))
  )
    next.push(
      "The scene currently uses a screen capture source. For a single window, select it using an OBS PipeWire window source if available.",
    );
  next.push(
    "Wait roughly 60 seconds for the first usable closed segment, then use Save OBS exchange. A connected preview alone does not record footage.",
  );
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        directoryReadable,
        audioTrack,
        ...report,
        next,
        note: "No capture settings changed. Names, paths, credentials and images are omitted. Nested scene/group sources are not expanded.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  const known: Record<string, string> = {
    "OBS is unreachable. Open OBS and enable its authenticated WebSocket.":
      "OBS_UNREACHABLE: Open OBS and enable its authenticated WebSocket on port 4455.",
    "OBS closed the inspection connection. Check authentication.":
      "OBS_AUTH_OR_CONNECTION_ENDED: Check OBS WebSocket authentication and keep OBS open.",
    "OBS inspection timed out. Check the authenticated WebSocket on port 4455.":
      "OBS_CHECK_TIMEOUT: Check OBS WebSocket responsiveness and port 4455.",
    "OBS rejected a read-only inspection request.":
      "OBS_CHECK_REJECTED: Check OBS version and WebSocket access.",
  };
  console.error(
    (error instanceof Error && known[error.message]) ||
      "OBS_CHECK_FAILED: Open OBS, enable its authenticated loopback WebSocket on port 4455, and check OBS_RECORD_DIR / OBS_PASSWORD in local .env. No capture settings were changed.",
  );
  process.exitCode = 1;
}
