import { z } from "zod";
import { setTimeout as wait } from "node:timers/promises";
export const Token = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});
export const READ_SCOPE = "user:read:chat";
export const WRITE_SCOPE = "user:write:chat";
export class TwitchLoginError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const Device = z.object({
  device_code: z.string().min(1),
  user_code: z.string().regex(/^[a-zA-Z0-9-]{4,40}$/),
  verification_uri: z.string().url(),
  expires_in: z.number().int().positive().max(3600),
  interval: z.number().int().positive().max(60).default(5),
});
export type DeviceLogin = z.infer<typeof Device> & {
  expiresAt: number;
  scopes: string;
};
const fail = (code: string, message: string): never => {
  throw new TwitchLoginError(code, message);
};
export async function beginDeviceLogin(
  clientId: string,
  sharing = false,
  request: typeof fetch = fetch,
  now = Date.now,
): Promise<DeviceLogin> {
  const scopes = sharing ? `${READ_SCOPE} ${WRITE_SCOPE}` : READ_SCOPE;
  const response = await request("https://id.twitch.tv/oauth2/device", {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId, scopes }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    fail(
      "TWITCH_DEVICE_REJECTED",
      "Twitch rejected device login. Check TWITCH_CLIENT_ID and that the registered application's Client Type is Public.",
    );
  const parsed = Device.safeParse(await response.json());
  if (!parsed.success)
    return fail(
      "TWITCH_DEVICE_INVALID",
      "Twitch returned an invalid login response. Retry device login.",
    );
  const device = parsed.data;
  const url = new URL(device.verification_uri);
  if (
    url.protocol !== "https:" ||
    !["www.twitch.tv", "twitch.tv"].includes(url.hostname) ||
    url.pathname !== "/activate" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    fail(
      "TWITCH_ACTIVATION_INVALID",
      "Twitch returned an unexpected activation address. Login stopped.",
    );
  return { ...device, scopes, expiresAt: now() + device.expires_in * 1000 };
}
export async function finishDeviceLogin(
  clientId: string,
  device: DeviceLogin,
  dependencies: {
    request?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const request = dependencies.request ?? fetch,
    now = dependencies.now ?? Date.now,
    sleep =
      dependencies.sleep ??
      (async (ms) => {
        await wait(ms);
      });
  let interval = device.interval;
  while (now() < device.expiresAt) {
    await sleep(Math.min(interval * 1000, device.expiresAt - now()));
    if (now() >= device.expiresAt) break;
    const response = await request("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: clientId,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        scopes: device.scopes,
      }),
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(10000, device.expiresAt - now())),
      ),
    });
    if (now() >= device.expiresAt) break;
    if (response.ok) {
      const token = Token.safeParse(await response.json());
      if (!token.success)
        return fail(
          "TWITCH_TOKEN_INVALID",
          "Twitch returned incomplete credentials. No login was saved; retry login.",
        );
      return token.data;
    }
    if (response.status === 429) {
      interval = Math.min(interval + 5, 60);
      continue;
    }
    const result = z
      .object({ message: z.string().optional(), error: z.string().optional() })
      .safeParse(await response.json());
    const code = result.success
      ? (result.data.message ?? result.data.error)
      : undefined;
    if (response.status === 400 && code === "authorization_pending") continue;
    if (response.status === 400 && code === "slow_down") {
      interval = Math.min(interval + 5, 60);
      continue;
    }
    if (code === "access_denied")
      fail(
        "TWITCH_LOGIN_DENIED",
        "Twitch login was declined. Run npm run twitch:login when you are ready to authorize chat intake.",
      );
    if (["expired_token", "invalid device code"].includes(code ?? "")) break;
    fail(
      "TWITCH_LOGIN_REJECTED",
      "Twitch rejected authorization. Check the public app configuration and restart npm run twitch:login.",
    );
  }
  return fail(
    "TWITCH_LOGIN_EXPIRED",
    "The Twitch login code expired. No login was saved; run npm run twitch:login again.",
  );
}
export async function verifyLogin(
  token: z.infer<typeof Token>,
  clientId: string,
  channel: string,
  scopes: string,
  request: typeof fetch = fetch,
) {
  const response = await request("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token.access_token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    fail(
      "TWITCH_TOKEN_REJECTED",
      "Twitch could not validate this login. Retry authorization.",
    );
  const identity = z
    .object({
      client_id: z.string(),
      user_id: z.string().min(1),
      scopes: z.array(z.string()),
    })
    .safeParse(await response.json());
  if (!identity.success)
    return fail(
      "TWITCH_LOGIN_MISMATCH",
      "Twitch returned an invalid identity. Retry authorization.",
    );
  if (
    identity.data.client_id !== clientId ||
    !scopes.split(" ").every((s) => identity.data.scopes.includes(s))
  )
    fail(
      "TWITCH_LOGIN_MISMATCH",
      "This login does not match the registered app or requested permissions. Retry authorization.",
    );
  const users = await request(
    "https://api.twitch.tv/helix/users?login=" + encodeURIComponent(channel),
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Client-Id": clientId,
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!users.ok)
    fail(
      "TWITCH_CHANNEL_LOOKUP_FAILED",
      "Twitch channel lookup failed. Check TWITCH_CHANNEL and retry.",
    );
  const channels = z
    .object({ data: z.array(z.object({ id: z.string() })) })
    .safeParse(await users.json());
  if (!channels.success || channels.data.data[0]?.id !== identity.data.user_id)
    fail(
      "TWITCH_CHANNEL_MISMATCH",
      "Sign in with the account that owns TWITCH_CHANNEL. This release connects only your own channel; no login was saved.",
    );
}
