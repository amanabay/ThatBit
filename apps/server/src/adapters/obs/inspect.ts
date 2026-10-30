import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
const Kind = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
class InspectionRequestError extends Error {
  constructor(readonly code: number | undefined) {
    super("OBS rejected a read-only inspection request.");
  }
}
export type ObsInspection = {
  version: string;
  splitSupported: boolean;
  recording: boolean;
  paused: boolean;
  durationMs: number;
  inputKinds: string[];
  visibleSourceKinds: string[];
  windowCaptureAvailable: boolean;
  audioInputs: {
    kind: string;
    muted: boolean;
    volumeMul: number;
    enabledTracks: number[];
  }[];
};
// A separate connection subscribes to no events and issues only these read-only requests.
export async function inspectObs(
  password: string,
  address = "ws://127.0.0.1:4455",
): Promise<ObsInspection> {
  const url = new URL(address);
  if (
    url.protocol !== "ws:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("OBS inspection requires a loopback WebSocket.");
  const socket = new WebSocket(address);
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const request = (
    requestType: string,
    requestData: Record<string, unknown> = {},
  ) =>
    new Promise<unknown>((resolve, reject) => {
      const requestId = randomUUID();
      pending.set(requestId, { resolve, reject });
      socket.send(
        JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }),
      );
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<ObsInspection>((resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "OBS inspection timed out. Check the authenticated WebSocket on port 4455.",
            ),
          ),
        8000,
      );
      socket.onerror = () =>
        reject(
          new Error(
            "OBS is unreachable. Open OBS and enable its authenticated WebSocket.",
          ),
        );
      socket.onclose = () => {
        const error = new Error(
          "OBS closed the inspection connection. Check authentication.",
        );
        for (const p of pending.values()) p.reject(error);
        pending.clear();
        reject(error);
      };
      socket.onmessage = (event) => {
        try {
          const packet = z
            .object({ op: z.number(), d: z.record(z.string(), z.unknown()) })
            .parse(JSON.parse(String(event.data)));
          if (packet.op === 0) {
            const hello = z
              .object({
                authentication: z
                  .object({ salt: z.string(), challenge: z.string() })
                  .optional(),
              })
              .parse(packet.d);
            const hash = (value: string) =>
              createHash("sha256").update(value).digest("base64");
            socket.send(
              JSON.stringify({
                op: 1,
                d: {
                  rpcVersion: 1,
                  eventSubscriptions: 0,
                  ...(hello.authentication
                    ? {
                        authentication: hash(
                          hash(password + hello.authentication.salt) +
                            hello.authentication.challenge,
                        ),
                      }
                    : {}),
                },
              }),
            );
          } else if (packet.op === 2) {
            void (async () => {
              const version = z
                .object({
                  obsVersion: z.string().regex(/^[a-zA-Z0-9.+_-]{1,60}$/),
                  availableRequests: z.array(z.string()),
                })
                .parse(await request("GetVersion"));
              const status = z
                .object({
                  outputActive: z.boolean(),
                  outputPaused: z.boolean(),
                  outputDuration: z.number().nonnegative(),
                })
                .parse(await request("GetRecordStatus"));
              const kinds = z
                .object({ inputKinds: z.array(Kind) })
                .parse(await request("GetInputKindList"));
              const inputs = z
                .object({
                  inputs: z
                    .array(z.object({ inputKind: Kind, inputName: z.string() }))
                    .max(64),
                })
                .parse(await request("GetInputList"));
              const audioInputs: ObsInspection["audioInputs"] = [];
              for (const input of inputs.inputs) {
                const data = { inputName: input.inputName };
                let mute: unknown;
                try {
                  mute = await request("GetInputMute", data);
                } catch (error) {
                  // GetInputMute uses InvalidResourceState for a video-only input.
                  // Other failures remain visible, never an invented healthy mix.
                  if (
                    error instanceof InspectionRequestError &&
                    error.code === 604
                  )
                    continue;
                  throw error;
                }
                const { inputMuted } = z
                  .object({ inputMuted: z.boolean() })
                  .parse(mute);
                const { inputVolumeMul } = z
                  .object({ inputVolumeMul: z.number().nonnegative().finite() })
                  .parse(await request("GetInputVolume", data));
                const { inputAudioTracks } = z
                  .object({
                    inputAudioTracks: z.record(
                      z.string().regex(/^[1-6]$/),
                      z.boolean(),
                    ),
                  })
                  .parse(await request("GetInputAudioTracks", data));
                audioInputs.push({
                  kind: input.inputKind,
                  muted: inputMuted,
                  volumeMul: inputVolumeMul,
                  enabledTracks: Object.entries(inputAudioTracks)
                    .filter(([, enabled]) => enabled)
                    .map(([track]) => Number(track)),
                });
              }
              const program = z
                .object({
                  sceneName: z.string().optional(),
                  currentProgramSceneName: z.string().optional(),
                })
                .parse(await request("GetCurrentProgramScene"));
              const sceneName =
                program.sceneName ?? program.currentProgramSceneName;
              if (!sceneName)
                throw new Error("OBS returned an invalid inspection response.");
              const scene = z
                .object({
                  sceneItems: z.array(
                    z.object({
                      inputKind: Kind.nullable().optional(),
                      sceneItemEnabled: z.boolean(),
                    }),
                  ),
                })
                .parse(
                  await request("GetSceneItemList", {
                    sceneName,
                  }),
                );
              return {
                version: version.obsVersion,
                splitSupported:
                  version.availableRequests.includes("SplitRecordFile"),
                recording: status.outputActive,
                paused: status.outputPaused,
                durationMs: status.outputDuration,
                inputKinds: inputs.inputs.map((i) => i.inputKind),
                visibleSourceKinds: scene.sceneItems
                  .filter((i) => i.sceneItemEnabled && i.inputKind)
                  .map((i) => i.inputKind!),
                windowCaptureAvailable: kinds.inputKinds.some(
                  (k) => k.includes("pipewire") && k.includes("window"),
                ),
                audioInputs,
              };
            })().then(resolve, reject);
          } else if (packet.op === 7) {
            const response = z
              .object({
                requestId: z.string(),
                requestStatus: z.object({
                  result: z.boolean(),
                  code: z.number().optional(),
                }),
                responseData: z.unknown().optional(),
              })
              .parse(packet.d);
            const p = pending.get(response.requestId);
            pending.delete(response.requestId);
            if (response.requestStatus.result)
              p?.resolve(response.responseData);
            else
              p?.reject(
                new InspectionRequestError(response.requestStatus.code),
              );
          }
        } catch {
          reject(new Error("OBS returned an invalid inspection response."));
        }
      };
    });
  } finally {
    if (timer) clearTimeout(timer);
    socket.close();
  }
}
