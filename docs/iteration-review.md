# Iteration assessment — 2026-10-30

Internal assessment against the kickoff's four equally weighted dimensions: **28/40**. This is a judgement of the current local prototype and its evidence, not a prediction of hackathon judging or a promise of placement. Deployment spending is not required to improve the local product.

| Dimension | Score | Evidence and limit |
| --- | ---: | --- |
| Innovation | 7/10 | Preserving the original personal exchange and returning an approved replay is compelling. Transcription, clipping and matching alone are established ideas; the complete experience still needs a real demonstration. |
| Potential impact | 6/10 | Clear missed-response/chat-context problem. No independent creator/viewer feedback or measured time saved yet; message selection and capture setup still cause friction. |
| Technical implementation / Codex | 8/10 | Actual SQLite/FFmpeg, immutable approvals, removal fencing, local inference, durable jobs/capture, independent reader and regression checks. Device/rehearsal/crash-window acceptance and matching coverage remain incomplete. |
| Design | 7/10 | Bespoke purple themes, responsive replay, timed captions and now visible render completion. Chat is hidden in a selector, capture paths are easy to confuse, and the full workflow has not been tested unaided. |

## Highest-impact next work

| Priority | Work | Acceptance evidence |
| --- | --- | --- |
| P0 | Complete the real local capture → review → render → replay loop | Intended window and audio mix, audible/synchronized spoken answer crossing an OBS split, durable draft after restart, approved-only playback, and acknowledged removal. No stream or public host is needed. |
| P1 | Dedicated received-chat inbox | Clearly separate received/manual/fixture sources; search/select an original message with timestamps; deletion state stays truthful; selection starts a draft without hunting through a dropdown. |
| P1 | Complete capture readiness and connection feedback | Separate browser capture from OBS; explain stopped/paused/warming-up/closed segments; show stale/offline polling instead of retaining an apparently fresh status. Read-only doctor is implemented, but cannot verify image/audio content. |
| P1 | Preserve approved metadata in the library | Editing a draft currently leaves older published cards with the generic “Published revision” title. Retain the exact approved title/version in the creator's read model without using newer draft content. |
| P1 | Improve useful matching coverage | Collect new independent labels and actual creator ASR examples; measure correction effort and boundary quality. Current inspected-set recall is 10/29 positives; do not claim independent accuracy. Automatic candidates still analyze one segment. |
| P2 | Rehearsal, failures and novice use | Run the defined 30–45 and 60 minute sessions with resource/disk/queue measurements; extend interruption, token/reconnect and disk-failure coverage; observe one creator and one viewer unaided. |
| P2 | Finish release presentation | Resolve public name, rehearse an honest solo demo, record actual Codex/session evidence and prepare submission assets. Verify official eligibility before scheduling/submitting. |

## Milestone audit

No M0–M6 milestone is fully accepted against the original kickoff's complete evidence requirements. Much of the implementation exists; that is different from accepting the entire milestone.

- **M0/M1:** local capture and durable manual workflow exist. Actual intended-window/audio, split/pause synchronization, fresh Twitch intake/deletion and calibration acceptance remain open.
- **M2:** local Whisper works and revision-bound review exists. Independent matching quality, coverage, boundaries and live correction effort remain open.
- **M3:** independent local reader publishing/removal is implemented and tested. Public deployment, separate-network playback and actual Twitch delivery are deliberately deferred under the local-only constraint and require later authorization.
- **M4:** themes, captions, preview images and portrait output exist; render completion is now visible. Human review of actual footage/captions/export and broader unaided workflow polish remain open.
- **M5:** substantial bounded work, recovery, logging and fixture coverage exist. Full fault matrix, long rehearsals, clean-install and usability acceptance remain open.
- **M6:** documentation and release preparation exist. Final name, live demo/rehearsal, submission material, eligibility verification and release audit remain open.

M7 expansion should wait. The next gains come from proving the core workflow and making its states discoverable, rather than adding unrelated features.
