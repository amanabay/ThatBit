# Validation and acceptance evidence

Environment: Fedora Linux x86_64, Ryzen 7 8845HS (8 cores / 16 threads), Node 24.14.0, npm 11, FFmpeg 8.1.3, installed Chromium. Generated VP9/Opus patterns and tones are labelled fixtures. No synthetic audience or prerecorded speech is represented as live participation.

`npm run check` includes strict typecheck, ESLint, import-policy negative fixtures, Node unit/integration tests, eight authored baseline matching cases, production build and Chromium flows. Tests use real SQLite, filesystem, FFmpeg and browser MediaRecorder. OBS is a protocol fixture; browser audio/video is a generated canvas/tone. Provider-contract fixtures are explicitly labelled and isolated from real configuration. CI installs software dependencies but needs no credentials, camera, paid API or model download. Remote CI has not been run.

## Automated ledger

| Scenario | Environment/source | Observed evidence | Outstanding acceptance |
|---|---|---|---|
| Save/reopen, immutable edits and exact approval | Real SQLite/files + generated media | Restart retains sources; stale revisions rejected; edited draft does not mutate published reply | Actual human source |
| Trim, captions and portrait | Actual FFmpeg | Output duration matches interval; portrait preserves approved full frame | Human sync, syllables, VFR, subtitle review |
| Browser capture/recovery | Actual Chromium MediaRecorder, generated canvas/tone | Acknowledged chunks, live snapshot, playable source and reload recovery | Real device permissions/shared audio |
| Capture durability | Real SQLite/files/FFmpeg | Changed retry, sequence gap and backward times rejected; restored backup recovers pending chunks | OS power-loss matrix |
| Analysis jobs | Real SQLite, controlled provider | Interval-specific results persisted; bounded retry/cancel/restart fencing; invalid output remains private | Creator speech/load |
| Provider extraction/cancel | Real subprocesses, labelled CLI fixture | Correct selected WAV interval; offset conversion; subprocess cancellation | Real model interruption during OBS |
| Caption review | Chromium | Persisted sentences applied only through saved revisions; incomplete typed text blocks save | Human editing effort |
| Access boundary | Fastify + Chromium | Host/origin/capability/CSRF negatives, no raw/private/unapproved routes; development private-file denial | Independent review |
| Independent reader | Real FFmpeg output, HTTP, separate SQLite/files | Authenticated staging, wrong checksum rejection, range playback, captions, restart availability, 410 removal, persistent tombstones, stale generation rejection and file cleanup | Separate-network playback after deployment authorization |
| Publisher race | Deferred upload fixture + real creator store | Removal during upload queues next-generation withdrawal; restart repeats same withdrawal safely | Network disconnect/crash matrix |
| OBS protocol/track | Authenticated WebSocket fixture + actual two-tone media | Null start outputPath matches official protocol; closed-file normalization preserves original bytes; selected track checked from decoded tone | Actual OBS split/mute/pause/device sync |
| OBS assembly/retention | Actual distinct-color media + SQLite | Output contains decoded frames from both segments; retry reuses source; assembly pins inputs; gap/order changes reject; independent snapshot survives input expiry | Actual spoken answer across a split |
| Private suggestions | Provider/matcher fixtures | Only private drafts created; validated message IDs/source excerpts; referenced source survives retention | Independent matching quality |
| Removal/faults | Controlled render/media failures | Source tombstones, stale worker fencing, ENOSPC save failure and bounded retries | Full disk/device loss/SIGKILL windows |
| Mobile/accessibility | Chromium 390px + axe/keyboard | No horizontal overflow, focus/dialog behavior and replay playback | Novice comprehension |

Final integrated `npm run check` passed: 18 Node tests, six Chromium flows, strict typecheck/lint, import boundaries, eight baseline matching cases and production build. An intermediate run failed when a new client response schema was edited while the already-running server still used the old schema. The check is rerun with a fresh server and stable sources; that failed run is not counted as acceptance.

Screenshots are ignored generated artifacts under `test-results/`: studio-desktop.png, studio-mobile.png, viewer-mobile.png, capture-review.png, capture-recovery.png, transcript-review.png and obs-review.png. These are actual rendered UI, not designed screenshots. The in-app Browser skill was consulted; its JS tool was unavailable, so standalone Playwright/installed Chromium provided QA.

## Actual local models

