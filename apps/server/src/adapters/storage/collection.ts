import { existsSync } from "node:fs";
import { join } from "node:path";

// Keep the original ownership lock and collection when upgrading an existing
// installation. Fresh collections use the new name; never silently choose
// between two independent collections or rename an open SQLite/WAL database.
export function creatorDatabase(root: string) {
  const current = join(root, "thatbit.sqlite");
  const legacy = join(root, "replylink.sqlite");
  if (existsSync(current) && existsSync(legacy))
    throw new Error(
      "Two creator collections were found. Stop ThatBit and choose a DATA_DIR containing only the collection you intend to use.",
    );
  return existsSync(legacy) ? legacy : current;
}
