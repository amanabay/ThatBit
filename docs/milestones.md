# Milestone acceptance ledger — 2026-10-30

No M0–M6 milestone is labelled fully accepted without its human/live evidence. The implementation is a substantial local vertical slice, not completion of the entire kickoff.

| Milestone | Implemented / observed | Remaining acceptance or engineering |
|---|---|---|
| M0 | Empty workspace/toolchain checked; strict project, design, generated media experiment, architecture | Real device/audio experiment and supported broadcast capture acceptance |
| M1 | Actual file ingestion, acknowledged chunk capture/recovery, live exchange snapshots, explicit epochs, durable revisions and local replay; Twitch adapter | Real Twitch + human recording acceptance; browser automatic epoch rotation and broadcast-time calibration; actual OBS split/track/pause acceptance |
| M2 | Durable cancellable/recoverable interval-specific transcription jobs, immutable provenance, persisted sentence review, conservative suggestions and authored evaluation | Local models and prerecorded speech smoke passed; authored tuning/evaluation expanded. Independent labels, actual creator ASR/latency, improved coverage and automatic cross-segment suggestions remain |
| M3 | Approved-media local publication, mobile replay, explicit Twitch-send adapter, removal fencing, reader/bundle preparation | Managed reader upload/removal acknowledgment is implemented/tested locally; authorization and deployment; separate-network playback and real outbound acceptance |
| M4 | Purple glass themes, structured timed captions/full-transcript application, approved reader PNG/Open Graph previews, responsive review/replay, keyboard/focus/reduced-motion CSS, actual portrait output | External social unfurling, approval animation; human visual/caption review of a real source |
| M5 | Ownership lock, bounded render/ASR queues, pending-chunk backups, source deletion tombstones, worker/recording recovery tests and sanitized correlated CLI/rotating-file diagnostics | Crash-window matrix, token/EventSub fixture lifecycle suite, actual disk-full/device-loss, live retention/rehearsal, clean-install and novice feedback |
| M6 | README, media/Twitch/deployment guides, honest solo demo outline and Codex record | Final public name, live rehearsal/video, submission assets/session ID, eligibility and release readiness review; submission needs authorization |

Current constraints are in docs/status.md. Do not turn this ledger into fabricated live results.

Latest local slice adds OBS rolling retention and contiguous multi-segment snapshots, real local model setup/inference, managed reader synchronization and manual Render preparation. These implementations do not close the real/user acceptance gates. Matching regression findings and limitations are recorded in testing.md.
