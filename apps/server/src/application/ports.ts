import type { z } from "zod";
import type { Asset, Revision } from "../../../../shared/contracts/models.ts";
export interface Store {
  get<T>(kind: string, id: string, schema: z.ZodType<T>): T | undefined;
  list<T>(kind: string, schema: z.ZodType<T>): T[];
  put(kind: string, id: string, value: unknown): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}
export interface Media {
  ingest(bytes: Buffer, fixture: boolean): Promise<Asset>;
  render(revision: Revision, publicationId: string): Promise<void>;
  exists(id: string): boolean;
  source(id: string): string;
  derived(id: string, kind: "video" | "portrait"): string;
  portrait(
    revision: Revision,
    publicationId: string,
    author: string,
    message: string,
  ): Promise<void>;
}
