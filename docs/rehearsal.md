# Rehearsal worksheet

The following is a procedure, not completed acceptance evidence. Run a 30–45 minute English coding rehearsal and a separate 60 minute session once the intended OBS window and recorded audio are verified. Public streaming and paid hosting are unnecessary.

Before measuring, retain the existing provisional targets: approval after preview in at most four deliberate actions; an unaided viewer finds/plays a known replay within 30 seconds; first local frame within three seconds; peak ReplyLink RSS below 1 GB excluding OBS; source storage at most 5 GB. Do not revise targets to turn a failed run into a pass.

Start ReplyLink, connect read-only Twitch and verify a fresh received message. Start the intended OBS recording yourself. In a separate terminal run `npm run rehearse -- --minutes 30` (or 45/60). Start with `npm run dev:local` so the launcher supplies the local reader process identity. On Linux the report samples creator, active descendant and configured local reader RSS/CPU, plus physical allocated bytes under the managed data roots (including nested reader/model files). Symbolic links are not followed and hardlinks are counted once. Scans are bounded and cached for five seconds; incomplete scans or a missing reader remain explicit and prevent a complete measurement outcome. Source quota bytes remain separate from total allocated disk. OBS frame/render/encoding statistics still come from OBS. Sampling can miss peaks and short-lived subprocesses; RSS sums include shared pages, and CPU compares surviving process identities without reconstructing missing/exited work. These observations are not a whole-system profiler or human acceptance.

| Scenario | Fixture/live source | Observation to record | Result / evidence |
| --- | --- | --- | --- |
| Fresh received message and deletion | Actual own-channel message | Original attribution, private inbox, removal truthfulness | Pending |
| Spoken answer across split | Actual microphone/window | Start/end syllables, audio/video sync, full context | Pending |
| Mute and pause/resume | Actual intended OBS inputs | Muting remains authoritative; gaps never silently joined | Pending |
| Save, restart, reopen | Actual private draft | Same source, message, interval, captions | Pending |
| Approve/render/replay/withdraw | Approved local derived media | Only approved content available; removal acknowledged | Pending |
| Reconnect/outage | Local creator/Twitch | Offline display, retained edits, reconnect and gap evidence | Pending |
| Matching and caption review | Real ASR plus creator decisions | False associations, abstentions, corrected boundaries, time/actions | Pending |
| Resource report | `rehearse` JSONL/summary | Creator/reader/active subprocess and managed-disk samples; separately recorded OBS stats | Pending |
| Creator/viewer usability | One unaided creator and one viewer | Actions/time, confusion, feedback, fixes | Pending |

Keep recording paths, credentials and speech out of shared logs. Local private review exports deliberately contain the reviewed message and captions; use aggregate counts when sharing findings. No external playback, social unfurling or real Twitch-send gate is completed by a localhost rehearsal. Those require separately authorized deployment/delivery.

Assess the untouched automatic proposal in **Why this connection? → Assess the original suggestion** before correcting it. Save corrected-revision quality notes separately. Setup provides separate private exports for both datasets; neither is an independent benchmark. Do not backfill unknown local arrival timestamps for historic messages.
