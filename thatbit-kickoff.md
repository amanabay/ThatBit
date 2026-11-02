# ThatBit — complete product kickoff brief

> Portable instructions for a new Codex session opened in an empty project directory.
> Prepared October 29, 2026. The creator selected ThatBit as the product name on November 2, 2026.
> This document specifies work to do; it is not evidence that the product exists.

You are my lead product engineer, software architect and interaction designer.

Build an exceptional Twitch product with me. Take ownership of the complete experience: reliable capture, useful intelligence, effortless review, beautiful playback, safe sharing, recovery, testing and a compelling demonstration. Work ambitiously and carry the implementation through the milestones below. A scaffold, attractive mockup, mocked integration or manually selected happy path is an intermediate checkpoint, not the finished product.

Read this entire brief before starting. Inspect the environment, resolve consequential unknowns with small experiments, document decisions and implement. Use checkpoints to communicate evidence and course corrections. Continue through authorized milestones without repeatedly asking whether to continue. Stop when I explicitly request a review, when a consequential decision genuinely needs my input, or when an external prerequisite blocks dependent work. Complete independent work while a prerequisite is pending.

Keep the implementation understandable by one developer. Ambition belongs in the quality and completeness of the experience. Every architectural abstraction must solve a concrete problem in this product.

## 1. Product promise

ThatBit connects a viewer's original Twitch chat message to the streamer's actual recorded response, turning a fleeting exchange into a conversation people can replay and share.

The complete loop is:

1. A viewer writes an ordinary chat message.
2. The streamer responds naturally through speech, demonstration or reaction.
3. ThatBit privately suggests the message and recorded response that belong together.
4. The creator previews the exchange and corrects anything necessary.
5. The creator approves a specific version for publication.
6. The viewer opens a replay containing the original message and actual response.
7. The creator can share the replay into the original Twitch conversation.

The emotional payoff is: **“That was my message. This was their response. I can keep this exchange.”**

A working tagline is **“Every reply has a replay.”**

Illustrative exchange:

> Mira: “How did you make the water look transparent?”
>
> Aman: a playable recording of the actual explanation, with captions, original message, attribution and a share link.

Support useful explanations, visual demonstrations, jokes, suggestions and congratulations. The product is about interactions between people, including exchanges that are not questions.

Start with one creator and one Twitch channel. Conversational art, coding, educational and Just Chatting streams are the initial audience hypothesis. Preserve a path to richer use without building speculative multi-tenant infrastructure.

## 2. Research, originality and hackathon context

Forum research identified several qualitative signals:

- Recordings can preserve only the streamer's half of a conversation.
- Viewers sometimes miss a response while away or distracted.
- Permanent chat overlays can obscure the content.
- Finding worthwhile exchanges in long recordings takes effort.
- Creators already have substantial cognitive load while streaming.

These are problem signals, not established market size, demand or willingness to pay. Validate the proposed workflow with real use.

Searchable VOD transcripts, chat-triggered clips, chat highlighting and automatic highlights already exist. Research also extracts livestream query-response relationships. Do not claim that transcription, clipping or chat-to-speech association is a new invention. Our distinction must be the complete, trustworthy experience of preserving and returning a personal exchange.

The creator selected **ThatBit** on November 2, 2026. Use that name across the product, documentation and submission. This name selection is not evidence of trademark, domain or handle availability.

We are targeting the Codex x TwitchCon Hackathon. At the time of planning, the listed submission deadline was November 2, 2026 at 2 PM Pacific. Verify the current official dates and requirements before scheduling or submitting. If the deadline has passed, state that and continue building a useful product without pretending eligibility.

The judging dimensions are innovation, potential impact, technical implementation/use of Codex, and design. Build evidence for each. Do not promise a numerical score or placement.

The demonstration must work with one person. I can send a real message from my own account and respond aloud. Clearly disclose that this is a solo demonstration. Never present synthetic viewers, fixture messages or prerecorded sample responses as live audience participation.

## 3. Scope and authorization

You are authorized to initialize this project, install justified development dependencies, write specifications and implementation, run local services and tests, prepare deployment assets, and make local Git commits.

Implement the complete single-creator product across M0–M6. M7 describes expansion after the core product is accepted. Do not silently substitute M7 work for unfinished essentials.

There is no automatic stop after scaffolding or the manual prototype. Report each milestone's evidence and keep making progress within the authorized scope.

Separate implementation from external actions:

