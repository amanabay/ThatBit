import { useEffect, useState } from "react";
import { draftCaptionVtt } from "./captions.ts";
export function DraftCaptionTrack({
  text,
  sourceStart,
  duration,
}: {
  text: string;
  sourceStart: number;
  duration: number;
}) {
  const [source, setSource] = useState<{ key: string; url: string }>();
  const key = JSON.stringify([text, sourceStart, duration]);
  useEffect(() => {
    const vtt = draftCaptionVtt(text, sourceStart, duration);
    if (!vtt) {
      setSource(undefined);
      return;
    }
    const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setSource({ key, url });
    return () => URL.revokeObjectURL(url);
  }, [text, sourceStart, duration, key]);
  if (source?.key !== key) return null;
  return (
    <track
      key={source.url}
      kind="captions"
      label="Draft caption preview"
      srcLang="und"
      src={source.url}
      default
    />
  );
}
