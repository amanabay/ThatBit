# ReplyLink ↳

**Every reply has a replay.** A local creator studio for connecting an original Twitch message to the actual recorded response. Working title; not yet a submission-ready release.

## Run

Supported engineering environment: Linux x86_64, Node 24.14+, npm 11, FFmpeg and ffprobe with VP9/Opus, drawtext and subtitles support. Tested here with Fedora's FFmpeg 8.1.3 and Chromium. Node's built-in SQLite currently emits an experimental warning.

```sh
npm ci
cp .env.example .env
npm run demo     # optional: labelled generated media and sample messages
npm run dev
```

Open **http://localhost:4317**. Without demo seed the studio starts empty. Setup → import a finalized recording (WebM, MP4 or MKV), add a manually entered message or connect Twitch, create an exchange, preview and adjust its interval, save the draft, then approve its exact revision. Published replies → open replay. Stop and restart the app to verify draft persistence.

For device capture, choose a screen/tab **with shared audio**. No direct microphone is silently added. Recording chunks are saved and acknowledged during capture, up to one hour / 220 MB per recording. “Save that exchange” protects a complete private snapshot while recording continues. After reload/restart, Sources & setup offers recovery of acknowledged footage; the unacknowledged tail may be missing. Use a finalized OBS recording for longer sessions or when Linux/browser shared audio is unavailable. Device capture and actual broadcast mix are not yet verified in this environment.

## What is implemented

- React creator studio, responsive replay pages, manual message correction, interval trimming, captions and private lead-in playback.
- Durable SQLite revisions and approvals, exact-revision rendering through FFmpeg, separate approved WebM assets, restart recovery and removal fencing.
- Creator capability/authentication, origin/host checks, CSRF guard, private source access, public allowlisted DTOs and gated video range requests.
- Twitch device login, token validation/refresh, EventSub intake/deletion handling, dedupe, reconnect, and explicit outbound reply attempts with uncertain-send protection. **Not live-verified.**
- Durable local transcription jobs with retry/cancel/restart recovery, selected-interval analysis, persisted sentence review, conservative named-message suggestions and abstention. **Requires local executable/model; not ASR-verified.** No paid provider or external AI call is enabled.
- Approved portrait export with original context, full source frame and burned approved captions; backup with source-hash verification; approved-only public bundle and separate hosting reader.

## Checks

```sh
npm run check
npm run media:smoke
npm run eval:matching
```

Browser tests use `/usr/bin/chromium-browser`; override `CHROMIUM_PATH` if needed. CI installs Playwright Chromium. Tests create isolated `.data/e2e` and generated media; they need no Twitch credentials, paid APIs or camera. Screenshots are in `test-results/`.

## Live setup and portability

See [Twitch setup](docs/twitch.md), [media limits](docs/media.md), [deployment](docs/deployment.md), [test evidence](docs/testing.md) and [current status](docs/status.md).

```sh
npm run twitch:login
npm run twitch:smoke     # receive-only, sends nothing
npm run backup -- /tmp/replylink-backup  # stop app first; new destination
npm run export:public -- /tmp/replylink-public  # stop app; build UI first
```

Stop app before maintenance or login; one owner per data directory is enforced. Backups exclude Twitch tokens. To restore, use the backed-up directory as `DATA_DIR`, then log in again. Never expose the creator server or its `.data` directory.

## Release limitations

M0–M6 acceptance is **incomplete**. No real Twitch intake/capture/ASR, external playback, real outbound delivery, 60-minute rehearsal, or novice feedback has been verified. Public hosting is prepared as a manually refreshed snapshot; automatic upload/revocation acknowledgement is unfinished. Keep real Twitch sharing disabled until a deployed reader and link have been independently verified. Local unpublish does not update an already exported snapshot; replace its manifest separately. Continuous chunk capture is bounded to one hour / 220 MB per epoch; automatic rolling retention and unattended epoch rotation remain open. Full fault-injection coverage, richer semantic matching, automatic retention, share-image metadata and final naming remain open. See the detailed [milestone ledger](docs/milestones.md).