- Build publishing and Twitch-sharing capabilities, including fixtures and local tests.
- Do not purchase services, create billable infrastructure, expose a local server publicly, deploy publicly, or publish actual recordings without explicit authorization for that external action.
- Obtain provider credentials through supported local configuration. Never ask me to paste secrets into chat.
- Before activating paid transcription or matching, establish the provider, what data leaves the machine and a bounded usage budget. Do not infer spending authorization from this product brief.
- Do not send real Twitch messages as an implementation test without authorization. The finished app's explicit creator share action should authorize that particular message.
- Permission for a reversible local engineering task does not need to be requested repeatedly.

When a prerequisite is missing, complete the implementation, fixtures, documentation and reviewable configuration that do not depend on it. Report the precise remaining action. Do not fake a successful integration to avoid a blocker.

## 4. Product invariants

These are requirements, not aspirations:

1. The original message and actual recording are authoritative.
2. AI can suggest associations and boundaries; it cannot fabricate source messages, identities, footage or spoken replies.
3. Every public reply requires approval of its exact content revision by an authenticated creator.
4. Uncertain matches remain private and unresolved until corrected or approved.
5. Ordinary chat works without a special viewer command.
6. Manual selection and correction remain usable when AI or Twitch is unavailable.
7. A draft labelled “saved” has durable metadata and protected source media.
8. A published response contains only the approved media interval and explicitly approved context.
9. A change to a draft does not silently change a published or previously approved revision.
10. Publication, Twitch delivery and viewer playback are separate operations with separate evidence.
11. Retry and recovery cannot bypass approval or quietly select a different source.
12. An unavailable recording, uncertain send or missing message is reported honestly.
13. Public viewer routes never expose raw recordings, private drafts, tokens, local filesystem paths or unpublished transcripts.
14. The streamer is not obliged to answer everyone. No public unanswered-message scoreboard or attention ranking.

## 5. Experience and visual direction

### 5.1 Setup that proves readiness

Guide the creator through connecting Twitch, choosing supported recording sources, recording a short test, replaying it and confirming chat delivery. A green connection badge is not proof of audible, synchronized recording.

Explain exactly what will be recorded. If microphone capture differs from the broadcast mix, make that difference clear. A direct microphone must not silently defeat the creator's expected OBS mute or pause behavior.

Provide understandable recovery actions for permission denial, wrong devices, missing audio, unsupported codecs and disconnected sources. Do not bury a recoverable problem in a terminal stack trace.

### 5.2 Quiet capture during the stream

Collect incoming chat and media. Save promising exchanges privately and show a restrained indicator such as “3 replies saved.” Allow review during breaks or after the session.

A “Save that exchange” action and manual message selection must work. Add keyboard controls where supported, but do not imply a browser can provide system-wide shortcuts without an appropriate integration.

Saved candidates must retain the necessary footage when the rolling buffer moves on. A visible long-answer or capture-gap state is preferable to a silently truncated response.

### 5.3 Review that makes corrections easy

The review card contains the original message, proposed response, clear preview, message correction, interval adjustment, save/discard and publication actions.

Start with a dependable basic trimmer. Add transcript-assisted start/end selection when timestamped transcripts are available. Selecting a sentence should preview the actual corresponding media. Keep fine adjustments available.

Allow private playback of the lead-in. Preserve qualifications, negations, demonstrations and joke setup. If two messages are plausible, make choosing between them straightforward.

Keep approval deliberate without unnecessary confirmation dialogs. A review action must identify what will become public. Sharing into Twitch is a separate explicit action or an equally explicit combined action that makes both effects clear.

### 5.4 A complete viewer exchange

The viewer sees the original message and author, actual response video, duration, creator identity, stream date, captions and share/channel actions. Keep message context visible or readily accessible during playback.

Do not autoplay audio. Make mobile playback immediate and legible. Loading, unavailable media and removed replies need designed states.

A public username search is a filter, not authentication. Do not call it a private inbox. A shared page should be useful without an account or an app installation.

### 5.5 Return the replay to the original conversation

Use Twitch's supported reply mechanism when the creator selects “Share in Twitch.” Verify the API response and distinguish sent, held/rejected, failed and uncertain outcomes. Do not promise a notification or that the viewer saw the reply.

Avoid repeated announcements. Link the approved exchange directly. Do not repeat the viewer's entire message unnecessarily.

### 5.6 Distinctive craft

Give the product a deliberate identity: readable expressive typography, generous spacing, restrained colour, real media as the focal point and a subtle line connecting message to response. A brief approval animation can visually join the two halves.

Design one excellent conversation card that also informs the share preview and portrait export. Avoid assembling a generic analytics dashboard around it.

