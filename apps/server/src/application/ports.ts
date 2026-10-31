import type { z } from "zod";
import type {
  Asset,
  Revision,
  Message,
} from "../../../../shared/contracts/models.ts";
import type {
  InboxQuery,
  InboxPage,
} from "../../../../shared/contracts/inbox.ts";
export interface Store {
  get<T>(kind: string, id: string, schema: z.ZodType<T>): T | undefined;
  list<T>(kind: string, schema: z.ZodType<T>): T[];
  inbox(query: InboxQuery): InboxPage;
  messageBySource(
    source: Message["source"],
    sourceId: string,
  ): Message | undefined;
  latestRevision(draftId: string): Revision | undefined;
  latestRevisions(): Revision[];
  put(kind: string, id: string, value: unknown): void;
  transaction<T>(fn: () => T): T;
  delete(kind: string, id: string): void;
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
