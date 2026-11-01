# Local workflow and the latest upgrades

Rebuild and restart with `npm run build && npm run dev:local`. Creator: http://localhost:4317; reader: http://localhost:4320. Preserve the existing `.env` and collection. No cloud account is needed.

## Find an original message

Open **Received chat** in the left navigation. Search the viewer or message text, filter **Received from Twitch**, **Manually entered** or **Labelled fixtures**, and select a saved recording before **Connect response**. Event timestamps identify Twitch's event envelope; they are not calibrated broadcast timestamps. New Twitch messages also retain separately measured local arrival time. Search is literal, and Older/Newer controls page through history without loading every message into the browser. Removed messages remain visible only when **Include removed messages** is selected, and cannot start an exchange. This is a private creator inbox, not a public viewer directory.

The editor keeps the selected original message. **Response** contains the waveform and trimming controls; **Captions** contains local transcription and caption correction; **Evidence & notes** contains original automatic evidence and private quality assessments. The video stays visible across the three panels, and switching panels preserves unfinished edits. Correct the interval and preview actual footage, save, transcribe in Captions, review/apply captions, save again and approve the exact revision. Private drafts never publish automatically. The published library retains each approved title/version even when its draft is subsequently edited or discarded.

Unsaved draft edits block navigation to another workspace view. **Revert unsaved changes** explicitly returns to the saved revision; browser navigation also receives the browser's unsaved-change warning. A lost studio connection shows an offline banner and the last successful update, while keeping the editor text. **Reconnect studio** reacquires the local session after a restart. Status requests time out rather than looking fresh indefinitely.

## Prove capture readiness

Expand **Capture readiness**. OBS and browser capture are separate paths. The OBS panel distinguishes connection, stopped, warm-up, recording, pause and failures, with importing/closed-segment counts. Status is checked every five seconds; splitting remains every thirty seconds. Closed-footage counts include retained history, so play the chosen clip rather than assuming it is from the current recording.

**Check OBS audio & routing** opens a separate authenticated, read-only inspection. It reports anonymous mute/gain/track settings without changing OBS or disclosing input names, paths or passwords. An unmuted input can still be the wrong/inactive device. In OBS, verify the intended meter moves, then play a new saved clip to confirm speech and synchronization. See [Fedora capture/audio recovery](obs-troubleshooting.md).

## Suggestions that cross a split

For each new closed OBS segment, local assistance can analyze up to three contiguous segments ending at that segment, bounded to 180 seconds / 220 MB. An epoch change, sequence gap, unknown legacy continuity or resource bound stops the window. A new independent source preserves the actual joined media. Work pins all inputs while queued; prepared sources survive retry/restart. Unreferenced analysis copies expire after fifteen minutes, while immutable draft revisions protect saved media.

Suggestions include their number of source segments and retain their evidence interval privately. Overlapping windows do not repeatedly suggest an original message, including a suggestion that was discarded. Context-aware drafts propose whole-sentence context around their evidence and flag recording edges; the complete private source remains available for boundary correction. `ASSISTANCE_V2=false` retains the older full-window, single-answer policy. An answer can still be longer than the available window. Preview the opening/closing words and use the original recording if needed. The matcher still abstains conservatively; broader independent accuracy and real cross-split speech acceptance are pending. The local embedding model is reused within the creator process and released at shutdown.

## Keep useful evaluation evidence

In a saved draft, open **Evidence & notes → Keep a private quality note**. After listening, record whether that saved revision connects the correct message and keeps complete response boundaries. Notes are tied to that revision and do not edit or approve it. Saving a revised draft starts a separate assessment; previous assessments remain in the private collection.

**Sources & setup → Download private review dataset** exports the latest assessment per reviewed revision, its original message and saved captions, with fixture/recorded-source counts. The export is authenticated and separate from publishing. Captions may have been corrected, so this collection is creator assessment evidence, not untouched ASR or independently labelled matching accuracy. Do not present fixture reviews as actual usability feedback.

## Observe a rehearsal

With the local app running, use a separate terminal:

```sh
npm run rehearse -- --minutes 30
npm run rehearse -- --minutes 45
npm run rehearse -- --minutes 60
```

Choose the duration appropriate to the rehearsal you are actually performing. For a quick tool check, `npm run rehearse -- --seconds 10 --interval 2` is explicitly labelled a short diagnostic. Reports go into private `.data/rehearsals/`; a custom `--out` must remain inside `.data` and an existing file is never overwritten. Ctrl+C writes an interrupted summary.

