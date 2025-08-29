// src/handlers/aiCombined.js
import { json, corsHeaders, toBase64 } from "../utils/http.js";
import { logStart, logDone, logInfo, now } from "../utils/logging.js";
import { renderAndScreenshot } from "../render/browser.js";
import { SCREENSHOT_ANALYSIS_PROMPT } from "../ai/schema.js";
import { postToAI, buildPromptWithSource } from "../ai/client.js";
import { sanitizeSchema, normalizeToJSONObject } from "../utils/http.js";

export async function handleAiCombined(env, params, tag, rid) {
  if (!env.MYBROWSER) return json({ error: "Missing MYBROWSER binding" }, 500);
  if (!env.AI_ENDPOINT) return json({ error: "Missing AI_ENDPOINT env var" }, 500);
  if (!params.target) return json({ error: "Missing 'target' parameter" }, 400);

  const tAll = logStart(tag, "output=screenshotandai-describe");
  const viewport = {
    width: parseInt(params.viewportWidth || "1024", 10),
    height: parseInt(params.viewportHeight || "768", 10),
  };
  const imageType = (params.imageType || "jpeg").toLowerCase();
  const imageQuality = parseInt(params.imageQuality || "60", 10);
  const fullPage = (params.fullPage || "false") === "true";
  const extraWaitMs = parseInt(params.waitMs || "700", 10);

  logInfo(tag, "Step 1: Screenshot capture START");
  const tShot = now();
  const shot = await renderAndScreenshot({
    env,
    targetUrl: params.target,
    viewport,
    extraWaitMs,
    selectorToWaitFor: params.selectorToWaitFor || null,
    imageType,
    imageQuality,
    fullPage,
  });
  logDone(tag, tShot, `Screenshot captured mime=${shot.mime} size=${shot.data?.length || 0}B`);

  const model = params.model || env.OPENAI_MODEL || "gpt-4o-mini";
  const format = (params.format || "json").toLowerCase();
  const basePrompt = params.prompt && params.prompt.trim().length > 0 ? params.prompt : SCREENSHOT_ANALYSIS_PROMPT;
  const finalPrompt = buildPromptWithSource(basePrompt, params.target);

  logInfo(tag, `Step 2: AI call START endpoint=${env.AI_ENDPOINT} model=${model} format=${format}`);
  const tAI = now();
  const aiResponse = await postToAI({
    endpoint: env.AI_ENDPOINT,
    apiKey: env.AI_API_KEY,
    prompt: finalPrompt,
    url: params.target,
    screenshotPng: shot.data,
    timeoutMs: parseInt(env.AI_TIMEOUT_MS || "60000", 10),
    mime: shot.mime,
    reqId: rid,
    model,
    format,
  });
  logDone(tag, tAI, "AI call DONE");
  logDone(tag, tAll, "output=screenshotandai-describe DONE");

  if (format === "json") {
    const obj = sanitizeSchema(normalizeToJSONObject(aiResponse));
    if (params.includeScreenshot === "true" && shot?.data) {
      obj._screenshot = { mime: shot.mime, base64: toBase64(shot.data) };
    }
    return json(obj, 200);
  }

  return new Response(typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse, null, 2), {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type":
        typeof aiResponse === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    },
  });
}