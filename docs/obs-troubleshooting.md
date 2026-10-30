# OBS window capture on Fedora

There are two separate capture paths: **OBS recording ingestion** and the browser's **Choose screen or tab** button. The browser button does not configure OBS. ReplyLink reads OBS's active recorded scene and selected recorded audio track; it does not pick a window or start a recording for you.

## Inspect without changing capture

Keep OBS open and run:

```sh
npm run obs:doctor
```

This authenticates to the loopback WebSocket, subscribes to no events, and reads version/recording status and source types. It never starts/stops recording, splits files, changes scenes, chooses a window or takes a screenshot. Output omits window/source names, recording paths and credentials. Nested scene/group sources are not expanded. A readable directory is not proof that OBS is writing to that same folder; check the configured recording path in OBS itself.

The initial workstation check found native OBS 32.1.1 on GNOME Wayland, active PipeWire/GNOME portal services, a visible PipeWire **screen** source and recording **stopped**. OBS was later closed, and subsequent connection checks correctly failed. These checks do not verify captured pixels or sound.

## If the window is missing or black in OBS

1. Keep the intended application window open. In OBS Sources, use **Window Capture (PipeWire)** where available on this Wayland session. Select the target in the system sharing dialog. Check OBS's preview/program output before opening ReplyLink.
2. Check that the source is visible in the intended scene and fits the canvas. If using Studio Mode, ensure the intended scene is in Program output.
3. If the chooser was cancelled or the target was closed, reopen that source's properties and choose the window again. If no window option exists, inspect `windowCaptureAvailable` and report the available PipeWire options; do not blindly replace portal packages or restart desktop services.

OBS documents separate Linux [Xcomposite and PipeWire window sources](https://obsproject.com/kb/window-capture-sources). This workstation is using Wayland; a connected WebSocket is not evidence that a capture source has valid pixels.

## If OBS looks correct but ReplyLink has no footage

1. Start ReplyLink before the test. In OBS, choose a split-capable MKV recording profile, the intended scene, and the recorded track matching `OBS_AUDIO_TRACK` (currently configured as 1). Speak and check the intended audio meter; verify that source is included on that recording track.
2. Click **Start Recording** in OBS. Streaming is unnecessary. “Connected” and a preview alone do not record anything.
3. Keep recording for at least about 60 seconds. ReplyLink requests 30-second splits; the first original file remains in OBS and usable managed footage normally arrives after the second split. Wait for `obs.segment_saved` and saved segments in the studio; processing can add delay.
4. Choose **Save OBS exchange** in the creator studio, select the original message, and play the full interval to check opening/closing words and synchronization. The browser capture button is a separate source.

For a cross-segment test, speak an actual response around seconds 50–70 and stop around second 80. Wait for both closed segments to finish importing, then save up to 90 seconds of contiguous footage. Review the complete response; the initial warm-up footage remains in OBS originals. Pauses/reconnects/missed files end continuity and must not be silently joined.

If import fails, inspect the sanitized CLI event: `MEDIA_AUDIO_TRACK_MISSING` means check recorded tracks; codec/decode errors need an available local decoder or a supported finalized import; `ENOSPC` means free disk space. Originals remain untouched. Do not represent the device test as passed until the actual window and sound are verified.

## If the browser's window picker is the failing path

Browser window sharing on Linux can provide video without audio. ReplyLink explains that case and stops the selected stream before starting an upload. Use OBS's intended mix or a supported browser tab with shared audio. ReplyLink does not silently add a microphone to work around missing audio.
