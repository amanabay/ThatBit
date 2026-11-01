# Current status — 2026-11-01

Local-first implementation. No DigitalOcean resources, Render service, credit use or paid inference. No external recording publication or real Twitch send. M0–M6 acceptance is incomplete.

Run CPU-only `npm ci` as documented in README, optionally `npm run demo`, then `npm run build && npm run dev:local`. Creator: http://localhost:4317; separate reader: http://localhost:4320. `npm run ai:setup` installs verified local models; setup has completed on this workstation. `npm run check` is the integrated gate.

## Working capabilities

- Durable browser chunk capture/recovery and live private snapshots; finalized import; immutable revisions, exact-revision approval, local FFmpeg replay/captions, removal fencing and portrait export.
- Durable interval-specific Whisper jobs with retry/cancel/restart fencing; actual local prerecorded speech inference passed. Captions and suggested messages require review.
- Independent managed reader with authenticated writer, checksum/duration validation, staged availability, restart persistence, range playback, withdrawal tombstones and managed media cleanup. Creator tracks upload/removal acknowledgement and retries. Separate local browser playback/removal is tested.
- Authenticated OBS v5 integration, selected recorded audio track (environment configuration), 30-second split ingestion, bounded processing, preserved originals, 15-minute unreferenced segment retention and pinning. First usable closed segment normally arrives around 60 seconds; the first file remains in OBS originals.
- Manual OBS snapshot joins contiguous closed segments up to 180 seconds / 220 MB; UI offers up to 150 seconds. Recording epochs/sequence gaps prevent joining across pauses, reconnects or missed files. Assembly pins its inputs and creates an independent durable source. Actual decoded fixture frames verify both sides of a join.
- Automatic local assistance has bounded durable work and validates source IDs/excerpts/timestamps before creating a private draft. It can analyze up to three contiguous closed segments with durable assembly, retention pins and gap guards. MiniLM embeddings plus named-message evidence and explicit deferral abstention remain experimental.
- Render Blueprint, nonroot Docker reader, loopback Compose and manual-only deploy workflow prepared. No remote CI or Render deployment was run.
- Readable creator/reader CLI diagnostics with process/request/job correlation; caught worker and OBS/Twitch failures are visible. Private rotating JSONL logs, levels, sanitized failure codes and bounded browser runtime reports are implemented. See docs/logging.md. This is operational logging, not live rehearsal/performance acceptance.
- Twitch device login defaults to read-only chat, validates app/scopes/channel ownership before saving, and reports denial/expiry/configuration errors. Sharing permission is an explicit later opt-in. Protocol fixtures verify read-only welcome/subscriptions, duplicate intake and deletion; actual account authorization and live intake remain pending.

## Matching evidence and limits

Twelve tuning and sixty separately authored evaluation cases now exist. The initial frozen embedding baseline suggested 11/60, with 6 correct and 5 false associations (mostly deferrals). The baseline report is preserved. After inspecting/fixing those cases, the regression rerun gave 10/10 correct suggestions, 50 abstentions; recall 10/29 positives. This rerun is not an untouched holdout. Independent creator labels, broader paraphrase coverage, actual ASR/noise, boundary quality and correction-effort acceptance remain open. Do not advertise these numbers as live accuracy.

## Remaining acceptance and engineering

1. Configure Twitch through local .env/device login; verify a real received message and deletion. Outbound sharing remains a separate explicit creator action after a verified external reader exists.
2. Configure OBS and verify intended recorded track, mute/pause, visual/speech synchronization, warm-up and a cross-segment spoken answer. Protocol fixtures do not prove actual OBS/device behavior.
3. Perform the 30–45 and 60 minute English coding rehearsals with resource/queue/disk measurements. Collect one creator and one viewer’s unaided feedback.
4. Improve low matching coverage using new independently labelled examples; automatic cross-segment assembly is implemented; real cross-split speech/boundary acceptance is still open. External social unfurling, human caption review, actual device/network fault acceptance, naming and submission assets remain unfinished.
5. External playback/delivery acceptance awaits separately authorized deployment. Render configuration is prepared without provisioning.