Provide accessible keyboard controls, visible focus, clear labels, appropriate live announcements, readable contrast, captions, reduced-motion support and essential actions that do not depend on hover. Verify narrow mobile layouts and desktop use.

Use realistic labelled sample content. No fabricated testimonials, usage metrics, success rates or audience activity.

## 6. Architecture: small deployment, strong boundaries

### 6.1 Baseline technology

Use TypeScript, Node.js, strict typing, ESM and a committed lockfile. React and Vite are sensible UI defaults. Select currently supported compatible versions after checking official documentation.

Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables` and switch fallthrough checks where applicable. Validate unknown external values before narrowing them. Do not silence boundary errors with broad casts, non-null assertions or unreviewed `any`. Use explicit module entry points and prevent deep imports from bypassing ownership boundaries.

Use a small Node backend, SQLite for transactional local metadata when justified, and managed filesystem media. Document the database choice and migration strategy. A different simple solution is acceptable if it meets the same durability guarantees with less complexity.

Use a focused unit/integration runner and browser automation for real UI flows. Add runtime schemas at external boundaries. FFmpeg/ffprobe are acceptable for actual media requirements; document installation and verify availability before claiming the feature works.

Prefer one repository and a modular monolith. A local capture process and an eventual hosted public reader are separate trust/deployment roles when required, not a reason to invent a service fleet.

Do not introduce Redis, Kafka, a vector database, Kubernetes, a general workflow engine, a broad plugin system or many workspace packages without a demonstrated need and a recorded decision.

### 6.2 Suggested structure

Adapt this only when there is a concrete benefit; physical folders must reflect enforced responsibilities:

```text
apps/
  web/src/
    creator/
    viewer/
    components/
  server/src/
    domain/
    application/
    adapters/
      twitch/
      capture/
      media/
      transcription/
      matching/
      storage/
      publishing/
    http/
      creator/
      public/
    jobs/
    cli/
shared/
  contracts/
tests/
  unit/
  integration/
  architecture/
  browser/
  fixtures/
