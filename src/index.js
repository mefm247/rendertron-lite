// src/index.js
import { json, corsHeaders, safeParams, fromBase64, normalizeToJSONObject, sanitizeSchema } from "./utils/http.js";
import { logStart, logDone, logInfo, newReqId } from "./utils/logging.js";
import { SCREENSHOT_ANALYSIS_PROMPT } from "./ai/schema.js";
import { cacheDeletePrefix } from "./utils/cache.js";
import { postToAI, buildPromptWithSource } from "./ai/client.js";

import { handleHtml } from "./handlers/html.js";
import { handleStructure } from "./handlers/structure.js";
import { handleScreenshot } from "./handlers/screenshot.js";
import { handleAiCombined } from "./handlers/aiCombined.js";
import { handleMergedStructure } from "./handlers/merge.js";
import { OUTPUT_MODES } from "./config/constants.js";
import { safeHandler } from "./utils/safeHandler.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const u = new URL(request.url);
    if (u.pathname !== "/analyze") {
      return new Response("Not Found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    const rid = newReqId();
    const tag = `REQ#${rid}`;
    const tReq = logStart(tag, `${request.method} ${u.pathname}${u.search}`);

    try {
      const params = await readParams(request);
      logInfo(tag, `params: ${JSON.stringify(safeParams(params))}`);

      const { output } = params;
      if (!output || !OUTPUT_MODES.includes(output)) {
        return json({ error: `Missing or invalid 'output'. Use one of: ${OUTPUT_MODES.join(" | ")}` }, 400);
      }

      if (output === "html") return await safeHandler(handleHtml)(env, params, tag, rid);
      if (output === "structure") return await safeHandler(handleStructure)(env, params, tag, rid);
      if (output === "screenshot") return await safeHandler(handleScreenshot)(env, params, tag, rid);
      if (output === "ai-describe") {
        if (!env.AI_ENDPOINT) return json({ error: "Missing AI_ENDPOINT env var" }, 500);
        const imgB64 = params.imageBase64;
        const imgMime = params.imageMime || "image/jpeg";
        if (!imgB64) return json({ error: "Missing 'imageBase64' parameter for ai-describe" }, 400);
        let bytes;
        try { bytes = fromBase64(imgB64); } catch { return json({ error: "Invalid imageBase64" }, 400); }
        const model = params.model || env.OPENAI_MODEL || "gpt-4o-mini";
        const format = (params.format || "json").toLowerCase();
        const basePrompt = params.prompt && params.prompt.trim().length > 0 ? params.prompt : SCREENSHOT_ANALYSIS_PROMPT;
        const finalPrompt = buildPromptWithSource(basePrompt, params.target || "");
        try {
          const aiResponse = await postToAI({
            endpoint: env.AI_ENDPOINT,
            apiKey: env.AI_API_KEY,
            prompt: finalPrompt,
            url: params.target || "",
            screenshotPng: bytes,
            timeoutMs: parseInt(env.AI_TIMEOUT_MS || "60000", 10),
            mime: imgMime,
            reqId: rid,
            model,
            format,
          });
          if (format === "json") {
            const obj = sanitizeSchema(normalizeToJSONObject(aiResponse));
            return json(obj, 200);
          }
          return new Response(typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse, null, 2), {
            status: 200,
            headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
          });
        } catch (err) {
          console.error(`[${tag}] ai-describe ERROR`, err?.stack || err?.message || String(err));
          return json({ error: err?.message || "AI describe failed" }, 500);
        }
      }
      if (output === "screenshotandai-describe" || output === "ai") {
        return await safeHandler(handleAiCombined)(env, params, tag, rid);
      }

      if (output === "merged-structure") return await safeHandler(handleMergedStructure)(env, params, tag, rid);

      if (output === "clear-cache") {
        const prefix = (params.prefix || "").trim() || "";
        const pref = prefix ? prefix : "";
        const res = await cacheDeletePrefix(env, pref);
        return json({ ok: true, ...res }, 200);
      }

      return json({ error: "Unhandled output type" }, 400);
    } catch (err) {
      console.error(`[${tag}] ERROR`, err?.stack || err?.message || String(err));
      return json({ error: err?.message || "Unexpected server error" }, 500);
    } finally {
      logDone(tag, tReq, "request DONE");
    }
  },
};

async function readParams(request) {
  const u = new URL(request.url);
  if (request.method === "GET") {
    return {
      output: u.searchParams.get("output"),
      target: u.searchParams.get("target"),
      prompt: u.searchParams.get("prompt"),
      includeScreenshot: u.searchParams.get("includeScreenshot") || "false",
      waitMs: u.searchParams.get("waitMs"),
      viewportWidth: u.searchParams.get("viewportWidth"),
      viewportHeight: u.searchParams.get("viewportHeight"),
      selectorToWaitFor: u.searchParams.get("selectorToWaitFor"),
      imageType: u.searchParams.get("imageType"),
      imageQuality: u.searchParams.get("imageQuality"),
      fullPage: u.searchParams.get("fullPage") ?? "true",
      model: u.searchParams.get("model"),
      format: u.searchParams.get("format"),
      imageBase64: u.searchParams.get("imageBase64"),
      imageMime: u.searchParams.get("imageMime"),
    };
  }
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("POST must be application/json");
    return await request.json();
  }
  throw new Error("Only GET and POST are supported");
}