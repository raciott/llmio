import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { successRaw, internalServerError, errorWithHttpStatus } from "../common/response.js";
import { StyleAnthropic } from "../consts.js";
import { modelsByTypes } from "../services/models.js";
import { chatProxy, countTokensProxy } from "../services/chat.js";

export const anthropicRoutes = new Hono<AppEnv>();

anthropicRoutes.post("/api/event_logging/batch", (c) => c.body(null, 404));

anthropicRoutes.get("/v1/models", async (c) => {
  try {
    const models = await modelsByTypes(c.env.db, [StyleAnthropic]);
    const data = models.map((m) => ({
      id: m.name,
      created_at: m.created_at,
      display_name: m.name,
      type: "model",
    }));
    return successRaw(c, { data, has_more: false });
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
});

anthropicRoutes.post("/v1/messages", async (c) => chatProxy(c, StyleAnthropic));

anthropicRoutes.post("/v1/messages/count_tokens", async (c) => {
  try {
    return await countTokensProxy(c);
  } catch (e) {
    return errorWithHttpStatus(c, 500, 500, (e as Error).message);
  }
});