evals/
scripts/
docs/
```

Choose packaging and build configuration that keep imports clear. Do not create a package for every folder. Keep the shared surface intentionally small.

### 6.3 Dependency rules

- Domain rules contain explicit inputs and deterministic state transitions. They do not import React, HTTP, SQLite, Twitch SDKs, FFmpeg, provider SDKs, environment variables or ambient clocks.
- Application services coordinate domain decisions through narrow ports for persistence, capture, time, jobs and integrations.
- Adapters implement external I/O and validate incoming data. Provider-specific payloads do not become the domain model.
- HTTP handlers authenticate and validate, call application services and return allowlisted DTOs. Business decisions do not live in route handlers.
- The browser imports public or creator contracts, never server implementations or storage entities.
- Public viewer responses are explicit projections, not serialized database rows with a few fields removed.
- Matching and transcription adapters may submit suggestions. They have no publication, chat-send or administrative capability.
- Only approval/publication application services can authorize publishing. Only the delivery service can request an outbound Twitch message.
- Background jobs use the same application rules as synchronous requests.

Enforce these directions with automated import-policy checks, including negative fixtures. Avoid a barrel export that accidentally joins public contracts and private implementation.

### 6.4 Operational simplicity

Use one local owner process for session coordination and token refresh. Begin with bounded workers in that process; persist work so it can recover. Introduce process isolation only for a demonstrated need, such as resource-limited media subprocesses.

Bound memory, queues, concurrency, disk use, retries and external-call cost. A queue must have an explicit overload policy. Surface overload instead of silently accumulating unbounded work.

Default the creator server to loopback. Public playback must not require exposing local administration or an OBS control port.

## 7. Data integrity and state machines

Define small, explicit entities:

| Entity | Essential purpose |
| --- | --- |
| Session | Channel, capture epochs, lifecycle and timing mapping. |
| Chat message | Immutable source identity, text, fragments and timestamp semantics. |
| Media asset/segment | Owned recording, time range, availability, integrity and retention. |
| Transcript revision | Provider/version, source media, timestamps and correction provenance. |
| Reply draft revision | Source message, proposed interval, attribution and review status. |
| Approval | Creator decision referencing one immutable content revision. |
| Publication | Approved derived assets, public metadata and availability state. |
| Delivery attempt | Publication, original message, outbound result and retry state. |
| Job | Durable operation, dependency, attempts, lease and result. |

Use stable internal identifiers and retain source identifiers separately. Treat external IDs as opaque strings. Do not derive identity from display names.

Define state transitions and their guards before wiring the UI. At minimum distinguish recording, durable saved draft, ready for review, approved revision, rendering/uploading, published, unpublishing and unavailable. Delivery has its own state machine.

Apply optimistic concurrency or an equivalent version check to editing and approval. Approval must fail cleanly if the reviewed revision changed. Publishing must revalidate that its target revision is approved and has not been invalidated or withdrawn.

Published revisions are immutable. Editing creates a new revision and does not mutate a live reply in place. Replacement or removal is an explicit transition. Prevent older workers from reactivating a withdrawn publication.

Make metadata changes and durable job creation atomic where they share the same database. Use unique constraints for dedupe and operation keys. Do not rely on an in-memory set for durable correctness.

## 8. Files, transactions, jobs and recovery

SQLite transactions cannot atomically commit arbitrary filesystem operations or remote uploads. Design around that fact.

- Write media into managed temporary locations, validate/finalize it, then promote it to a managed durable asset.
- Record state transitions so startup reconciliation can distinguish incomplete, complete and orphaned files.
- Protect media referenced by drafts, approvals and active work from cleanup. Cleanup needs a race-safe reference/pin policy.
- Handle disk-full, interruption during finalization, corrupt input and missing source files without claiming “saved.”
- Keep media immutable after finalization or explicitly version it. Store integrity metadata where useful.
- Make internal render/upload operations idempotent through stable keys and reconciled results.
- Persist jobs with bounded retry, backoff, lease expiry and cancellation. Recover abandoned jobs after restart.
- Use operation generations or equivalent fencing where a stale worker could overwrite newer state.

Do not claim exactly-once behavior across external services. In particular, a timed-out Twitch send can have an unknown outcome. If the API cannot safely deduplicate or reconcile it, report uncertainty and avoid blind automatic retries that may duplicate the message.

Test crash windows around saving, approving, rendering, publishing and unpublishing. A graceful shutdown is not the only failure mode to support.

## 9. Capture, clocks and media correctness

### 9.1 Select one proven capture path

Compare a narrow browser capture approach with OBS recording/replay-buffer integration. Run enough of an experiment to choose; do not build two full systems speculatively.

Evaluate the actual OS/browser, permissions, codecs, audio routes, source muting, video/audio sync, scene changes, recording finalization and load while streaming. Clearly state the initially supported environment.

OBS Virtual Camera video and audio need separate consideration. The recording must represent the sources the creator knowingly selected. Do not describe it as the exact broadcast mix unless verified.

Verify current Twitch clip capture limitations before relying on them. A delayed review must not lose its answer because an external clip capture window expired.

### 9.2 Explicit time domains

Define and name:

- Source event/envelope timestamps and what each actually means.
- Local monotonic arrival time.
- Session-relative time.
- Capture epoch and start/stop boundaries.
- Media presentation timestamps and time base.
- Transcript segment/word offsets.
- Approved interval boundaries.

Use explicit conversions and units, with valid half-open media intervals. Avoid anonymous numbers that mix wall time, seconds and media offsets. Do not assume constant frame rate or that notification arrival equals the original message time.

Device changes, capture restarts and gaps create explicit discontinuities. Do not interpolate missing footage or silently join incompatible timelines.

Matching may examine a bounded contextual window, but timestamp proximity is not sufficient evidence of a response. Do not assume a fixed Twitch viewing delay.

### 9.3 Recording retention and rendering

Protect the beginning of long candidate responses before the rolling buffer can discard it. If a response exceeds available history, explain the missing part and allow correction.

Use actual media timestamps for trims. Account for keyframes and audio/video boundaries; seeking a player is not equivalent to producing a trimmed asset.

A public derived file must contain only the approved interval and approved context. Do not serve a full private recording and rely on client-side start/end controls.

Public captions and thumbnails must be derived from the approved revision and interval. They must not reveal words or frames outside it.

Invoke media tools through structured arguments without shell interpolation. Restrict inputs to owned media assets, cap resources and duration, and reject arbitrary paths/URLs. Validate output before marking it ready.

Test with generated media containing known timestamps, visible markers and audio cues, plus a real recording. Verify synchronization, opening/closing syllables, long pauses and variable-frame-rate behavior when supported.

## 10. Twitch integration contract

Implement real and fake adapters behind the same intake contract. Fake mode is the default for development and CI and is visibly labelled.

Use current official Twitch documentation to confirm authentication, scopes, conditions and lifecycle behavior. Start with one creator-owned user token and one channel. Request only the scopes needed for enabled features, and document later scope expansion.

Prefer a supported public-client device-code flow for local setup if it fits the registered application; otherwise use the simplest supported localhost redirect flow. Confirm the exact requirements in the current docs. Never embed a confidential client secret in the browser or repository. Chat intake needs the appropriate read scope; sharing needs the appropriate write scope. Scopes and token-owner identity must be validated, not inferred from a successful website login.

Support startup validation, proactive refresh, bounded handling of authorization failures and a clear “needs login” state. Never put secrets in browser bundles, diagnostics or version control.

Token persistence must be atomic and private. If locking is used, test ownership, expiry/recovery and stale processes; never bypass a live owner's lock just to suppress an error. Repeated server restarts must not strand the user in a permanent busy state.

Resolve the configured broadcaster login and use the validated token owner's ID where Twitch requires it. Subscribe promptly after session welcome and log sanitized subscription results.

Handle keepalive expiry, graceful reconnect handoff, revocation, ordinary network drops and bounded backoff. Preserve validated Twitch reconnect URLs as required without exposing their secrets. Do not assume missed events can be replayed.

Deduplicate notifications and domain messages at their respective identities, using appropriately scoped durable uniqueness. Preserve chatter identity, original text and relevant emote/fragments. Validate unsupported event/message types rather than coercing them.

Keep local capture and saved drafts usable during a Twitch outage. Expose gaps or uncertainty when they matter to matching.

Implement moderation/removal handling with the supported events and scopes. A removed message must not later become public through an old queued job. Define the treatment of already published replies and reconcile deletion with job state.

For outgoing sharing, verify authorization and Shared Chat behavior before enabling it. Initially support a documented single-channel scenario. Do not accidentally broadcast a supposedly channel-local reply into an unsupported shared session.

Provide `twitch:login` and a manual `twitch:smoke` harness with pass/fail/not-tested states for token/scopes, broadcaster, welcome, subscription, liveness and a real received message. Diagnostics must be sanitized. No outbound message is part of the default smoke test.

## 11. Transcription and matching

The initial manual flow must work without an AI key. Then implement real transcription and suggested matching as core product capabilities, with fixtures for offline development.

Select a provider based on current supported capabilities, accuracy, timestamps, privacy, cost and latency. Do not prescribe a model from stale memory. Explain what leaves the device and enforce configurable session/concurrency/cost limits before enabling paid calls.

Record provider/model configuration, source media revision and output validation status. Do not invent word-level timing if the provider only supplies coarser offsets. Add alignment only when needed and test it.

Allow transcript corrections while preserving the underlying recording and correction provenance. Caption corrections must not be presented as edited speech.

Matching outputs can reference only supplied source IDs and valid available media intervals. Validate structured outputs server-side. Chat and transcript text are untrusted data, never executable instructions or permission to invoke tools.

The matcher must abstain when unsure. Separate candidate generation from creator approval. Suggest useful explanations in private review, such as the relevant transcript excerpt, rather than presenting an uncalibrated probability as certainty.

Evaluate direct name mentions, paraphrases, delayed answers, repeated/similar questions, multiple messages by one person, unrelated speech, demonstrations, humour, pauses, noise and no-answer cases. Include malicious instruction-like chat in negative tests.

Maintain tuning examples and a distinct held-out labelled set. Report precision, coverage, boundary quality, correction effort, latency and cost. Report denominators and failure cases; abstaining on everything is not an excellent result.

An earlier relevant answer must be labelled as an earlier answer with its real source. Never fabricate a new personal exchange. One approved source message per card is the initial rule; grouped exchanges require explicit reviewed semantics.

## 12. Public/private security boundary

Localhost is not an authentication strategy by itself. Protect creator mutations from hostile web origins and unintended network exposure using an appropriate session/capability design, origin/host checks and CSRF protection where applicable.

Keep OAuth, OBS credentials and provider keys server-side or in the supported local secret store. Use restrictive permissions and redaction. Do not implement custom cryptography.

Separate creator/admin APIs from public read APIs. Public responses use explicit allowlists. Add negative tests that request private drafts, raw media, unpublished transcripts and invalid asset IDs through public routes.

Validate ownership and authorization on every mutation and media access. A guessed ID must not be sufficient access to a private resource. Avoid directory traversal, arbitrary URL fetching and unchecked uploads. Bound payload and media size and validate actual media format, not only filenames.

Use secure browser rendering for messages and captions. Do not inject original chat or model-generated text as HTML.

Apply appropriate resource and rate limits to public endpoints and processing jobs. Keep access control effective for video range requests, thumbnails, captions, exports and cached resources, not only HTML pages.

Unpublishing must disable managed access and invalidate available caches/links according to the chosen delivery design. Explain unavoidable limitations for downloaded copies or already issued URLs; do not promise universal recall.

These constraints should translate into focused engineering and tests, not a user-facing compliance dashboard.

## 13. Publishing, delivery and portability

Implement publishing through a narrow application port. Begin locally, then prepare one concrete HTTPS hosting/storage deployment suited to the project. Avoid an elaborate multi-provider abstraction.

Only approved derived media and public metadata are uploaded. Raw source recordings and creator controls remain private. Never expose the local admin server as the publishing shortcut.

Track render, upload, publication and Twitch send separately. Handle partial failures with truthful UI and safe retry/reconciliation.

Verify a publicly reachable reply from a separate device/network after deployment is authorized. A localhost tab or LAN-only test is not external-delivery acceptance.

Support creator-controlled deletion/unpublishing. Document retention, storage limits, backup/export and restore. Prove that a saved local collection can be recovered, including the relationship between database metadata and media files.

Produce one polished portrait export with the original message, attribution, actual response and captions. Preserve the full source frame by default; do not crop away a demonstration. Exported bytes must come from an approved revision and pass the same interval/privacy checks.

A useful share preview and direct replay link are core. Extra templates and automatic reframing come after the first export is correct.

## 14. Resilience, observability and performance

Separate recording health, Twitch health, transcription health, job progress and publication health. A single global green badge must not hide a failed subsystem.

Use structured, sanitized diagnostics with session/job correlation IDs and actionable failure codes. Avoid raw chat, transcripts and recording paths in routine public or shared logs. Support an explicit sanitized diagnostic export if it is useful.

Measure queue depth, capture gaps, processing latency, failure/retry counts, storage use and dropped work where relevant. Expose only the information a creator needs to act.

Test device loss, permission denial, dropped network, OAuth expiry, provider throttling, malformed responses, full disk, corrupt media, application restart and interruption during publication.

Protect the stream's responsiveness. Use bounded work and resource limits. Record CPU/memory and, where available, OBS frame/render/encoding statistics during a real rehearsal. Do not claim “zero impact” without evidence.

Define performance targets before measuring, record the hardware/network/fixtures and report observed distributions. Useful provisional targets include:

- An obvious suggested exchange can be approved in a few deliberate actions after preview.
- A newcomer can find and play a known reply without coaching.
- Suggested replies appear soon enough after a response to be useful during the same session.
- A 60-minute rehearsal shows bounded memory, controlled disk use and correct cleanup.
- Mobile playback starts promptly on the declared test connection.

Translate these into measurable thresholds after the capture/provider experiments. Do not invent impressive numbers or tune acceptance thresholds after seeing a failure without documenting the reason.

## 15. Milestone plan and acceptance gates

Milestones are vertical slices and evidence checkpoints. Continue after a checkpoint unless I explicitly ask to review before proceeding. Never label an external/manual acceptance item complete merely because its implementation is ready.

| Milestone | Deliverable | Evidence required |
| --- | --- | --- |
| M0 — Foundation and capture decision | Project, concise specifications, strict tooling, UI direction, fake chat and focused capture experiment. | Clean setup and checks; real experiment or an explicit pending device action; documented capture choice. |
| M1 — Durable local exchange | Real Twitch intake, selected-source recording, manual association, trimming, private drafts, local approval and viewer replay. | A real exchange can be saved, restarted and replayed with correct attribution and complete media. Fixtures are separate evidence. |
| M2 — Useful assistance | Real transcription, suggested associations, abstention, correction and transcript-assisted review. | Held-out evaluation, provider error handling, measured cost/latency and manual fallback. |
| M3 — Shareable product | Approved-media publication, mobile reply pages, creator-controlled Twitch reply sharing and removal. | Prepared deployment plus, after authorization, external playback and real outgoing-delivery acceptance. |
| M4 — Memorable experience | Refined identity, interaction/motion, captions, share previews and one portrait export. | Visual/browser inspection, keyboard/mobile tests and sample export verified against its approved source. |
| M5 — Reliability and usability | Recovery, backup/restore, retention, bounded resource use, clean install and user feedback. | Fault/restart tests, a real rehearsal and recorded novice feedback or explicit pending human acceptance. |
| M6 — Submission-ready release | Selected ThatBit branding, instructions, honest demo, Codex development evidence and submission assets. | Rehearsed live path, supported environment, reproducible checks and an accurate readiness report. Actual submission requires authorization. |
| M7 — Product expansion | Reviewed follow-up threads, moderator collaboration, authenticated personal collections and approved-answer discovery. | Start after the primary product is accepted; validate demand and specify authorization/data semantics before implementation. |

### Canonical end-to-end acceptance

1. Start with clean documented configuration and a supported capture setup.
2. Connect to a real Twitch channel and verify a real received message.
3. Record an actual spoken or demonstrated response.
4. Obtain a suggestion or manually associate the correct source message.
5. Preview and adjust boundaries without losing the original recording.
6. Save, restart the app and reopen the same durable draft.
7. Approve an exact revision.
8. Render and publish only that revision's permitted assets.
9. Open its replay on another device, including captions and message context.
10. After explicit authorization, share it into the original Twitch conversation and verify the result.
11. Export the approved portrait version and inspect its actual bytes/playback.
12. Unpublish and verify managed access is removed without a stale job resurrecting it.

Run the scenario with a useful answer and a humorous or visual exchange. Include an ambiguous-message case that requires correction. The demonstration must show both usefulness and responsible behavior under uncertainty.

## 16. Test strategy and evidence

Use unit tests for meaningful rules, integration tests with real local storage/media tools, architecture tests for boundaries, and browser tests for complete user actions. Do not merely mock every dependency and declare the whole system integrated.

CI must run without Twitch credentials, camera access, paid APIs or external network dependencies. Use sanitized Twitch fixtures, deterministic clocks and generated/appropriately licensed sample media. Provider contract fixtures and validation tests complement live smoke checks; they do not replace them.

Required regression areas:

- Welcome, subscription timing, keepalive, handoff, revocation and reconnect.
- Token refresh failure, atomic persistence and lock recovery.
- Duplicate events and stable identity.
- Invalid IDs, intervals, units and media discontinuities.
- Draft durability and protection against cleanup.
- Crash recovery at filesystem/database transition boundaries.
- Concurrent edit/approval and stale-job fencing.
- No public access to unapproved or raw content, including derived endpoints.
- Source-message removal racing publication.
- Rendering output matching the approved interval.
- Upload failure, publication retry and uncertain outbound delivery.
- Provider output validation, injection-like input and ambiguous matches.
- Restart, backup/restore, disk-full and missing media.
- Keyboard navigation, captions, reduced motion and narrow screens.

Maintain an acceptance ledger with columns for scenario, environment, fixture/live source, observed result, evidence and outstanding action.

Keep these distinct: code implemented; automated checks passed; browser behavior inspected; real capture verified; real Twitch intake verified; real provider verified; external playback verified; real outbound reply verified; human usability feedback collected.

Use browser tools to inspect the UI when available. Resolve actual layout, console and interaction failures. Automated accessibility checks supplement manual keyboard and comprehension checks.

Do not manufacture screenshots, benchmark results, audience counts or acceptance evidence.

## 17. Repository, documentation and commands

Create a concise `AGENTS.md` with durable product boundaries, development commands and completion standards. Move detailed product context into documentation instead of putting this entire brief into `AGENTS.md`.

Maintain:

- `README.md`: purpose, current capability, supported environment, quick start and limitations.
- `docs/product.md`: users, complete flows, UX direction and scope.
- `docs/architecture.md`: module dependencies, trust boundaries, data lifecycle and decisions.
- `docs/media.md`: capture setup, clocks, retention, rendering and verified limitations.
- `docs/milestones.md`: roadmap, evidence checkpoints and current status.
- `docs/testing.md`: automated checks, fixtures, manual procedures and acceptance ledger.
- `docs/twitch.md`: app registration, scopes, login, smoke tests and troubleshooting.
- `docs/deployment.md`: prepared topology, access boundaries, configuration and rollout/rollback steps.
- `docs/how-we-used-codex.md`: dated factual decisions, debugging and tests.
- Short architecture decision records only for consequential tradeoffs; avoid duplicating the same explanation across files.

Provide real implementations for appropriate commands such as:

```text
npm run dev
npm run build
npm run typecheck
npm run lint
npm run check:boundaries
npm test
npm run test:e2e
npm run check
npm run twitch:login
npm run twitch:smoke
npm run media:smoke
npm run eval:matching
npm run demo
```

Add commands when their functionality exists. Do not create scripts that print success for unimplemented checks. The main check must cover the required local/CI gates and must not silently skip essential browser or integration checks. Separate live and paid smoke tests explicitly.

Include an environment example with no secrets, a lockfile, supported runtime/tool versions, `.gitignore`, migrations and a clean-install procedure. Keep token stores, local databases, captured media, private transcripts and generated secrets out of version control.

Initialize Git if necessary. Confirm the intended repository root so an empty subdirectory does not accidentally become work in a parent project. Commit verified milestones, inspect staged changes and report commit hashes. Do not invent Git identity or overwrite unrelated user changes. Do not push or create a remote without authorization.

## 18. Optional previous-project reference

A previous project may exist at `/home/aman/Projects/groundhog-heist`. It contains Twitch authentication, EventSub, dedupe and reconnect work that was exercised previously.

Inspect relevant source read-only if available. Reuse only narrowly useful code after understanding its dependencies, licensing and tests. Preserve attribution where required.

Do not modify that repository or copy its credentials, recordings, databases, game architecture or visual design. Its simulation/planning rules are not ThatBit requirements. If it is unavailable, proceed from official documentation.

The new project must build and run independently.

## 19. Research references and verification discipline

Use current official documentation for implementation decisions. These are starting points, not a substitute for checking the exact APIs and deployed versions:

- [Hackathon overview](https://twitchcon-codex.devpost.com/) and [official rules](https://twitchcon-codex.devpost.com/rules).
- [Twitch authentication](https://dev.twitch.tv/docs/authentication/).
- [Twitch EventSub WebSocket lifecycle](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/).
- [Twitch EventSub reference](https://dev.twitch.tv/docs/eventsub/eventsub-reference/).
- [Twitch sending and receiving chat](https://dev.twitch.tv/docs/chat/send-receive-messages/).
- [Twitch clips](https://dev.twitch.tv/docs/api/clips/).
- [OBS remote control](https://obsproject.com/kb/remote-control-guide), [virtual camera](https://obsproject.com/kb/virtual-camera-guide) and [WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).
- [Browser display capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia) and [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).
- [OpenAI Codex best practices](https://learn.chatgpt.com/guides/best-practices).

Problem/adjacency references:

- [Discussion of missing chat context in recordings](https://www.reddit.com/r/Twitch/comments/1nrdctu/do_you_feel_an_on_screen_chat_overlays_is_a_must/).
- [Discussion of missed answers and creator attention](https://www.reddit.com/r/Twitch/comments/vnijtd/).
- [Discussion of finding moments while editing](https://www.reddit.com/r/Twitch/comments/1wm81ng/those_of_you_cutting_your_own_shortstiktoks_from/).
- [Whipscribe VOD search](https://whipscribe.com/blog/how-to-find-what-a-streamer-said-in-a-vod-2026).
- [ByteMate clip commands](https://docs.bytemate.me/en/docs/stream-tools/clip-command).
- [InteracVid research](https://arxiv.org/abs/2608.01157).
- [Existing ThatBit name usage](https://thatbit.app/).

Treat forum statements as user experiences, not authoritative API or policy documentation. Verify current product claims before using them in competitive positioning. Do not initiate another broad idea search; the product direction is chosen.

## 20. Working style and immediate assignment

Make routine engineering choices autonomously and explain important tradeoffs. Ask concise questions only when missing information blocks progress or would cause expensive rework. Use reasonable documented assumptions for reversible choices.

Keep progress updates focused on findings, working capabilities and unresolved risks. Do not repeatedly stop with another plan or an offer to continue. Maintain a short current-status document so work survives context changes.

Implement in vertical slices. Produce a usable real workflow early, then complete the intelligence, publishing and polish around it. A fake adapter is a development tool, not the final integration.

Begin now:

1. Confirm the empty directory, repository boundary, OS and installed toolchain.
2. Verify the official requirements and the few API/capture questions that affect the first slice.
3. Record the concise architecture and milestone plan, including enforcement of the invariants above.
4. Scaffold and implement M0, then the complete durable local flow in M1.
5. Continue through M2–M6 where prerequisites and authorization permit.
6. When a live action is needed, provide the exact user action and expected result while completing independent work.
7. Test, inspect, recover from failures, update documentation and commit verified progress.

At each substantial checkpoint report what works, how to run it, checks actually performed, evidence collected, remaining manual/external acceptance, material limitations and the commit hash.

Before final delivery, audit the product against the canonical end-to-end scenario and every invariant. Fix known implementation defects rather than hiding them in a roadmap. If something truly cannot be completed in the environment, describe exactly what is implemented, what was observed, what remains blocked and what action resolves it.

The desired outcome is a complete, credible and delightful product that works for real people. Deliver working evidence at that standard.
