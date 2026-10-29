# Current status — 2026-10-29

Local-first implementation. No DigitalOcean resources, Render service, credit use or paid inference. No external recording publication or real Twitch send. M0–M6 acceptance is incomplete.

Run CPU-only `npm ci` as documented in README, optionally `npm run demo`, then `npm run build && npm run dev:local`. Creator: http://localhost:4317; separate reader: http://localhost:4320. `npm run ai:setup` installs verified local models; setup has completed on this workstation. `npm run check` is the integrated gate.

## Working capabilities

- Durable browser chunk capture/recovery and live private snapshots; finalized import; immutable revisions, exact-revision approval, local FFmpeg replay/captions, removal fencing and portrait export.
- Durable interval-specific Whisper jobs with retry/cancel/restart fencing; actual local prerecorded speech inference passed. Captions and suggested messages require review.
- Independent managed reader with authenticated writer, checksum/duration validation, staged availability, restart persistence, range playback, withdrawal tombstones and managed media cleanup. Creator tracks upload/removal acknowledgement and retries. Separate local browser playback/removal is tested.
- Authenticated OBS v5 integration, selected recorded audio track (environment configuration), 30-second split ingestion, bounded processing, preserved originals, 15-minute unreferenced segment retention and pinning. First usable closed segment normally arrives around 60 seconds; the first file remains in OBS originals.
- Manual OBS snapshot joins contiguous closed segments up to 180 seconds / 220 MB; UI offers up to 150 seconds. Recording epochs/sequence gaps prevent joining across pauses, reconnects or missed files. Assembly pins its inputs and creates an independent durable source. Actual decoded fixture frames verify both sides of a join.
- Automatic local assistance has bounded durable work and validates source IDs/excerpts/timestamps before creating a private draft. It analyzes one closed segment. MiniLM embeddings plus named-message evidence and explicit deferral abstention remain experimental.
- Render Blueprint, nonroot Docker reader, loopback Compose and manual-only deploy workflow prepared. No remote CI or Render deployment was run.

## Matching evidence and limits

Twelve tuning and sixty separately authored evaluation cases now exist. The initial frozen embedding baseline suggested 11/60, with 6 correct and 5 false associations (mostly deferrals). The baseline report is preserved. After inspecting/fixing those cases, the regression rerun gave 10/10 correct suggestions, 50 abstentions; recall 10/29 positives. This rerun is not an untouched holdout. Independent creator labels, broader paraphrase coverage, actual ASR/noise, boundary quality and correction-effort acceptance remain open. Do not advertise these numbers as live accuracy.

## Remaining acceptance and engineering

1. Configure Twitch through local .env/device login; verify a real received message and deletion. Outbound sharing remains a separate explicit creator action after a verified external reader exists.
2. Configure OBS and verify intended recorded track, mute/pause, visual/speech synchronization, warm-up and a cross-segment spoken answer. Protocol fixtures do not prove actual OBS/device behavior.
3. Perform the 30–45 and 60 minute English coding rehearsals with resource/queue/disk measurements. Collect one creator and one viewer’s unaided feedback.
4. Improve low matching coverage using new independently labelled examples; automatic cross-segment candidate assembly is still open. Social previews, caption-editor polish, broader Twitch/fault matrix, naming and submission assets remain unfinished.
5. External playback/delivery acceptance awaits separately authorized deployment. Render configuration is prepared without provisioning.

Latest checks passed: 19 Node tests, nine Chromium flows, typecheck/lint/boundaries, baseline matching and production build. The previous local-first slice also passed a real Docker publication/two-restart/removal smoke. Evidence is in docs/testing.md. Generated media/model paths are ignored. The local-first checkpoint is `2c946c2`; see Git log for subsequent fixes. No push or remote deployment was performed.

## Draft-save and transcription repair

The editor now shows an adjacent saved checkmark, revision and time; unsaved, saving and failed states are distinct. No-change saves retain the current revision, and typing during a save remains unsaved rather than being overwritten. Analysis/approval require saved changes. Whisper padding had produced an invalid final timestamp (31.04 seconds for a 30-second request); the adapter now bounds estimates to the actual extracted audio without weakening general provider validation. Real local inference and caption saving completed on the affected recording in an isolated collection in about eight seconds, without modifying the original collection or printing transcript text. Restart ReplyLink and retry failed analysis jobs to use the fix. Continuous OBS acceptance remains pending the user’s next test.

## Purple glass interface

The studio and replay now share deep purple semantic colors, an ink-dark default, and a lavender light theme. The sun/moon control persists its preference before first paint and synchronizes same-origin tabs without losing unsaved draft edits. Frosted cards, a floating navigation rail, editor/setup surfaces and a custom thread mark replace the former green identity. Glass includes opaque/reduced-transparency fallbacks; reduced-motion support remains. Mobile setup dialog sizing was corrected so the close button stays within the viewport.

The purple-glass refresh passed the full local gate (19 Node tests / nine browser flows), with actual desktop/mobile screenshot inspection and dark/light contrast checks. See docs/testing.md for evidence and remaining live gates.
