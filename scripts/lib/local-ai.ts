import { stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export function semanticManifest(root: string) {
  const current = join(root, "thatbit-manifest.json");
  const legacy = join(root, "replylink-manifest.json");
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

export async function whisperExecutable(
  build: string,
  platform = process.platform,
) {
  const candidates =
    platform === "win32"
      ? [
          join(build, "bin", "Release", "whisper-cli.exe"),
          join(build, "bin", "whisper-cli.exe"),
        ]
      : [join(build, "bin", "whisper-cli")];
  for (const candidate of candidates) {
    if (
      await stat(candidate)
        .then((s) => s.isFile())
        .catch(() => false)
    )
      return candidate;
  }
  throw new Error(
    "Whisper build completed without a usable CLI. On Windows use CMake and Visual Studio C++ Build Tools (Release configuration).",
  );
}

export function modelEnvironment(
  values: Record<string, string>,
  platform = process.platform,
) {
  return (
    Object.entries(values)
      .map(([key, value]) => {
        if (!/^[A-Z_]+$/.test(key) || /[\r\n"]/.test(value))
          throw new Error("Unsupported local model path.");
        return `${key}="${platform === "win32" ? value.replaceAll("\\", "/") : value}"`;
      })
      .join("\n") + "\n"
  );
}
