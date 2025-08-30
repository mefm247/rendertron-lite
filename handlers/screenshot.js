// src/handlers/screenshot.js
import { json, toBase64 } from "../utils/http.js";
import { logStart, logDone } from "../utils/logging.js";
import { renderAndScreenshot } from "../render/browser.js";
import { buildCacheKey, cacheGet, cachePut } from "../utils/cache.js";

export async function handleScreenshot(env, params, tag) {
  // cache: screenshot get
  const cacheKey = buildCacheKey("screenshot", params);
  const cached = await cacheGet(env, cacheKey);
  if (cached) {
    const mime = (params.imageType || "jpeg").toLowerCase() === "png" ? "image/png" : "image/jpeg";
    const bytes = Uint8Array.from(atob(cached), c => c.charCodeAt(0));
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (!env.MYBROWSER) return json({ error: "Missing MYBROWSER binding" }, 500);
  if (!params.target) return json({ error: "Missing 'target' parameter" }, 400);

  const tAll = logStart(tag, "output=screenshot");
  const viewport = {
    width: parseInt(params.viewportWidth || "1280", 10),
    height: parseInt(params.viewportHeight || "1000", 10),
  };
  const imageType = (params.imageType || "jpeg").toLowerCase();
  const imageQuality = parseInt(params.imageQuality || "60", 10);
  const fullPage = (params.fullPage || "false") === "true";
  const extraWaitMs = parseInt(params.waitMs || "700", 10);

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

  logDone(tag, tAll, `output=screenshot DONE size=${shot.data?.length || 0}B`);

  // cache put screenshot (as base64)
  try { await cachePut(env, cacheKey, toBase64(shot.data)); } catch {}

  return new Response(shot.data, {
    status: 200,
    headers: {
      "Content-Type": shot.mime,
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
