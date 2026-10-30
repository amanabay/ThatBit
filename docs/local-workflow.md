# Local workflow and the latest upgrades

Rebuild and restart with `npm run build && npm run dev:local`. Creator: http://localhost:4317; reader: http://localhost:4320. Preserve the existing `.env` and collection. No cloud account is needed.

## Find an original message

Open **Received chat** in the left navigation. Search the viewer or message text, filter **Received from Twitch**, **Manually entered** or **Labelled fixtures**, and select a saved recording before **Connect response**. Event timestamps identify Twitch's event envelope; they are not calibrated broadcast timestamps. Removed messages remain visible only when **Include removed messages** is selected, and cannot start an exchange. This is a private creator inbox, not a public viewer directory.

The editor keeps the selected original message. Correct the interval and preview actual footage, save, transcribe, review/apply captions, save again and approve the exact revision. Private drafts never publish automatically. The published library retains each approved title/version even when its draft is subsequently edited or discarded.

Unsaved draft edits block navigation to another workspace view. **Revert unsaved changes** explicitly returns to the saved revision; browser navigation also receives the browser's unsaved-change warning. A lost studio connection shows an offline banner and the last successful update, while keeping the editor text. **Reconnect studio** reacquires the local session after a restart. Status requests time out rather than looking fresh indefinitely.

## Prove capture readiness

Expand **Capture readiness**. OBS and browser capture are separate paths. The OBS panel distinguishes connection, stopped, warm-up, recording, pause and failures, with importing/closed-segment counts. Status is checked every five seconds; splitting remains every thirty seconds. Closed-footage counts include retained history, so play the chosen clip rather than assuming it is from the current recording.

**Check OBS audio & routing** opens a separate authenticated, read-only inspection. It reports anonymous mute/gain/track settings without changing OBS or disclosing input names, paths or passwords. An unmuted input can still be the wrong/inactive device. In OBS, verify the intended meter moves, then play a new saved clip to confirm speech and synchronization. See [Fedora capture/audio recovery](obs-troubleshooting.md).

## Suggestions that cross a split

For each new closed OBS segment, local assistance can analyze up to three contiguous segments ending at that segment, bounded to 180 seconds / 220 MB. An epoch change, sequence gap, unknown legacy continuity or resource bound stops the window. A new independent source preserves the actual joined media. Work pins all inputs while queued; prepared sources survive retry/restart. Unreferenced analysis copies expire after fifteen minutes, while immutable draft revisions protect saved media.

Suggestions include their number of source segments and retain their evidence interval privately. Overlapping windows do not repeatedly suggest an original message, including a suggestion that was discarded. The suggested draft retains the full available window for boundary correction; an answer can still be longer than that window. Preview the opening/closing words and use the original recording if needed. The matcher still abstains conservatively; broader independent accuracy and real cross-split speech acceptance are pending. The local embedding model is reused within the creator process and released at shutdown.

## Keep useful evaluation evidence

In a saved draft, expand **Keep a private quality note**. After listening, record whether that saved revision connects the correct message and keeps complete response boundaries. Notes are tied to that revision and do not edit or approve it. Saving a revised draft starts a separate assessment; previous assessments remain in the private collection.

**Sources & setup → Download private review dataset** exports the latest assessment per reviewed revision, its original message and saved captions, with fixture/recorded-source counts. The export is authenticated and separate from publishing. Captions may have been corrected, so this collection is creator assessment evidence, not untouched ASR or independently labelled matching accuracy. Do not present fixture reviews as actual usability feedback.

## Observe a rehearsal

With the local app running, use a separate terminal:

```sh
npm run rehearse -- --minutes 30
npm run rehearse -- --minutes 45
npm run rehearse -- --minutes 60
```

Choose the duration appropriate to the rehearsal you are actually performing. For a quick tool check, `npm run rehearse -- --seconds 10 --interval 2` is explicitly labelled a short diagnostic. Reports go into private `.data/rehearsals/`; a custom `--out` must remain inside `.data` and an existing file is never overwritten. Ctrl+C writes an interrupted summary.

The tool only requests authenticated loopback metrics. It does not record, change OBS, send messages or publish. It samples creator-process RSS/CPU, source quota metadata, queue depths and failed-work counts. It reports gaps and declared threshold violations. Reader/OBS/media subprocess resources, physical total disk use, dropped frames, playback latency and human usability need separate measurements. A resource report cannot complete live acceptance. Follow [the rehearsal worksheet](rehearsal.md).