Latest checks passed: 63 Node tests, forty-seven Chromium flows, typecheck/lint/boundaries, baseline matching and production build. Reader preview integration also verifies legacy image regeneration. The previous local Docker publication/two-restart/removal smoke includes PNG preview access and revocation. Evidence is in docs/testing.md. Generated media/model paths are ignored. The local-first checkpoint is `2c946c2`; see Git log for subsequent fixes. No push or remote deployment was performed.

## Silent OBS audio diagnosis

The Oct 30 diagnostic found digital silence in the inspected OBS original and managed copies at that time; the current device state has not been rechecked by the agent. Read-only inspection found desktop and microphone inputs both muted, with track routing present. No OBS settings or original media were changed. `obs:doctor` now reports anonymous mute/gain/routing; Whisper checks the extracted interval for missing/exactly silent audio before inference. Manual and automatic work fail once with actionable recovery guidance instead of retrying unchanged silent footage; empty model output no longer claims captions are ready. Quiet and late signals still proceed. The actual affected managed clip was rejected with `MEDIA_AUDIO_SILENT` and zero temporary-file leftovers. Record a new audible clip after unmuting the intended OBS source, then transcribe, review/apply captions, save and approve the revision. Real audible/synchronization acceptance remains pending; see docs/obs-troubleshooting.md.

## Draft-save and transcription repair

The editor now shows an adjacent saved checkmark, revision and time; unsaved, saving and failed states are distinct. No-change saves retain the current revision, and typing during a save remains unsaved rather than being overwritten. Analysis/approval require saved changes. Whisper padding had produced an invalid final timestamp (31.04 seconds for a 30-second request); the adapter now bounds estimates to the actual extracted audio without weakening general provider validation. Real local inference and caption saving completed on the affected recording in an isolated collection in about eight seconds, without modifying the original collection or printing transcript text. Restart ReplyLink and retry failed analysis jobs to use the fix. Continuous OBS acceptance remains pending the user’s next test.

## Purple glass interface

The studio and replay now share deep purple semantic colors, an ink-dark default, and a lavender light theme. The sun/moon control persists its preference before first paint and synchronizes same-origin tabs without losing unsaved draft edits. Frosted cards, a floating navigation rail, editor/setup surfaces and a custom thread mark replace the former green identity. Glass includes opaque/reduced-transparency fallbacks; reduced-motion support remains. Mobile setup dialog sizing was corrected so the close button stays within the viewport.

The purple-glass refresh passed the full local gate (19 Node tests / nine browser flows), with actual desktop/mobile screenshot inspection and dark/light contrast checks. See docs/testing.md for evidence and remaining live gates.

## Caption review and reader previews

Render feedback now shows queued/rendering/ready/failed state beside the exact approved revision, a persistent replay link after completion, friendly queue badges and a dismissible notification when working outside that editor. Render-only notices update on completion while unrelated notices remain intact. Explicit failed-render retry retains the approved revision, checks source/approval/message/queue guards and increments generation; newer draft edits cannot enter the retry. Read-only `npm run obs:doctor` and docs/obs-troubleshooting.md help distinguish OBS source selection, recording state and browser capture. The real window/audio acceptance gate remains open. The latest internal review was 32/40, up from 28/40, with evidence and remaining milestones in docs/iteration-review.md; it is not an official judging prediction.

Reader homepage repair: the reader root previously loaded Studio, whose private-session request received an empty 404 and caused JSON.parse errors. Managed/static reader HTML and public exports now carry a reader role marker; root/index/fallback show a public landing page, with no creator requests. API parsing handles empty/invalid responses and 204 explicitly; transient replay failures have a retry state distinct from removed replies. Rebuild/restart existing processes to use the fix. Actual user collection/media were not modified.

