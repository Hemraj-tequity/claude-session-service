import { storage } from "../lib/supabaseClient.js";
import { config } from "../config/env.js";
import { withRetry } from "../lib/retry.js";

// Raw key-level Supabase Storage access - the only file that touches the
// Storage SDK directly.

const LIST_PAGE_SIZE = 100;
// Marker object Storage creates for explicitly-created empty folders; never a real file.
const EMPTY_FOLDER_PLACEHOLDER = ".emptyFolderPlaceholder";

function bucket() {
  return storage.from(config.supabaseStorageBucket);
}

export async function uploadObject(key: string, data: Buffer): Promise<void> {
  await withRetry(
    async () => {
      const { error } = await bucket().upload(key, data, { upsert: true });
      if (error) throw error;
    },
    { label: `objectStorage.upload:${key}` },
  );
}

export async function downloadObject(key: string): Promise<Buffer> {
  return withRetry(
    async () => {
      const { data, error } = await bucket().download(key);
      if (error) throw error;
      return Buffer.from(await data.arrayBuffer());
    },
    { label: `objectStorage.download:${key}` },
  );
}

async function listPage(prefix: string, offset: number) {
  const { data, error } = await bucket().list(prefix, { limit: LIST_PAGE_SIZE, offset });
  if (error) throw error;
  return data;
}

// list what's already saved for a project
export async function listObjectKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let offset = 0;

  for (;;) {
    const page = await withRetry(() => listPage(prefix, offset), {
      label: `objectStorage.list:${prefix}`,
    });

    for (const entry of page) {
      if (entry.name === EMPTY_FOLDER_PLACEHOLDER) continue;
      const entryKey = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        keys.push(...(await listObjectKeys(entryKey)));
      } else {
        keys.push(entryKey);
      }
    }

    if (page.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }

  return keys;
}
