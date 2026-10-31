import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
export async function fingerprintFiles(files: string[]) {
  const hash = createHash("sha256");
  for (const file of files) {
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    hash.update("\0");
  }
  return hash.digest("hex");
}
