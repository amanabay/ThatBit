import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  Delivery,
  Message,
  MessageFragment,
  Revision,
} from "../../../../../shared/contracts/models.ts";
import type { Exchanges } from "../../application/exchanges.ts";
import { Conflict } from "../../domain/rules.ts";
import { Token, READ_SCOPE, WRITE_SCOPE } from "./auth.ts";
export { Token } from "./auth.ts";
const Validation = z.object({
  client_id: z.string(),
  user_id: z.string(),
  scopes: z.array(z.string()),
  expires_in: z.number(),
});
const Envelope = z.object({
  metadata: z.object({
    message_id: z.string(),
    message_type: z.string(),
    message_timestamp: z.string().datetime({ offset: true }),
  }),
  payload: z.record(z.string(), z.unknown()),
});
export const ChatEvent = z.object({
  message_id: z.string(),
  chatter_user_id: z.string(),
  chatter_user_name: z.string(),
  message: z.object({
    text: z.string(),
    fragments: z.array(MessageFragment).max(1000).optional(),
  }),
  source_broadcaster_user_id: z.string().nullable().optional(),
});
export async function saveToken(root: string, token: z.infer<typeof Token>) {
  const temp = join(root, "twitch-token.tmp");
  await writeFile(temp, JSON.stringify(token), { mode: 0o600, flush: true });
  await rename(temp, join(root, "twitch-token.json"));
}
export class Twitch {
  status = "Not configured";
  private socket: WebSocket | undefined;
  private handoffSocket: WebSocket | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private userId = "";
  private broadcaster = "";
  private token: z.infer<typeof Token> | undefined;
  private attempts = 0;
  private scopes: string[] = [];
  private arrivalSessionId = crypto.randomUUID();
  constructor(
    private app: Exchanges,
    private root: string,
    private clientId: string,
    private channel: string,
    private request: typeof fetch = fetch,
    private createSocket: (url: string) => WebSocket = (url) =>
      new WebSocket(url),
  ) {}
  private async api(path: string, body?: unknown) {
    if (!this.token) throw new Error("Login required");
    const response = await this.request("https://api.twitch.tv/helix/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.token.access_token}`,
        "Client-Id": this.clientId,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Twitch HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  }
  private async validate() {
    if (!this.token) throw new Error("Login required");
    let response = await this.request("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${this.token.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) {
      const refresh = await this.request("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.token.refresh_token,
          client_id: this.clientId,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!refresh.ok) throw new Error("Login expired");
      this.token = Token.parse(await refresh.json());
      await saveToken(this.root, this.token);
      response = await this.request("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${this.token.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
    }
    if (!response.ok) throw new Error("Login validation failed");
    const data = Validation.parse(await response.json());
    if (data.client_id !== this.clientId || !data.scopes.includes(READ_SCOPE))
      throw new Error("Login/scopes mismatch");
    if (this.userId && this.userId !== data.user_id)
      throw new Error("Token owner changed");
    this.userId = data.user_id;
    this.scopes = data.scopes;
    return data.expires_in;
  }
  async start() {
    if (!this.clientId || !this.channel) {
      this.app.diagnostics.event("info", "twitch.not_configured", {
        configured: false,
      });
      return;
    }
    this.app.diagnostics.event("info", "twitch.starting");
    try {
      this.token = Token.parse(
        JSON.parse(
          await readFile(join(this.root, "twitch-token.json"), "utf8"),
        ),
      );
      const expiresIn = await this.validate();
      const users = z
        .object({ data: z.array(z.object({ id: z.string() })) })
        .parse(
          await this.api("users?login=" + encodeURIComponent(this.channel)),
        );
      this.broadcaster = users.data[0]?.id ?? "";
      if (this.broadcaster !== this.userId)
        throw new Error(
          "Initial release supports the creator’s own channel only",
        );
      this.connect();
      this.scheduleValidation(expiresIn);
    } catch (error) {
      this.app.diagnostics.event("error", "twitch.login_failed", {}, error);
      this.status = "Needs login — run npm run twitch:login";
    }
  }
  private scheduleValidation(expiresIn: number) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => {
        void this.validate()
          .then((remaining) => {
            if (!this.stopped) this.scheduleValidation(remaining);
          })
          .catch((error) => {
            this.app.diagnostics.event(
              "error",
              "twitch.validation_failed",
              {},
              error,
            );
            this.stop();
            this.status = "Needs login — run npm run twitch:login";
          });
      },
      Math.min(30 * 60 * 1000, Math.max(1000, (expiresIn - 60) * 1000)),
    );
  }
  private retry() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.connect(),
      Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)),
    );
  }
  private connect(url = "wss://eventsub.wss.twitch.tv/ws", handoff = false) {
    if (this.stopped || (handoff && this.handoffSocket)) return;
    this.status = "Connecting";
    this.app.diagnostics.event("info", "twitch.connecting");
    const previous = this.socket;
    const socket = this.createSocket(url);
    if (handoff) this.handoffSocket = socket;
    else this.socket = socket;
    let welcome = false,
      keepalive = 10;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = (seconds: number) => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(
        () => {
          socket.close();
          this.app.diagnostics.event("warn", "twitch.keepalive_timeout", {
            retry: true,
          });
        },
        (seconds + 5) * 1000,
      );
    };
    arm(10);
    socket.onmessage = (event) => {
      const arrivedAt = new Date().toISOString();
      const arrivedMonotonicMs = performance.now();
      void (async () => {
        if (
          this.stopped ||
          (this.socket !== socket && this.handoffSocket !== socket)
        )
          return;
        const e = Envelope.parse(JSON.parse(String(event.data)));
        arm(keepalive);
        if (e.metadata.message_type === "session_welcome") {
          if (welcome) throw new Error("Duplicate welcome");
          const session = z
            .object({
              id: z.string(),
              keepalive_timeout_seconds: z.number().nonnegative().nullable(),
            })
            .parse(e.payload.session);
          welcome = true;
          keepalive = session.keepalive_timeout_seconds ?? 10;
          arm(keepalive);
          if (handoff) {
            this.socket = socket;
            this.handoffSocket = undefined;
            previous?.close();
          } else {
            for (const type of [
              "channel.chat.message",
              "channel.chat.message_delete",
              "channel.chat.clear",
              "channel.chat.clear_user_messages",
            ])
              await this.api("eventsub/subscriptions", {
                type,
                version: "1",
                condition: {
                  broadcaster_user_id: this.broadcaster,
                  user_id: this.userId,
                },
                transport: { method: "websocket", session_id: session.id },
              });
          }
          if (
            this.stopped ||
            this.socket !== socket ||
            socket.readyState !== WebSocket.OPEN
          )
            return;
          this.attempts = 0;
          this.status = "Receiving chat";
          this.app.diagnostics.event("info", "twitch.receiving");
        } else if (e.metadata.message_type === "session_reconnect") {
          const s = z
            .object({ reconnect_url: z.string().url() })
            .parse(e.payload.session);
          const u = new URL(s.reconnect_url);
          if (
            u.protocol !== "wss:" ||
            u.hostname !== "eventsub.wss.twitch.tv" ||
            u.username ||
            u.password ||
            u.port
          )
            throw new Error("Invalid reconnect URL");
          this.connect(s.reconnect_url, true);
        } else if (e.metadata.message_type === "revocation") {
          this.stop();
          this.status = "Subscription revoked — needs login";
          this.app.diagnostics.event("error", "twitch.subscription_revoked", {
            retry: false,
          });
        } else if (e.metadata.message_type === "notification") {
          if (!welcome) throw new Error("Notification before welcome");
          this.app.twitchEvent(e.metadata.message_id, () => {
            const subscription = z
              .object({ type: z.string() })
              .parse(e.payload.subscription);
            if (subscription.type === "channel.chat.message") {
              const m = ChatEvent.parse(e.payload.event);
              if (
                m.source_broadcaster_user_id &&
                m.source_broadcaster_user_id !== this.broadcaster
              ) {
                this.status =
                  "Shared Chat unsupported — foreign message skipped";
                return;
              }
              this.app.message({
                id: crypto.randomUUID(),
                sourceId: m.message_id,
                userId: m.chatter_user_id,
                author: m.chatter_user_name,
                text: m.message.text,
                receivedAt: e.metadata.message_timestamp,
                arrivedAt,
                arrivedMonotonicMs,
                arrivalSessionId: this.arrivalSessionId,
                ...(m.message.fragments
                  ? { fragments: m.message.fragments }
                  : {}),
                source: "twitch",
                removed: false,
              });
              this.app.diagnostics.event("debug", "twitch.message_received");
            } else if (subscription.type === "channel.chat.message_delete") {
              const m = z
                .object({ message_id: z.string() })
                .parse(e.payload.event);
              this.app.removeMessage(m.message_id, "twitch");
              this.app.diagnostics.event("info", "twitch.message_deleted");
            } else if (
              subscription.type === "channel.chat.clear" ||
              subscription.type === "channel.chat.clear_user_messages"
            ) {
              const m = z
                .object({
                  broadcaster_user_id: z.string(),
                  target_user_id: z.string().optional(),
                })
                .parse(e.payload.event);
              if (m.broadcaster_user_id !== this.broadcaster) return;
              if (
                subscription.type === "channel.chat.clear_user_messages" &&
                !m.target_user_id
              )
                throw new Error("Missing clear target");
              this.app.clearTwitchMessages(
                e.metadata.message_timestamp,
                subscription.type === "channel.chat.clear_user_messages"
                  ? m.target_user_id
                  : undefined,
              );
              this.app.diagnostics.event("info", "twitch.messages_cleared");
            }
          });
        }
      })().catch((error) => {
        this.app.diagnostics.event("error", "twitch.event_failed", {}, error);
        this.status = "Twitch event or subscription failed";
        socket.close();
      });
    };
    socket.onclose = () => {
      if (watchdog) clearTimeout(watchdog);
      if (this.stopped) return;
      if (this.handoffSocket === socket) {
        this.handoffSocket = undefined;
        if (this.socket === previous) {
          this.socket = undefined;
          previous?.close();
        }
      } else if (this.socket === socket) {
        this.socket = undefined;
        if (this.handoffSocket) return;
      } else return;
      this.status = welcome
        ? "Chat gap — reconnecting"
        : "Connection failed — reconnecting";
      this.app.diagnostics.event("warn", "twitch.disconnected", {
        retry: true,
      });
      this.retry();
    };
    socket.onerror = () => {
      this.app.diagnostics.event("warn", "twitch.network_failed");
    };
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.socket?.close();
    this.handoffSocket?.close();
  }
  async share(id: string) {
    const dto = this.app.publicReply(id);
    if (!dto) throw new Conflict("Publish an approved reply first.");
    if (dto.fixture)
      throw new Conflict("Fixture replies cannot be sent into Twitch.");
    const base = process.env.PUBLIC_BASE_URL;
    if (
      !base ||
      !base.startsWith("https://") ||
      ["localhost", "127.0.0.1"].includes(new URL(base).hostname)
    )
      throw new Conflict(
        "Configure and verify the HTTPS public reader before sharing.",
      );
    const prior = this.app.store
      .list("delivery", Delivery)
      .find((d) => d.publicationId === id);
    if (prior) return prior;
    await this.validate();
    if (!this.scopes.includes(WRITE_SCOPE))
      throw new Conflict(
        "Sharing permission is not enabled. After verifying an external reader, stop ThatBit and run npm run twitch:login -- --with-sharing.",
      );
    const p = this.app.state().publications.find((p) => p.id === id);
    const r = p
      ? this.app.store.get("revision", p.revisionId, Revision)
      : undefined;
    const m = r
      ? this.app.store.get("message", r.messageId, Message)
      : undefined;
    if (m?.source !== "twitch" || m.removed)
      throw new Conflict("Original Twitch message unavailable.");
    const attempt: Delivery = {
      id: crypto.randomUUID(),
      publicationId: id,
      state: "sending",
      createdAt: new Date().toISOString(),
    };
    this.app.store.put("delivery", attempt.id, attempt);
    this.app.diagnostics.event("info", "twitch.share_started", {
      publicationId: id,
      jobId: attempt.id,
    });
    try {
      const result = z
        .object({
          data: z.array(
            z.object({
              is_sent: z.boolean(),
              drop_reason: z.object({ code: z.string() }).nullable(),
            }),
          ),
        })
        .parse(
          await this.api("chat/messages", {
            broadcaster_id: this.broadcaster,
            sender_id: this.userId,
            message: `Your reply has a replay: ${base}/r/${id}`,
            reply_parent_message_id: m.sourceId,
            for_source_only: true,
          }),
        );
      const send = result.data[0];
      attempt.state = send?.is_sent
        ? "sent"
        : send?.drop_reason?.code === "automod_held"
          ? "held"
          : "rejected";
    } catch (error) {
      this.app.diagnostics.event(
        "error",
        "twitch.share_uncertain",
        { publicationId: id, jobId: attempt.id, retry: false },
        error,
      );
      attempt.state = "uncertain";
    }
    this.app.store.put("delivery", attempt.id, attempt);
    this.app.diagnostics.event(
      attempt.state === "sent" ? "info" : "warn",
      "twitch.share_" + attempt.state,
      { publicationId: id, jobId: attempt.id },
    );
    return attempt;
  }
}
