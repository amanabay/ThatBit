# Current status — 2026-10-29

Working local studio: durable chunk capture with interrupted-recording recovery, “Save that exchange” during recording, file ingest, original-message correction, source playback/lead-in, trimming, immutable drafts, authenticated exact-revision approval, FFmpeg local replay/captions, removal fencing and portrait export. Transcription now uses a durable queue, selected media interval, bounded retries, cancellation and revision-bound persisted results. This is not a completed M0–M6 release.

Run `npm ci`, optionally `npm run demo`, then `npm run dev`; open http://localhost:4317. Main verification is `npm run check`. Generated files and credentials are ignored. App is local only.

The second implementation slice adds:
- WebM chunks are written/flushed, hashed and durably acknowledged during capture. A changed retry, sequence gap or backward time marker is rejected. Each capture is a separate epoch; no joining across device/restart gaps.
- Browser upload queue is bounded. One epoch supports up to one hour / 220 MB. Sources & setup can recover the acknowledged prefix after reload/restart. Unacknowledged tails are explicitly unavailable.
- A private exchange snapshot retains the entire acknowledged recording, preserving context and the beginning of a long answer. Source choice and boundaries still need review. Snapshot operations reuse their finalized source after retry; unfinished-chunk cleanup cannot delete saved media.
- Transcription targets exactly the saved revision's interval, including responses later than minute three. Jobs and transcripts survive restart; late/cancelled results are fenced. Corrections create a new draft revision. Caption input preserves incomplete edits and blocks saving them silently.
- Backup now includes and verifies pending capture chunks as well as finalized source media.

Evidence: real Chromium MediaRecorder with a **labelled generated canvas/tone**, actual FFmpeg remux/trim and SQLite restart tests, plus provider-contract fixtures. These are not real device capture or real speech-recognition evidence. Local Twitch and Whisper configuration is currently absent (checked without printing secrets).

Immediate manual prerequisites:
1. Set Twitch public app ID/channel in local .env; stop app, `npm run twitch:login`, restart. Send an ordinary real message and run `npm run twitch:smoke` (receive only).
2. Choose shared-audio capture or import a finalized OBS recording. Record spoken/visual content; listen and verify synchronization. Save an exchange during recording, stop, restart and reopen.
3. Install whisper.cpp executable/model; set WHISPER_BIN and WHISPER_MODEL locally. Analyze a saved interval and validate real output/latency. No paid calls are configured.
4. Review prepared hosting topology. Public deployment and recording publication need explicit authorization. External playback and outbound delivery remain unverified.

Engineering still open: automatic rolling retention/epoch rotation for sessions beyond the declared limits, media-to-live-chat clock calibration, broader Twitch lifecycle regression coverage, richer matching evaluation, automatic remote publication/revocation acknowledgment, full crash/load rehearsal, social previews, final naming and submission assets. Explicit capture time anchors are recorded; they are not proof of broadcast delay or A/V synchronization.

Security: public DTOs/derived files are separate from source/chunk/job data. Development file serving denies private directories. Local unpublish cannot revoke an already exported snapshot; hosted manifest replacement is still explicit. Do not enable real sharing before hosted revocation is rehearsed.

Git metadata is readable and an initialized repository is present, but `git add -A` still fails creating `.git/index.lock` because the mount is read-only. No commit/hash exists. Source and lockfile are saved; reopen with writable Git metadata to commit. No remote or push is authorized.

Next owner should read AGENTS.md and replylink-kickoff.md, then continue from this ledger without treating fixtures as live evidence.
