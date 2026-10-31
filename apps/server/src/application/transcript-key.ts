import { createHash } from "node:crypto";
export function transcriptKey(
  assetId: string,
  checksum: string,
  provider: string,
  fingerprint: string,
  start: number,
  end: number,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        assetId,
        checksum,
        provider,
        fingerprint,
        start,
        end,
        "extract-v1",
      ]),
    )
    .digest("hex");
}
