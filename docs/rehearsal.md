# Rehearsal worksheet

The following is a procedure, not completed acceptance evidence. Run a 30–45 minute English coding rehearsal and a separate 60 minute session once the intended OBS window and recorded audio are verified. Public streaming and paid hosting are unnecessary.

Before measuring, retain the existing provisional targets: approval after preview in at most four deliberate actions; an unaided viewer finds/plays a known replay within 30 seconds; first local frame within three seconds; peak ReplyLink RSS below 1 GB excluding OBS; source storage at most 5 GB. Do not revise targets to turn a failed run into a pass.

Start ReplyLink, connect read-only Twitch and verify a fresh received message. Start the intended OBS recording yourself. In a separate terminal run `npm run rehearse -- --minutes 30` (or 45/60). The report samples only the creator process and metadata source quota. Record reader and FFmpeg/Whisper child resources separately for a complete ReplyLink RSS/CPU measurement, and record OBS frame/render/encoding statistics from OBS. Sampling can miss peaks; CPU delta handling skips process-instance changes and observed uptime/counter resets, and does not reconstruct missing intervals.

| Scenario | Fixture/live source | Observation to record | Result / evidence |
| --- | --- | --- | --- |
| Fresh received message and deletion | Actual own-channel message | Original attribution, private inbox, removal truthfulness | Pending |
| Spoken answer across split | Actual microphone/window | Start/end syllables, audio/video sync, full context | Pending |
| Mute and pause/resume | Actual intended OBS inputs | Muting remains authoritative; gaps never silently joined | Pending |
| Save, restart, reopen | Actual private draft | Same source, message, interval, captions | Pending |
| Approve/render/replay/withdraw | Approved local derived media | Only approved content available; removal acknowledged | Pending |
| Reconnect/outage | Local creator/Twitch | Offline display, retained edits, reconnect and gap evidence | Pending |
| Matching and caption review | Real ASR plus creator decisions | False associations, abstentions, corrected boundaries, time/actions | Pending |
| Resource report | `rehearse` JSONL/summary | Creator samples plus separately measured reader/subprocess/OBS stats | Pending |
| Creator/viewer usability | One unaided creator and one viewer | Actions/time, confusion, feedback, fixes | Pending |

Keep recording paths, credentials and speech out of shared logs. Local private review exports deliberately contain the reviewed message and captions; use aggregate counts when sharing findings. No external playback, social unfurling or real Twitch-send gate is completed by a localhost rehearsal. Those require separately authorized deployment/delivery.
