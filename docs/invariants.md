# Invariant and canonical-flow audit — 2026-10-29

| Kickoff invariant | Implemented guarantee / evidence | Limits |
|---|---|---|
| 1 Original sources authoritative | Immutable message identity/text and retained hashed media | Real source intake not yet accepted |
| 2 Assistance cannot fabricate sources | Matcher references supplied message IDs and timestamped segments; no publication capability | ASR can be inaccurate; creator must verify |
| 3 Exact authenticated approval | Capability-protected approval with expected version; publication stores immutable revision ID | Local creator identity is possession of local capability; not cloud identity |
| 4 Uncertainty private | Abstention; creator review required | Baseline misses many paraphrases/delayed replies |
| 5 Ordinary chat | EventSub channel.chat.message without commands | Not live verified |
| 6 Manual fallback | Add manual source, import file, select message/interval without Twitch/AI | Manual entry is labelled; no proof it came from Twitch |
| 7 Saved draft durable | Media finalize/flush/probe/rename before SQLite commit; source retained | Acknowledged chunks now durable during recording; unacknowledged tail unavailable; power-loss matrix incomplete |
| 8 Approved interval only | Re-encoded separate derived file; contained captions; portrait from derived media | Human A/V/VFR boundary checks pending |
| 9 Editing immutable publication | New revision; original publication unchanged in integration test | No in-place replacement workflow |
| 10 Publish/send/playback separate | Job state, delivery attempts and actual browser playback evidence separate | Remote snapshot acknowledgment incomplete |
| 11 Recovery preserves approval | Stable revision job, startup recover, generation fencing | ASR queue recovery/cancellation now implemented and fixture-tested |
| 12 Unavailability honest | Missing file/error states, uncertain send, Twitch gap status | Full source-health dashboard and live faults pending |
| 13 Public/private projection | Allowlisted reply DTO, approved media gates, source auth, development filesystem deny policy, separate reader | Independent penetration testing pending |
| 14 No attention ranking | Review queue only, no unanswered public scoreboard | No expanded discovery features |

Canonical scenario audit: clean configuration documented; real Twitch message and human response pending; fixture association/trim/restart/approval/render passed; local Chromium playback with context/captions passed; second-device external playback pending authorization/deployment; real outbound reply pending explicit creator share; generated portrait inspected; local unpublish and stale-job fencing passed. Separate hosted snapshot removal is implemented as manifest replacement, not automatic local unpublish. This gap prevents declaring the canonical external scenario accepted.

No invariant audit claims that incomplete release work is complete. Essential next work is recorded in milestones.md, including internal engineering that does not depend on credentials.
