import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { successRaw, internalServerError } from "../common/response.js";
import { StyleOpenAI, StyleOpenAIRes } from "../consts.js";
import { modelsByTypes } from "../services/models.js";
import { chatProxy } from "../services/chat.js";

export const openaiRoutes = new Hono<AppEnv>();

openaiRoutes.get("/v1/models", async (c) => {
  try {
    const models = await modelsByTypes(c.env.db, [StyleOpenAI, StyleOpenAIRes]);
    const data = models.map((m) => ({
      id: m.name,
      object: "model",
      created: Math.floor(new Date(m.created_at).getTime() / 1000),
      owned_by: "llmio",
    }));
    return successRaw(c, { object: "list", data });
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
});

openaiRoutes.post("/v1/chat/completions", async (c) => chatProxy(c, StyleOpenAI));
openaiRoutes.post("/v1/responses", async (c) => chatProxy(c, StyleOpenAIRes));
