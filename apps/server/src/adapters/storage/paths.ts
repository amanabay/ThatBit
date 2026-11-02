import path from "node:path";

// relative() also detects different Windows drives and UNC shares. A slash
// prefix check alone does not establish containment on Windows.
export function containsPath(
  root: string,
  target: string,
  paths: Pick<typeof path, "relative" | "isAbsolute" | "sep"> = path,
) {
  const rel = paths.relative(root, target);
  return (
    rel === "" ||
    (!paths.isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith(".." + paths.sep))
  );
}
