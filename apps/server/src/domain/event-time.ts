// Preserve RFC3339 sub-millisecond ordering for Twitch clear/message events.
// Date.parse normalizes offsets but truncates the fraction to milliseconds.
export function eventNanoseconds(value: string) {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error("Invalid event timestamp");
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
  return (
    BigInt(millis) * 1000000n + BigInt(fraction.padEnd(9, "0").slice(3, 9))
  );
}
