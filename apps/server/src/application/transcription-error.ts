// Known source faults cannot be repaired by retrying inference on immutable media.
export class TranscriptionAudioError extends Error {
  readonly code: string;
  constructor(reason: "missing" | "silent") {
    super(
      reason === "silent"
        ? "The selected interval contains silent audio. Check the OBS microphone mute, device and recording-track routing, record a new clip, then transcribe it. Existing silent footage cannot supply captions."
        : "This recording has no audio stream. Check the OBS recording tracks and record a new clip before transcribing.",
    );
    this.code =
      reason === "silent" ? "MEDIA_AUDIO_SILENT" : "MEDIA_AUDIO_TRACK_MISSING";
  }
}
