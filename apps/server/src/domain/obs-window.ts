import type { Asset } from "../../../../shared/contracts/models.ts";
import type { ObsSegment } from "../../../../shared/contracts/capture.ts";

// A rolling analysis window ends at this particular segment, never at a newer
// arrival. Sequence/epoch gaps, unknown legacy continuity and limits stop it.
export function recentObsWindow(
  segments: ObsSegment[],
  assets: Asset[],
  tailId: string,
  limit = 3,
) {
  const tail = segments.find((s) => s.id === tailId);
  const asset = assets.find((a) => a.id === tailId);
  if (!tail || !asset) return [];
  const selected = [tail.id];
  let duration = asset.duration,
    bytes = asset.bytes,
    next = tail;
  while (tail.epoch && selected.length < Math.min(6, Math.max(1, limit))) {
    const prior = segments.find(
      (s) => s.epoch === next.epoch && s.sequence + 1 === next.sequence,
    );
    const a = assets.find((a) => a.id === prior?.id);
    if (
      !prior ||
      !a ||
      duration + a.duration > 180 ||
      bytes + a.bytes > 220 * 1024 * 1024
    )
      break;
    selected.unshift(prior.id);
    next = prior;
    duration += a.duration;
    bytes += a.bytes;
  }
  return selected;
}