Full-transcript application retains the selected reply interval. Timed caption rows support word/time correction, playback, add/remove and validation; the advanced text editor remains. Trimming the start rebases relative caption times against the original recording and blocks saving captions outside the interval instead of silently dropping their words. Saved revisions still gate transcription and approval.

The managed reader creates a purple 1200 × 630 preview from approved metadata and derived video, with server-rendered Open Graph metadata and an explicit preview link in the studio. Staged/removed replies cannot expose it; withdrawal removes the PNG and rich metadata. A configured trusted origin prevents request-header poisoning. Bundled licensed fonts make UI and preview typography local. External platform unfurling/caching and actual human caption review remain pending; no deployment or actual Twitch send was performed.

## Local workflow upgrade

Implemented a searchable source-labelled Received chat inbox with explicit recording selection, removed-message visibility, capture readiness with five-second OBS checks and read-only audio inspection, bounded polling/offline/reconnect feedback, unsaved-edit navigation protection, and exact approved library metadata. Local assistance now uses up to three contiguous segments with durable prepared sources, input retention, gap/resource limits and overlap/discard deduplication. The embedding model is reused during the process. Twitch now handles room/user chat clears with timestamp fences for late messages, proactively validates/refreshes tokens, uses independent socket watchdogs and preserves subscriptions on reconnect handoff. Revocation closes both sockets. These are fixture-tested capabilities, not fresh actual-account/device acceptance.

Private quality notes attach to exact saved revisions, retain assessment history and export the latest assessments separately from publishing. `npm run rehearse -- --minutes 30` (or 45/60) writes private loopback-only resource/queue observations with explicit missing measurements and human acceptance marked NOT TESTED. See docs/local-workflow.md and docs/rehearsal.md. The original human/external release gates remain open; no 40/40 or full milestone acceptance is claimed on implementation alone.

## Evidence and visual review slice — 2026-10-31

Added immutable source-ASR artifacts and original suggestion snapshots, shared exact-range cache keyed by source and verified engine/model fingerprints, atomic automatic draft/provenance/job completion, phase/outcome activity, cancellation propagation and generation fencing. New context policy groups up to three adjacent sentences, prepares up to three distinct-message drafts and proposes whole-sentence context with edge warnings. Newly queued work uses the context policy unless ASSISTANCE_V2=false; legacy jobs retain baseline policy.

The private editor now has bounded waveform generation/cache, timeline handles/zoom/keyboard controls and transcript range selection. Approved public captions support transcript seeking/highlighting. Authored development/frozen comparisons each found 27/36 expected associations for context versus baseline 17/36 development and 18/36 frozen, with zero false associations on these templated cases; existing inspected regression stayed 10 correct suggestions/29 positives, zero false associations. These are not independent human or audio evidence. Sources and original recordings remain private.

The subsequent implementation also adds original-proposal assessment/export, local arrival metadata and allowlisted Twitch fragments, persistent bounded notification deduplication, subscription/handoff/frame fault fixtures, paginated/indexed inbox and latest-revision projections, bounded model-scoped embedding reuse, Linux process-family/local-reader and physical managed-disk samples, approval motion, native SQLite-full recovery, transaction-crash recovery and expanded backup restoration. Final checks and fresh-install evidence are recorded in docs/testing.md. The implementation ledger is docs/next-release-plan.md; human/live/external acceptance remains pending. No submission, release tag, external publish or OBS settings changes were performed.


## Focused review workflow — 2026-10-31

The creator reports that most components have been tested successfully. The particular live-source scenarios/results have not yet been itemized, so the acceptance ledger preserves that report separately from automated fixture evidence.

