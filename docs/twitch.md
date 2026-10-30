# Twitch setup and live acceptance

Register a **public client** application in the [Twitch developer console](https://dev.twitch.tv/console/apps). The account must have a verified email and 2FA enabled. Choose a unique application name and a chat-related category. Select Client Type **Public**. If the form requires an OAuth redirect URL, add `http://localhost:4317`; device login does not use a redirect callback. See Twitch's [registration](https://dev.twitch.tv/docs/authentication/register-app/) and [device-flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow) instructions.

Put the app's Client ID and your own channel login in local `.env`:

```dotenv
TWITCH_CLIENT_ID=your_public_app_client_id
TWITCH_CHANNEL=your_channel_login
```

Use the login without `@` or a URL. No client secret is needed. Stop ReplyLink with Ctrl+C, then run `npm run twitch:login`. Open its printed Twitch activation URL, sign in as the channel owner, enter the short user code if requested, and authorize reading chat. Keep this terminal open until it confirms validation and saving. Tokens and device codes must not be pasted into chat. The command validates the client ID, permissions and channel owner before replacing credentials. Existing credentials remain unchanged on denial, expiry or validation failure. Token writes use ignored `DATA_DIR/twitch-token.json` (default `.data`) with mode 0600.

Restart `npm run dev:local`. Look for `twitch.receiving` in the CLI and **Receiving chat** in the studio. Open your channel chat in Twitch and send an ordinary message yourself; verify it appears in ReplyLink, then run `npm run twitch:smoke`. These receive-only checks do not send messages for you. You can test chat intake separately from going live or recording OBS. Use a separate viewer/test account for deletion acceptance where broadcaster messages cannot be deleted through the moderation mechanism.

Default login requests only `user:read:chat`, using one creator-owned user token. After separately verifying a public reader and choosing to enable sharing, `npm run twitch:login -- --with-sharing` additionally requests `user:write:chat`. The share action checks that permission explicitly. Startup validates client ID, read scope and token user ID, resolves broadcaster and restricts initial use to the creator's own channel. Validation runs every 30 minutes; expired tokens attempt refresh. Needs-login errors leave manual drafts available. Login and server token maintenance share the same data-owner lock, preventing concurrent refresh writers.

Login sends the requested scopes during device creation and token exchange, honors pending/slow-down responses, and stops on denial, expiry, invalid codes or unexpected responses. Network requests have timeouts. Failures exit nonzero with fixed actionable messages and never print token/provider-response bodies. `TWITCH_COLLECTION_BUSY` means stop the app before login; `TWITCH_DEVICE_REJECTED` means check Client ID/Public type; `TWITCH_CHANNEL_MISMATCH` means authorize the channel owner's account. Login fixtures cover these boundaries without using real credentials.

The adapter opens EventSub WebSocket, subscribes immediately after welcome to channel.chat.message and channel.chat.message_delete, handles keepalive, reconnect handoff and revocation, and reconnects network drops with capped backoff. Persistent message IDs deduplicate messages. Repeated deletion is idempotent. Source timestamps are envelope timestamps. Emote fragment persistence and envelope-level dedupe are incomplete. Do not claim event replay across gaps; Twitch provides none. Shared Chat foreign messages are skipped; real Shared Chat behavior has not been accepted.

Live smoke: open studio and confirm Receiving chat; send an ordinary message from your account; run `npm run twitch:smoke`. It reads the local configured port and reports connection, whether Twitch source messages exist, and outbound NOT TESTED. Stored history is not proof that fresh intake is working; observe your new message in the studio. This is not the full lifecycle acceptance harness. Never run outbound messages automatically in smoke tests.

Share in Twitch is a separate explicit creator action. It requires a published non-fixture reply, original live Twitch source message, validated login, and configured PUBLIC_BASE_URL starting with HTTPS. **Do not configure this until deployed reader reachability and the exact replay link are verified.** The server sends a supported reply_parent_message_id and for_source_only=true. Result is sent, held or rejected; exceptions are uncertain. Each publication permits one persisted attempt, so uncertain results do not automatically retry. A crash after send-start leaves sending and needs manual reconciliation; automatic retry is intentionally absent. Sent does not mean the viewer saw it or was notified.

Authoritative references checked 2026-10-30:
- https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
- https://dev.twitch.tv/docs/eventsub/handling-websocket-events/
- https://dev.twitch.tv/docs/chat/send-receive-messages/

Live OAuth, token refresh, welcome/subscription timing, revocation, reconnect, real deletion and outbound acceptance remain pending; contract implementation alone is not evidence of those outcomes.
