// Application port: adapters choose where diagnostics go. Never pass content here.
export type LogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticFields = {
  requestId?: string;
  jobId?: string;
  revisionId?: string;
  publicationId?: string;
  assetId?: string;
  route?: string;
  requestKind?:
    | "favicon"
    | "devtools-probe"
    | "asset"
    | "creator-api"
    | "public-api"
    | "other";
  method?: string;
  status?: number;
  durationMs?: number;
  attempt?: number;
  generation?: number;
  queueDepth?: number;
  count?: number;
  bytes?: number;
  port?: number;
  audioTrack?: number;
  retry?: boolean;
  configured?: boolean;
};
export interface Diagnostics {
  event(
    level: LogLevel,
    event: string,
    fields?: DiagnosticFields,
    error?: unknown,
  ): void;
}
export const quietDiagnostics: Diagnostics = { event() {} };
