import type {
  Asset,
  Caption,
  Message,
} from "../../../../shared/contracts/models.ts";
export class Conflict extends Error {}
export function validateInterval(
  asset: Asset,
  start: number,
  end: number,
  captions: Caption[],
) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > asset.duration + 0.04 ||
    end - start > 180
  )
    throw new Conflict(
      "Choose a valid interval of up to 180 seconds within this recording.",
    );
  let previous = 0;
  for (const c of captions) {
    if (c.start < previous || c.end <= c.start || c.end > end - start + 0.04)
      throw new Conflict(
        "Captions must be ordered and contained in the approved interval.",
      );
    previous = c.end;
  }
}
export function reviewable(message: Message) {
  if (message.removed)
    throw new Conflict(
      "The original message was removed. Choose another message.",
    );
}
export function checkVersion(actual: number, expected: number) {
  if (actual !== expected)
    throw new Conflict(
      "This draft changed. Reload it before editing or approving.",
    );
}
