// src/handlers/screenshot.js
import { json } from "../utils/http.js";
import { logStart, logDone, logInfo, now } from "../utils/logging.js";
import { renderAndScreenshot } from "../render/browser.js";

export async function handleScreenshot(env, params, tag) {
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
  return new Response(shot.data, {
    status: 200,
    headers: {
      "Content-Type": shot.mime,
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}