The tool only requests authenticated loopback metrics. It does not record, change OBS, send messages or publish. On Linux it samples creator, active descendant and configured local reader RSS/CPU, managed physical disk use, source quota metadata, queue depths and failed-work counts. Use `dev:local` to supply the local reader identity. Missing reader/partial process or disk measurements remain explicit. Sampling can miss peaks and short-lived work; RSS sums include shared pages and CPU compares surviving processes only. OBS statistics, dropped frames, playback latency and human usability still need separate measurements. A resource report cannot complete live acceptance. Follow [the rehearsal worksheet](rehearsal.md).


## Review the original proposal

In **Evidence & notes**, new automatic drafts include **Why this connection?** with the original ASR evidence, method and edge warning. **Play original proposed range** previews that range even after you edit your selected interval. Original source sentence controls seek/play the corresponding raw evidence. Choosing a different recording disables those controls until the original source is selected.

Expand **Assess the original suggestion** to record the original message association, boundaries, transcript quality and optional correction time. Correct captions/intervals afterward; the original snapshot does not change. Setup offers **Download original suggestion assessments**, separately from the saved-revision quality dataset. Both exports contain private source text and are for local evaluation, not publication or independent accuracy claims.

Use the waveform's handles or numeric times to trim. Focus the timeline section for Space (play/pause), I/O (set start/end), J/L (seek one second) and Shift+J/L (0.1 seconds). Zoom focuses on the current selection. Transcript Start/End range controls preserve individual sentence captions. Save before approval; approved replay captions provide a clickable transcript and active-sentence highlight.

The local suggestion activity panel shows phases, abstention/failure and generation-safe cancel/retry. Retrying explicitly captures current local model/policy configuration; it never publishes. Existing drafts without preserved suggestion snapshots keep the normal manual-review controls.


## Move through review with fewer detours

**Previous exchange / Next exchange** moves through the current filtered queue. Draft changes still require saving or explicit reversion before leaving. The bottom action bar keeps save state and **Save changes** close by. **Review approval** moves focus to the existing publication controls; it does not approve or publish anything. Publication still requires the explicit exact-revision approval button.

To correct a draft to an older message, expand **Find another original message** below its message selector. Search the viewer or original words, use Older/Newer matches as needed, and choose the actual saved message. Source labels remain visible. The selected message is refreshed while unsaved so removed/unavailable sources remain visible; saving creates a revision. Published revisions keep their original message. Existing recent-message selection remains available.

Draft captions preview on the private source video through its native **CC** control before rendering. Caption timing is translated back to source time; invalid/incomplete captions pause the preview rather than showing stale words. These are edited caption words over the original speech. Preview tracks stay in the browser, are released when replaced, and do not publish or change approved media.

Caption words are plain text: code comparisons, ampersands, literal angle brackets and arrows now survive from draft preview into approved reader captions and newly generated portrait subtitles. Restart the reader to use the updated formatter; previously generated portrait files need explicit regeneration.

## Find and share a moment in a replay

Open an approved replay. **Read the approved transcript → Find in this transcript** searches that replay's approved captions, including literal code. Select a matching caption to seek without starting audio. Clear the search to restore all captions. No private source transcript is searched or returned.

**Copy replay link** shares the whole exchange; **Copy link to 0:…** starts a recipient at your current position, paused. These links use seconds relative to the approved replay, bounded to that clip. The copied URL drops unrelated query parameters and fragments. If clipboard permission is denied, a selectable link field appears.

Media loading and failures appear below the player. **Retry playback** reloads media at the previous position without autoplay. A failed initial timestamped load retains its requested position on retry. Persistent codec errors may require a browser with MP4 support.

Open replays check availability every fifteen seconds while visible and when the page regains focus/visibility. A confirmed 404/410 clears the exchange and discards that player's buffered video. An interrupted check preserves the already loaded approved replay and offers **Check availability**. Offline pages and previously downloaded copies cannot be recalled. The reader homepage remains link-only.

## Connect a received message to a recording

In **Received chat**, choose **Recording for this exchange** before connecting a response. Each message offers **Choose recording** to focus that selector; if there are no saved recordings, **Add recording** opens Sources & setup. No recording is selected automatically.

After selecting footage, **Connect response** saves a private draft and opens its editor. Only the clicked row shows **Saving private exchange…** while the request runs. Preview and correct the interval before approval. Background inbox refreshes no longer block this action.

Failures appear beside the clicked message. If saving exceeds eight seconds, the UI releases the pending state and offers **Open Review exchanges**. A timed-out request may already have saved its draft; check the queue before manually retrying. No mutation is automatically repeated, and connecting never approves or publishes.
