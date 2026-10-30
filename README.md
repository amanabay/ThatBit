# ReplyLink ↳

**Every reply has a replay.** A local creator studio connecting an original Twitch message to the creator’s actual recorded response. Working title; release acceptance remains incomplete.

## Run locally

Linux x86_64, Node 24.14+, npm, FFmpeg/ffprobe with VP9/Opus, drawtext and subtitles support are required. Tested with Fedora FFmpeg 8.1.3 and Chromium. Node SQLite emits an experimental warning.

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci
cp .env.example .env    # first setup only; preserve existing configuration
npm run demo           # optional labelled generated media/messages
npm run build
npm run dev:local
```

Open **http://localhost:4317**. The independent reader is **http://localhost:4320**. Both roles run on loopback with separate stores; the launcher supplies a temporary writer capability. No hosting account, DigitalOcean droplet, Render credit or paid AI is required.

The reader root shows a replay landing page. Use **Open reader replay** after publishing to open a specific `/r/...` link. Creator setup, Twitch connection and editing live at port 4317.

Import a finalized recording or choose screen/tab capture with shared audio; add a message or connect Twitch. Create an exchange, preview/correct its source and interval, save, and approve the exact revision. After rendering, **Publish to reader** transfers only the approved derived video and metadata. **Open reader replay** plays the independent copy. Unpublish queues withdrawal and tracks reader acknowledgement separately. `npm run dev` runs only the creator if a reader is unnecessary.

**Received chat** now provides searchable original messages with source labels and explicit recording selection. **Capture readiness** separates OBS from browser capture, with a read-only audio/routing check. Offline status preserves editor text, and the approved library keeps immutable titles and versions. See [the local workflow guide](docs/local-workflow.md).

The studio and replay pages use a deep purple glass interface. Dark mode is the default; the sun/moon button at the top right switches themes and remembers your choice.

After approval, the editor shows queued/rendering/ready/failed state for that exact revision. A completed replay has **Open rendered replay**; background completion also shows a dismissible notice. Failed renders can retry the same approved revision. Rendering locally, publishing to the reader and sending into Twitch remain separate actions.

Application activity and failures appear in the CLI for both creator and reader. Use `LOG_LEVEL=debug npm run dev:local` for successful requests too. Rotating private JSON logs are saved under `.data/logs/` and `.data/reader/logs/`. See [logging and troubleshooting](docs/logging.md) for levels, request/job IDs and file limits.

For captions, save the reply interval, transcribe it locally, then choose **Use full transcript as captions**. This keeps the whole interval. Edit each caption’s words and start/end times, listen with **Play from caption**, and save privately again before approving. Moving the reply start preserves caption timing against the recording; captions cut by the new interval must be corrected or removed before saving. The advanced text editor remains available.

After **Publish to reader** completes, **Open share preview** shows a purple 1200 × 630 PNG containing the approved message and a frame of the approved replay. The reader serves Open Graph metadata for the replay link. Preview access is withdrawn with the reply. Local links can be inspected here; external social unfurling still needs an authorized public reader.

## OBS and local AI

For window capture problems, see the [Fedora OBS walkthrough](docs/obs-troubleshooting.md). `npm run obs:doctor` checks local OBS status/source types without recording or changing settings. The browser capture button is separate from OBS recording ingestion.

Enable authenticated OBS WebSocket on loopback and use a split-capable MKV recording profile. Set `OBS_RECORD_DIR`, `OBS_PASSWORD` and `OBS_AUDIO_TRACK` (1-based audio stream position in the file, 1–6) in local `.env`. Start ReplyLink before recording. The selected recorded track must contain the intended mix; no extra microphone is added. Check the intended source's meter and mute in OBS; `npm run obs:doctor` reports anonymous mute/gain/routing. See [missing audio and captions](docs/obs-troubleshooting.md#if-video-saved-but-transcriptioncaptions-are-empty) if the saved clip is silent.

OBS splits every 30 seconds. Its first file cannot be identified through the start event: the initial segment remains in the original recording, and usable closed footage arrives after the following split (normally about 60 seconds). Wait for saved segments. **Save OBS exchange** preserves up to 150 seconds of recent contiguous closed footage in an independent source; review its full beginning/ending and original message. Pauses, reconnects and missed segments stop joining. Longer or incomplete answers need the original recording. Originals are never deleted. Unreferenced managed segments expire after 15 minutes; revisions and active work pin their sources.

```sh
npm run ai:setup        # Git, CMake, C++ compiler; downloads/builds local models
npm run eval:semantic   # real local inference; inspect evals/results
```

Setup pins whisper.cpp and verifies model checksums. Ignored `.data/models/runtime.env` supplies missing AI settings; explicit environment/.env values win. Whisper uses two CPU threads. Quantized MiniLM also uses bounded CPU inference. Audio/text stay on this machine during inference. OBS analysis can join up to three contiguous closed segments for a private suggestion, with pinned inputs, durable prepared sources, gap guards and overlap deduplication. It cannot approve, publish or send chat. Manual interval transcription, sentence/caption correction and source selection remain available.

The real local Whisper model transcribed a bundled prerecorded sample. Matching regression results are **10 correct suggestions, 0 false associations, 50 abstentions across 60 authored cases** (29 positives). These examples were inspected during development, so this is not independent quality validation. Coverage remains limited. See [evidence](docs/testing.md).

## Capture, portability and checks

Browser capture durably acknowledges chunks, saves private snapshots during recording, and recovers acknowledged footage after reload/restart. Each epoch permits one hour / 220 MB. Shared audio depends on browser/device support; verify sound and synchronization yourself. File import permits 250 MB / one hour. Approved intervals are limited to 180 seconds.

```sh
npm run check
npm run twitch:login
npm run twitch:smoke    # receive-only
npm run rehearse -- --minutes 30  # resource observation; does not start recording
npm run backup -- /tmp/replylink-backup
npm run export:public -- /tmp/replylink-public
```

Stop the app before backup/export/login. Backups verify source and pending-chunk hashes and exclude Twitch credentials. Static public exports require manual manifest replacement for removal; use the managed reader for acknowledged synchronization. Chromium tests need no credentials/camera/model downloads; override `CHROMIUM_PATH` when needed.

[Deployment](docs/deployment.md) includes optional local Docker and a future manual Render pipeline. It has not deployed anything. [Media](docs/media.md), [Twitch setup](docs/twitch.md), [testing](docs/testing.md) and [current status](docs/status.md) describe operation and remaining acceptance.

## Remaining release work

Real Twitch intake/deletion/delivery, real OBS mute/pause/synchronization, the 30–45 and 60 minute rehearsals, novice creator/viewer feedback and independent matching labels remain pending. Automatic candidates now analyze bounded contiguous windows; actual cross-split speech acceptance remains pending. Private quality notes and an authenticated review export support collecting creator evidence without claiming independent accuracy. Broader crash/load tests, external social unfurling, human caption review, final naming and submission assets remain open. No numerical judging score is promised. No public deployment, external recording publication or actual outbound chat has been performed.