`npm run ai:setup` completed CPU-only. It pins whisper.cpp v1.9.5/source commit, resolves immutable Hugging Face model revisions, verifies Whisper LFS SHA-256/size and records semantic model hashes. A partial upstream model download was caught by an actual CLI load failure; setup now rejects incomplete models and promotes verified downloads atomically. Ignored `.data/models/runtime.env` provides missing AI settings without overwriting explicit configuration. Dependency installation audit reported zero vulnerabilities.

Actual Whisper base.en transcribed the bundled 11-second prerecorded JFK sample in about 5.2 seconds using the real CLI/model. Artifact: `.data/evidence/whisper-smoke.json`. This proves local inference, not creator speech accuracy, live timing, Twitch synchronization or audience acceptance.

`npm run eval:semantic` exercises the actual local quantized MiniLM model with two intra-op threads and one inter-op thread. Twelve tuning cases and sixty separately authored cases cover direct names, paraphrase, humor/visual descriptions, delayed-question text, ambiguity, unrelated speech, ASR-like text noise, instruction-like messages and no-answer cases. Delay and noise are text scenarios, not actual measured broadcast delay/ASR audio.

Initial frozen embedding thresholds (cosine .7 / margin .12) produced 11 suggestions on 60 cases: 6 correct, 5 false associations, 49 abstentions, 6/29 positive recall. Most errors were explicit deferrals. Preserved report: [baseline](../evals/results/semantic-baseline-held-out.json).

After inspecting the failures, added explicit deferral/missing-speech abstention and conservative named-message evidence. Regression rerun: 10 suggestions, 10 correct, 0 false associations, 50 abstentions; coverage 10/60 (16.7%), recall 10/29 (34.5%). Tuning: 4/6 positives suggested, 0 false associations. [Current report](../evals/results/semantic-held-out.json) includes per-case results, model revision/hashes and dataset SHA. **The rerun is on inspected examples, not an untouched holdout or independent human labels.** No live accuracy/confidence claim is supported; many useful paraphrases/visual responses remain missed. Boundary quality and correction effort are unmeasured. Candidates stay private.

## Container and external acceptance

Docker builds software locally and does not deploy. `docker build -f deploy/Dockerfile.reader -t replylink-reader:local .` built the current source successfully. `node --import tsx scripts/container-smoke.ts` passed authenticated publication, actual range/caption access, private-route rejection, availability after restart and persistent removal after a second restart. The smoke creates a temporary loopback-only container/volume, publishes generated approved media, verifies range/captions/private-route rejection, restarts twice and verifies availability/removal persistence, then removes its own resources. Render has not been provisioned or contacted for deployment; no credit was used.

## Human/live procedure still required

1. Configure Twitch locally, device-login and run receive-only smoke; verify a real original message and deletion. Do not send a real reply merely as a test.
2. Configure OBS recorded track; start ReplyLink before recording and wait for closed footage. Speak/demonstrate, mute, pause/resume and split. Verify selected mix, beginning/ending, visual sync and a saved cross-segment answer after restart. The warm-up file remains in OBS originals.
3. Rehearse an English coding explanation for 30–45 minutes, then a 60-minute session. Record CPU/RSS, queue depth, disk, cleanup, gap and OBS encoding statistics. Targets declared before measurement: approval after preview at most four deliberate actions; newcomer finds/plays a known reply unaided within 30 seconds; first local frame within three seconds; peak ReplyLink RSS below 1 GB excluding OBS; source storage at most 5 GB. These are targets, not achievements.
4. Obtain one creator and one viewer’s unaided feedback, including an ambiguous-message correction and humorous/visual exchange. Record correction effort and failures.
5. Only after separate deployment authorization, verify an external reader from another network, then explicitly share one approved link using Twitch and verify its actual result. Render hook activation is not proof of deployment or playback.

Live Twitch intake/deletion/outbound, real OBS device capture, external playback, real-time provider accuracy, long rehearsals and human usability remain unverified. Final naming, social previews, submission media and eligibility verification remain open. No numerical hackathon score is guaranteed.

Container/recovery findings: reviewed the PID-based owner guard during restart testing and replaced it with an OS-backed SQLite exclusive owner lock. Cross-process exclusion and recovery after SIGKILL passed. Backup now tolerates collections without the legacy owner table. The smoke harness originally kept an obsolete ephemeral host port after restart; it now queries Docker after each restart. Final smoke passed and removed its own temporary container/volume. The prepared Render workflow was syntax-parsed, not executed.
