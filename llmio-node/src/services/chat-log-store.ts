import type { Pool } from "pg";
import type { ChatLogBase, ChatLogEvent, ChatIO, ChatLogFinalize } from "./chat-log-events.js";

async function upsertChatLogBase(db: Pool, base: ChatLogBase) {
  await db.query(
    `INSERT INTO chat_logs
     (uuid, name, provider_model, provider_name, status, style, user_agent, remote_ip, auth_key_id, chat_io, error, retry, proxy_time_ms, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT(uuid) DO UPDATE SET
       name = EXCLUDED.name,
       provider_model = EXCLUDED.provider_model,
       provider_name = EXCLUDED.provider_name,
       status = EXCLUDED.status,
       style = EXCLUDED.style,
       user_agent = EXCLUDED.user_agent,
       remote_ip = EXCLUDED.remote_ip,
       auth_key_id = EXCLUDED.auth_key_id,
       chat_io = EXCLUDED.chat_io,
       error = EXCLUDED.error,
       retry = EXCLUDED.retry,
       proxy_time_ms = EXCLUDED.proxy_time_ms,
       updated_at = EXCLUDED.updated_at`,
    [
      base.uuid,
      base.name,
      base.provider_model,
      base.provider_name,
      base.status,
      base.style,
      base.user_agent,
      base.remote_ip,
      base.auth_key_id,
      base.chat_io,
      base.error,
      base.retry,
      base.proxy_time_ms,
      base.created_at,
      base.updated_at,
    ]
  );
}

async function updateChatLogFinalize(db: Pool, fin: ChatLogFinalize) {
  await db.query(
    `UPDATE chat_logs
     SET first_chunk_time_ms = $1, chunk_time_ms = $2, tps = $3, size = $4,
         prompt_tokens = $5, completion_tokens = $6, total_tokens = $7, prompt_tokens_details = $8, updated_at = $9
     WHERE uuid = $10 AND deleted_at IS NULL`,
    [
      fin.first_chunk_time_ms,
      fin.chunk_time_ms,
      fin.tps,
      fin.size,
      fin.prompt_tokens,
      fin.completion_tokens,
      fin.total_tokens,
      fin.prompt_tokens_details,
      fin.updated_at,
      fin.uuid,
    ]
  );
}

async function getChatLogIdByUUID(db: Pool, uuid: string): Promise<number | null> {
  const result = await db.query<{ id: number }>(
    "SELECT id FROM chat_logs WHERE uuid = $1 AND deleted_at IS NULL",
    [uuid]
  );
  if (result.rows.length === 0) return null;
  const id = Number(result.rows[0].id);
  return Number.isFinite(id) ? id : null;
}

async function upsertChatIOByUUID(db: Pool, uuid: string, io: ChatIO) {
  const logId = await getChatLogIdByUUID(db, uuid);
  if (!logId) return;

  await db.query(
    `INSERT INTO chat_io
     (log_id, input, output_string, output_string_array, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(log_id) DO UPDATE SET
       input = EXCLUDED.input,
       output_string = EXCLUDED.output_string,
       output_string_array = EXCLUDED.output_string_array,
       updated_at = EXCLUDED.updated_at`,
    [logId, io.input, io.output_string, io.output_string_array, io.created_at, io.updated_at]
  );
}

export async function applyChatLogEventToDb(db: Pool, event: ChatLogEvent) {
  if (event.type === "insert") {
    await upsertChatLogBase(db, event.base);
    return;
  }

  await upsertChatLogBase(db, event.base);
  await updateChatLogFinalize(db, event.finalize);
  if (event.io) await upsertChatIOByUUID(db, event.base.uuid, event.io);
}
