# Implementation ledger for the accepted two-stage plan

Local-first, zero paid services. Coding explanations are the hero flow; assistance prepares private drafts and publication requires exact approval.

Implemented in the current slice:
- Separate immutable source ASR artifacts, verified-model cache identities, original suggestion snapshots and atomic draft/provenance/job completion.
- Bounded phase/outcome activity, explicit generation-fenced cancel/retry and private evidence APIs.
- Context-aware grouped evidence (up to three adjacent sentences), multiple distinct-message drafts, contextual intervals. The authored evaluation gates passed; context-aware private drafts are enabled for newly queued work. `ASSISTANCE_V2=false` retains the baseline. Existing queued jobs retain their captured policy.
- Private bounded waveform overview, timeline handles/zoom/keyboard controls, complete-sentence transcript range selection, and approved-only interactive replay transcript.
- Existing-set comparison command `npm run eval:discovery` and an honest demonstration/submission preparation kit.

Authored evaluation evidence:
- Added 60 development and 60 frozen text cases with different topics but overlapping templates, SHA-256 manifests and explicit agent-authored/fixture labels. These are not independent labels or audio evidence.
- With independent cache resets, context policy found 27/36 expected associations on each split, versus baseline 17/36 development and 18/36 frozen, with zero false associations in these cases. Earlier pre-cache development baseline was 18/36; the current batched encoder result is recorded rather than hiding that difference. Existing inspected regression remained 10/29 positive recall, ten correct and zero false associations. Real-world accuracy, boundaries and correction effort remain unverified.
- Commands: `npm run eval:discovery` and `npm run eval:discovery:frozen`; private reports stay in `.data/evaluations` and do not publish or automatically change configuration. The authored-fixture result snapshots in `evals/results/discovery-*.json` include data/model fingerprints and execution settings, with no real messages or recording paths.

Implemented from the one-week stage:
- Original-proposal assessment UI and authenticated export, distinct from corrected-revision notes. Includes original association/boundary/ASR judgments and optional correction time; append-only history and immutable evidence stay private.
- Separate event timestamp, local wall arrival, monotonic arrival and process-session identity; bounded durable envelope ledger and source-ID deduplication; allowlisted emote/mention/cheermote fragments preserve original plain text.
- New fault fixtures exercise subscription throttling, failed handoff fallback, malformed frames, invalid reconnect hosts, duplicate replay and no fabricated messages during gaps, alongside refresh/clear/revocation coverage.
- Linux creator/active-descendant/configured-reader RSS and CPU sampling, allocated managed-disk measurement without following symlinks, explicit missing/partial measurements and sampling limitations.
- Indexed source and latest-revision lookups, cursor-paged authenticated inbox, bounded recent studio projection with referenced original messages, and a model-scoped 1,000-entry embedding cache.
- Real temporary SQLite page-exhaustion recovery, SIGKILL during an uncommitted transaction, and generated-media backup/restore of approvals, private revisions, original evidence and assessments. Credentials remain excluded.
- Restrained message-to-response approval motion with reduced-motion support. Original proposed-range playback remains independent of edited response boundaries.
- Fresh offline CPU-only npm lockfile installation in an isolated source copy; build/demo and first-start smoke are recorded in testing.md when verified.

The remaining work requires external/device/human evidence, rather than another speculative feature layer. Physical host-disk exhaustion and the complete device/network fault space are not claimed from the bounded SQLite fault test. Timing fields do not establish actual broadcast delay or synchronize a real OBS recording. Authored cases share templates and cannot substitute for independent labels.

Human/external gates remain pending: actual OBS/Twitch recording, novice feedback, long rehearsals, public naming, authorized repository/video publication and submission. A release freeze/tag has not been created; do not imply the submission is finished. Continue from this ledger without repeating implemented work.
