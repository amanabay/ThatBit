# ReplyLink engineering rules

Read replylink-kickoff.md and docs/status.md before work. This is a local, single-creator product; public naming remains unresolved.

- Original messages and media are authoritative. Never fabricate audience participation or spoken responses. Label fixture media visibly.
- Every publication targets an immutable, authenticated approval. Editing must create a revision. Removal must fence running work.
- Public APIs allowlist DTOs and approved derived media only. Keep raw sources, credentials, drafts and transcripts private.
- Domain rules have deterministic inputs and no I/O. Applications coordinate ports; adapters own I/O. Web code imports contracts only.
- Do not deploy, spend money, publish real recordings externally, or send Twitch messages without the relevant explicit authorization.
- Use Node 24.14+, FFmpeg/ffprobe, TypeScript strict mode and the npm lockfile. Commands: npm ci; npm run demo; npm run dev; npm run check.
- Main check includes typecheck, lint, boundaries, integration/media tests, matching fixtures, build and Chromium flows. Keep failures visible.
- Record fixture/live evidence separately in docs/testing.md. Never call a manual/live acceptance gate complete on implementation alone.
- Commit verified changes when Git metadata is writable. Do not invent identity, push, or alter a mounted .git directory to bypass restrictions.
