# Prepared deployment; no deployment performed

Local creator: loopback 4317, private SQLite/media/token files. Hosted reader: separate process/container, approved-only snapshot mounted read-only, no creator API, no Twitch/OAuth/provider credentials. Never reverse proxy the local creator application.

1. Build and inspect an approved local replay. Stop app.
2. `npm run export:public -- /tmp/replylink-public` creates a new bundle containing allowlisted manifest, approved derived videos and built UI only. Run with TWITCH_CHANNEL set for correct creator attribution. No source recordings, drafts, transcript stores or tokens are copied.
3. Inspect bundle before any upload. `BUNDLE_DIR=/tmp/replylink-public PORT=8080 npm run reader` serves on loopback for local verification. Creator routes must return 404; direct source paths must not exist.
4. After explicit hosting authorization, use one Linux HTTPS host with Docker and Caddy. `docker build -f deploy/Dockerfile.reader -t replylink-reader .`; mount bundle read-only at /bundle; map `127.0.0.1:8080:8080`. Adapt deploy/Caddyfile to the approved hostname and terminate TLS there. No host, domain or billable resource has been created.
5. Verify reply page, video range playback and captions from another device/network. Only then configure PUBLIC_BASE_URL for Twitch share.

The reader has per-IP request limits and no-store cache policy. File access is gated by current manifest membership on each request. Removal requires atomically replacing the hosted manifest with a freshly exported one; stale snapshots remain available until replaced. Local unpublish alone cannot revoke an exported/deployed snapshot. This is an explicit release gap: live upload/removal acknowledgment and per-publication availability need integration before advertising automatic external publication. Do not use local publication state as proof of hosted availability.

Rollout: approve locally → inspect fresh bundle → stage HTTPS host → external smoke → explicitly enable sharing. Rollback: replace manifest with empty array or stop reader; verify old URL returns unavailable. Downloaded copies/open streams are not recalled. Do not roll back to an old manifest that reactivates a removed reply. Retain source backup privately; hosted bundle is not a creator backup.

Docker image and Caddy file are prepared, not built or deployed here. No actual recording has been published externally.
