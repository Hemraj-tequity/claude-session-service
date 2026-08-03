import { StorageClient } from "@supabase/storage-js";
import { config } from "../config/env.js";

// We only need Storage, so we depend on @supabase/storage-js directly
// instead of the full @supabase/supabase-js (which also pulls in
// Auth/Realtime/Postgrest and a WebSocket polyfill we'd never use).
export const storage = new StorageClient(`${config.supabaseUrl}/storage/v1`, {
  apikey: config.supabaseServiceRoleKey,
  Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
});
