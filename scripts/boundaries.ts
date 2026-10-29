import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
export function violation(file: string, specifier: string) {
  const target = specifier.startsWith(".")
    ? relative(process.cwd(), resolve(dirname(file), specifier))
    : specifier;
  if (
    file.includes("/domain/") &&
    (specifier.startsWith("node:") ||
      !specifier.startsWith(".") ||
      /adapters|application|http|web/.test(target))
  )
    return true;
  if (file.startsWith("apps/web/") && /apps\/server/.test(target)) return true;
  if (file.includes("/application/") && /adapters|http|apps\/web/.test(target))
    return true;
  if (
    /adapters\/(matching|transcription)/.test(file) &&
    /exchanges|twitch|http/.test(target)
  )
    return true;
  return false;
}
async function walk(path: string): Promise<string[]> {
  const rows = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      rows.map((e) =>
        e.isDirectory()
          ? walk(path + "/" + e.name)
          : Promise.resolve([path + "/" + e.name]),
      ),
    )
  ).flat();
}
const files = await walk("apps");
const failures: string[] = [];
for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
  const source = await readFile(file, "utf8");
  for (const m of source.matchAll(
    /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g,
  )) {
    if (m[1] && violation(file, m[1])) failures.push(file + ": " + m[1]);
  }
}
if (
  !violation("apps/server/src/domain/bad.ts", "node:fs") ||
  !violation(
    "apps/web/src/bad.ts",
    "../../server/src/application/exchanges.ts",
  ) ||
  !violation(
    "apps/server/src/application/bad.ts",
    "../adapters/storage/sqlite.ts",
  )
)
  throw new Error("Negative architecture fixtures failed");
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  `Import boundaries passed (${files.length} files + negative fixtures).`,
);
