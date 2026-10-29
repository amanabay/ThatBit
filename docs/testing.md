# Validation and acceptance evidence

Environment: Fedora Linux x86_64, Node 24.14.0, npm 11.9.0, FFmpeg 8.1.3, local Chromium. Fixture video: generated VP9/Opus test patterns and sine tones; no synthetic speech or audience presented as real.

`npm run check` runs typecheck, ESLint, architecture negative fixtures, Node unit/integration tests, matching evaluation, production build and Playwright. Browser tests have no credential/camera dependency. The Browser skill was read and JS tool discovery attempted twice; that tool was unavailable. Local QA used standalone Playwright/installed Chromium. Screenshot files record rendered UI, not designed mock screenshots. CI workflow is prepared but has not run remotely.

Performance thresholds declared for subsequent live evaluation: approval after preview ≤4 deliberate actions; known reply found/played unaided ≤30 seconds; first local replay frame ≤3 seconds on the declared connection; 60-minute rehearsal peak RSS <1 GB excluding OBS; source storage ≤5 GB; one render and one ASR at a time. These are provisional acceptance targets, not measured achievements. Record hardware/network and distributions before changing them.

| Scenario | Environment | Source | Observed / evidence | Outstanding action |
|---|---|---|---|---|
| Strict build/lint/import policy | local Node | code + negative fixtures | Gates passed in local check | Remote CI/clean install |
| Draft save/reopen | temp SQLite | generated media | Actual db closed/reopened, same source preserved in tests/media.test.ts | Human recorded source |
| Trim/portrait | actual FFmpeg | generated 4s source | Render [1,3), probe duration, portrait with approved captions | Human A/V sync, VFR and syllable boundary checks |
| Stale edit and approval | SQLite | deterministic revisions | Old versions rejected; edit leaves published title unchanged | Broader interleavings |
| Running-job withdrawal | SQLite + controlled media port | fault fixture | Generation fences completion; removed reply stays removed | SIGKILL at every commit boundary |
| Removal-before-arrival | SQLite | message fixture | Tombstone prevents later resurrection | Real Twitch deletion |
| Failed media save | injected ENOSPC | failure port | No new asset metadata | Real full filesystem |
| Bounded retry / ownership | SQLite | failure fixtures | Three failures become failed; live owner cannot be evicted | Stale PID / refresh crash matrix |
| Creator/public boundary | Fastify inject | HTTP requests | Host/origin/auth/CSRF negatives; unpublished video/captions/portrait unavailable | Independent security review |
| Dev file serving | Chromium requests | forbidden private paths | Added deny rules for .data, .env, server and .git, covered by browser test | Production-host smoke |
| Complete fixture UI | Chromium desktop/390px mobile | generated source | Review/save/approve, video actually plays, captions endpoint, unpublish, keyboard and axe checks | Real user comprehension |
| Matching | deterministic baseline | 8 authored text examples | 3 positives, 5 negatives, 3 suggestions, 0 false positives in this small set | Larger held-out dataset; paraphrase/delay/ambiguity/ASR/noise cases |
| Backup/restore | local files | generated collection | Backup command hashes all source bytes; separate directory restored through same storage; verify-portability.ts smoke | Full restore browser rehearsal |
| Twitch intake/refresh/lifecycle | none | none | Implemented only; NOT VERIFIED LIVE | Register public app, log in, send ordinary message; execute lifecycle smoke |
| Browser capture | none | none | Permission/device UI implemented; NOT VERIFIED LIVE | Choose audio-sharing source, record/replay speech and demonstration |
| Real ASR | none | none | CLI/output schema implemented; NOT VERIFIED | Install whisper.cpp/model and record actual speech |
| Public playback/outbound | separate local reader | approved generated snapshot | Range playback and manifest removal locally verified; NOT VERIFIED EXTERNALLY | Authorize host deployment, verify exact URL, explicit share |
| Usability/resource rehearsal | none | none | NOT TESTED | Newcomer feedback and 60-minute stream |

Screenshots: test-results/studio-desktop.png, studio-mobile.png, viewer-mobile.png (ignored generated artifacts). Actual portrait first frame is `.data/evidence/portrait.png` after the local fixture export smoke. These files are not submission-ready media.

Final local gates observed: eleven Node integration/recovery tests and five Chromium flows passed; typecheck, lint, import rules, eight authored matching cases and production build passed. `scripts/verify-portability.ts` is a local smoke using `/tmp/replylink-verified-backup` and `/tmp/replylink-verified-public`; generate those with backup/export before running. It restores metadata/media relationships, checks reader range access, rejects creator/raw routes, and tests manifest revocation. It is not part of CI.


Second-slice evidence (2026-10-29):

| Scenario | Environment | Source | Observed result / evidence | Outstanding action |
|---|---|---|---|---|
| Acknowledged recording / live snapshot | Actual Chromium MediaRecorder and FFmpeg | Labelled canvas and sine-tone fixture | Save during capture, source video plays, stop/finalize and reload/recover; tests/browser/studio.spec.ts; capture-review.png and capture-recovery.png | Real screen/shared-audio permissions and A/V check |
| Chunk durability/idempotency | Real SQLite/filesystem + FFmpeg | Generated WebM split into bytes | Restart recovers exact acknowledged data; changed retry, skipped sequence and reverse time rejected; source operation reused after simulated linkage interruption | Full OS power-loss matrix |
| Backup with no finalized files | Actual backup CLI + reopened collection | Pending recording chunks | Restored chunk hashes and recovered playable/audio asset; tests/backup.test.ts | Real collection restore rehearsal |
| Transcript job lifecycle | Real SQLite; controlled provider | Explicit provider fixture | Queued/completed results survive reopen; retry bound, stale-revision detection, cancel/restart fencing, invalid output stays private | Real whisper.cpp inference |
| Correct later-media interval | Actual FFmpeg; executable contract fixture | Generated four-second source | Extract [2,3.5), validate 1.5s WAV, translate provider offsets into source seconds; additional job test selects [310,320) | Real delayed-response accuracy |
| Provider cancellation | Actual child process | Sleeping Node subprocess | AbortSignal terminates work with AbortError | Real model interruption/load measurement |
| Persisted transcript review | Chromium + local job runner | Labelled fixture-model-not-real-asr CLI | Poll completion, reopen transcript, apply sentence/captions, save revision; transcript-review.png | Real captions and human review |
| Caption correction input | Chromium | Manually typed lines | Incomplete text preserved; save blocked; multiline typing then save succeeds | Human comprehension feedback |

New capture, transcript/job and source APIs remain under the creator capability guard. No new public source/analysis endpoint was added. Model/fixture output is never routed directly into publication. Live configuration is absent; no real Twitch messages, device recordings, paid calls or external publication were performed.
