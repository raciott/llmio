import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { successRaw, internalServerError, badRequest } from "../common/response.js";
import { StyleGemini } from "../consts.js";
import { modelsByTypes } from "../services/models.js";
import { chatProxyGemini } from "../services/chat.js";

export const geminiRoutes = new Hono<AppEnv>();

geminiRoutes.get("/v1beta/models", async (c) => {
  try {
    const models = await modelsByTypes(c.env.db, [StyleGemini]);
    const resModels = models.map((m) => ({
      name: `models/${m.name}`,
      displayName: m.name,
      supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    }));
    return successRaw(c, { models: resModels });
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
});

// 兼容 Go 版：POST /v1beta/models/{model}:generateContent 与 streamGenerateContent（通配）
geminiRoutes.post("/v1beta/models/*", async (c) => {
  const path = c.req.path;
  const marker = "/v1beta/models/";
  const idx = path.indexOf(marker);
  const modelAction = idx >= 0 ? path.slice(idx + marker.length) : "";
  const [model, method] = modelAction.split(":");
  if (!model || !method) return badRequest(c, "Invalid Gemini model action");
  if (method !== "generateContent" && method !== "streamGenerateContent") return badRequest(c, `Unsupported Gemini method: ${method}`);
  return chatProxyGemini(c, method === "streamGenerateContent", model);
});
