# Twitch setup and live acceptance

Register a **public client** application in the [Twitch developer console](https://dev.twitch.tv/console/apps). Put TWITCH_CLIENT_ID and your own TWITCH_CHANNEL login in `.env` locally. No client secret belongs in browser code or chat. Stop the server, run `npm run twitch:login`, visit the printed verification URL and enter its short user code. Restart `npm run dev`. Tokens are written atomically into ignored `.data/twitch-token.json` with mode 0600.

Scopes are user:read:chat and user:write:chat, using one creator-owned user token. Startup validates client ID, scopes and token user ID, resolves broadcaster and restricts initial use to the creator's own channel. Validation runs every 30 minutes; expired tokens attempt refresh. Needs-login errors leave manual drafts available. Login and server token maintenance share the same data-owner lock, preventing concurrent refresh writers.

The adapter opens EventSub WebSocket, subscribes immediately after welcome to channel.chat.message and channel.chat.message_delete, handles keepalive, reconnect handoff and revocation, and reconnects network drops with capped backoff. Persistent message IDs deduplicate messages. Repeated deletion is idempotent. Source timestamps are envelope timestamps. Emote fragment persistence and envelope-level dedupe are incomplete. Do not claim event replay across gaps; Twitch provides none. Shared Chat foreign messages are skipped; real Shared Chat behavior has not been accepted.

Live smoke: open studio and confirm Receiving chat; send an ordinary message from your account; run `npm run twitch:smoke`. It reports connection, whether any real source message is stored, and outbound NOT TESTED. This is not yet the full lifecycle acceptance harness. Never run outbound messages automatically in smoke tests.

Share in Twitch is a separate explicit creator action. It requires a published non-fixture reply, original live Twitch source message, validated login, and configured PUBLIC_BASE_URL starting with HTTPS. **Do not configure this until deployed reader reachability and the exact replay link are verified.** The server sends a supported reply_parent_message_id and for_source_only=true. Result is sent, held or rejected; exceptions are uncertain. Each publication permits one persisted attempt, so uncertain results do not automatically retry. A crash after send-start leaves sending and needs manual reconciliation; automatic retry is intentionally absent. Sent does not mean the viewer saw it or was notified.

Authoritative references checked 2026-10-29:
- https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
- https://dev.twitch.tv/docs/eventsub/handling-websocket-events/
- https://dev.twitch.tv/docs/chat/send-receive-messages/

Live OAuth, token refresh, welcome/subscription timing, revocation, reconnect, real deletion and outbound acceptance remain pending; contract implementation alone is not evidence of those outcomes.
