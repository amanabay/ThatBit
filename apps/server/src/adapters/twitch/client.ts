import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  Delivery,
  Message,
  Revision,
} from "../../../../../shared/contracts/models.ts";
import type { Exchanges } from "../../application/exchanges.ts";
import { Conflict } from "../../domain/rules.ts";
export const Token = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
});
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
    message_timestamp: z.string(),
  }),
  payload: z.record(z.string(), z.unknown()),
});
export const ChatEvent = z.object({
  message_id: z.string(),
  chatter_user_id: z.string(),
  chatter_user_name: z.string(),
  message: z.object({
    text: z.string(),
    fragments: z.array(z.unknown()).optional(),
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
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private userId = "";
  private broadcaster = "";
  private token: z.infer<typeof Token> | undefined;
  private attempts = 0;
  constructor(
    private app: Exchanges,
    private root: string,
    private clientId: string,
    private channel: string,
  ) {}
  private async api(path: string, body?: unknown) {
    if (!this.token) throw new Error("Login required");
    const response = await fetch("https://api.twitch.tv/helix/" + path, {
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
    let response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${this.token.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) {
      const refresh = await fetch("https://id.twitch.tv/oauth2/token", {
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
      response = await fetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${this.token.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
    }
    const data = Validation.parse(await response.json());
    if (
      data.client_id !== this.clientId ||
      !["user:read:chat", "user:write:chat"].every((s) =>
        data.scopes.includes(s),
      )
    )
      throw new Error("Login/scopes mismatch");
    this.userId = data.user_id;
  }
  async start() {
    if (!this.clientId || !this.channel) return;
    try {
      this.token = Token.parse(
        JSON.parse(
          await readFile(join(this.root, "twitch-token.json"), "utf8"),
        ),
      );
      await this.validate();
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
      this.refreshTimer = setInterval(
        () => {
          void this.validate().catch(() => {
            this.status = "Needs login";
            this.socket?.close();
          });
        },
        30 * 60 * 1000,
      );
    } catch {
      this.status = "Needs login — run npm run twitch:login";
    }
  }
  private connect(url = "wss://eventsub.wss.twitch.tv/ws", handoff = false) {
    if (this.stopped) return;
    this.status = "Connecting";
    const previous = this.socket;
    const socket = new WebSocket(url);
    if (!handoff) this.socket = socket;
    let welcome = false;
    let keepalive = 10;
    const arm = (seconds: number) => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(
        () => {
          socket.close();
          this.status = "Chat gap — reconnecting";
        },
        (seconds + 5) * 1000,
      );
    };
    arm(10);
    socket.onmessage = (event) => {
      void (async () => {
        const e = Envelope.parse(JSON.parse(String(event.data)));
        arm(keepalive);
        if (e.metadata.message_type === "session_welcome") {
          const session = z
            .object({
              id: z.string(),
              keepalive_timeout_seconds: z.number().nullable(),
            })
            .parse(e.payload.session);
          welcome = true;
          this.attempts = 0;
          keepalive = session.keepalive_timeout_seconds ?? 10;
          arm(keepalive);
          if (handoff) {
            this.socket = socket;
            previous?.close();
          } else {
            for (const type of [
              "channel.chat.message",
              "channel.chat.message_delete",
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
          this.status = "Receiving chat";
        } else if (e.metadata.message_type === "session_reconnect") {
          const s = z
            .object({ reconnect_url: z.string().url() })
            .parse(e.payload.session);
          const u = new URL(s.reconnect_url);
          if (u.protocol !== "wss:" || u.hostname !== "eventsub.wss.twitch.tv")
            throw new Error("Invalid reconnect URL");
          this.connect(s.reconnect_url, true);
        } else if (e.metadata.message_type === "revocation") {
          this.status = "Subscription revoked — needs login";
          this.stopped = true;
          socket.close();
        } else if (e.metadata.message_type === "notification") {
          const subscription = z
            .object({ type: z.string() })
            .parse(e.payload.subscription);
          if (subscription.type === "channel.chat.message") {
            const m = ChatEvent.parse(e.payload.event);
            if (
              m.source_broadcaster_user_id &&
              m.source_broadcaster_user_id !== this.broadcaster
            ) {
              this.status = "Shared Chat unsupported — foreign message skipped";
              return;
            }
            this.app.message({
              id: crypto.randomUUID(),
              sourceId: m.message_id,
              userId: m.chatter_user_id,
              author: m.chatter_user_name,
              text: m.message.text,
              receivedAt: e.metadata.message_timestamp,
              source: "twitch",
              removed: false,
            });
          } else if (subscription.type === "channel.chat.message_delete") {
            const m = z
              .object({ message_id: z.string() })
              .parse(e.payload.event);
            this.app.removeMessage(m.message_id);
          }
        }
      })().catch(() => {
        this.status = "Twitch event or subscription failed";
        socket.close();
      });
    };
    socket.onclose = () => {
      if (this.stopped || this.socket !== socket) return;
      if (this.timer) clearTimeout(this.timer);
      this.status = welcome ? "Chat gap — reconnecting" : "Connection failed";
      this.timer = setTimeout(
        () => this.connect(),
        Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)),
      );
    };
    socket.onerror = () => {
      this.status = "Network error";
    };
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.socket?.close();
  }
  async share(id: string) {
    const dto = this.app.publicReply(id);
    if (!dto) throw new Conflict("Publish an approved reply first.");
    if (dto.fixture)
      throw new Conflict("Fixture replies cannot be sent into Twitch.");
    const base = process.env.PUBLIC_BASE_URL;
    if (!base || !base.startsWith("https://"))
      throw new Conflict(
        "Configure and verify the HTTPS public reader before sharing.",
      );
    const prior = this.app.store
      .list("delivery", Delivery)
      .find((d) => d.publicationId === id);
    if (prior) return prior;
    await this.validate();
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
    } catch {
      attempt.state = "uncertain";
    }
    this.app.store.put("delivery", attempt.id, attempt);
    return attempt;
  }
}