This pass adds Response/Captions/Evidence & notes panels while keeping source playback visible, keyboard tab navigation, a compact save/approval action bar, queue navigation with dirty-edit protection, and private native caption previews before rendering. Older original messages can be searched/paged directly while correcting an existing draft; unsaved selections refresh removed/unavailable status and saving remains revision-based. Exact approval and external-send/deployment boundaries remain unchanged. Verification is recorded in docs/testing.md.


## Local session recovery — 2026-10-31

Creator capabilities rotate on server restart. Shared client renewal now acquires a session before cold private requests and recovers a rejected GET once, coalescing concurrent renewal. Studio reconnect uses the same path. Failed mutations renew the session but remain explicit retries; approval/publication actions are not replayed. Public reader calls do not bootstrap creator sessions. Missing favicon requests have a real local SVG and legacy redirect. Unmatched HTTP logs add an allowlisted request kind without raw URLs/queries. The reported 404's exact URL was unavailable in the old log, so its original cause is not asserted. Verification is recorded in docs/testing.md.

## Replay experience and recovery — 2026-11-01

Approved replay pages now provide literal-text caption search/highlights, paused caption seeking and shareable positions bounded to the approved derived clip. Whole-replay and moment links use canonical URLs; denied clipboard access offers a selectable field. Playback loading/failure feedback and explicit retries preserve position without autoplay. Visible pages revalidate public availability every fifteen seconds and on focus/visibility recovery. Confirmed withdrawal clears the exchange and stops/discards that managed player's media; transient checks keep loaded approved content with retry guidance. Offline/downloaded copies remain outside recall. No public directory or private transcript endpoint was added. Verification is recorded in docs/testing.md.

## Received-chat connection feedback — 2026-11-01

Missing footage now offers Add recording or Choose recording instead of an inert Connect response button. Disabled buttons use an unavailable cursor; only an actual pending connection shows saving progress beside its message. Inbox refreshes do not block a loaded message's connection. Save failures/timeouts appear inline with a review-queue recovery action; eight-second timeouts report uncertain persistence and never replay a mutation automatically. Acknowledged revisions and their original messages enter local Studio state immediately, fencing older polls before opening the editor. Approval/publication still require separate explicit actions. Fixture verification is recorded in docs/testing.md.

## Transcript selection and caption repair — 2026-11-01

Transcript selection now stages highlighted sentences before explicit application. Preview, replace reply interval/captions, and append captions are distinct actions with adjacent feedback. Editing captions no longer disables source transcript selection/playback. Appending preserves corrections, rejects overlaps/incomplete rows and ignores exact duplicates; applying a range retains individual sentence timings rather than concatenating long evidence into one caption. Full-interval application uses complete sentences within the current reply. Manual caption creation fills an available gap and refuses zero-length rows.

Original source ASR stays immutable. Same-draft/same-recording revisions can recover a prior completed transcript after save/reload when its analyzed range covers the new interval, retaining original provenance. Changing recordings hides incompatible controls. Bounded/coalesced polling and revision fencing prevent delayed results from switching the selected source. Approval/publication remain separate. Fixture evidence is recorded in docs/testing.md.

## Whole-workflow audit — 2026-11-01

Completed a local source/workflow audit covering setup, capture/import/recovery, inbox and original-message selection, editing/captions/evidence/private assessments, approval/export, independent-reader delivery/removal and playback. Confirmed findings and their regression evidence are recorded in docs/audit-2026-11-01.md. Fixes include bounded request handling, honest uncertain-save recovery, preservation of edits across delayed acknowledgements and note saves, exact newly entered source selection, undo for recording changes, persistent reader acknowledgements, caption/media recovery and non-destructive portrait exports. Creator authentication rejects malformed capability byte lengths cleanly. Standalone Chromium checks now rebuild the reader first.

Approval/source/privacy rules remain unchanged. Existing component-test reports are retained separately; this audit did not operate actual OBS/Twitch accounts or complete fresh human, loaded-rehearsal or external-delivery gates. Verification is recorded in docs/testing.md.
