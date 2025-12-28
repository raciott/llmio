import type { Pool } from "pg";

export async function modelsByTypes(db: Pool, types: string[]) {
  if (types.length === 0) return [];

  const placeholders = types.map((_, i) => `$${i + 1}`).join(",");
  const providersResult = await db.query<{ id: number }>(
    `SELECT id FROM providers WHERE type IN (${placeholders}) AND deleted_at IS NULL`,
    types
  );
  const providerIds = (providersResult.rows ?? []).map((p) => Number(p.id));
  if (providerIds.length === 0) return [];

  const placeholders2 = providerIds.map((_, i) => `$${i + 1}`).join(",");
  const mpsResult = await db.query<{ model_id: number }>(
    `SELECT DISTINCT model_id FROM model_with_providers WHERE provider_id IN (${placeholders2}) AND deleted_at IS NULL AND status = 1`,
    providerIds
  );
  const modelIds = (mpsResult.rows ?? []).map((mp) => Number(mp.model_id));
  if (modelIds.length === 0) return [];

  const placeholders3 = modelIds.map((_, i) => `$${i + 1}`).join(",");
  const modelsResult = await db.query<{ id: number; name: string; created_at: string }>(
    `SELECT id, name, created_at FROM models WHERE id IN (${placeholders3}) AND deleted_at IS NULL`,
    modelIds
  );
  return modelsResult.rows ?? [];
}
