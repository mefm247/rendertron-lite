// src/handlers/structure.js
import { json } from "../utils/http.js";
import { logStart, logDone } from "../utils/logging.js";
import { renderPageGetHtml } from "../render/browser.js";
import { parseHTML } from "../parsers/htmlParser.js";
import { buildCacheKey, cacheGet, cachePut } from "../utils/cache.js";

export async function handleStructure(env, params, tag) {
  // cache: structure get
  const cacheKey = buildCacheKey("structure", params);
  const cached = await cacheGet(env, cacheKey);
  if (cached) {
    return json(JSON.parse(cached), 200);
  }

  if (!params.target) return json({ error: "Missing 'target' parameter" }, 400);
  const tStr = logStart(tag, "output=structure START");
  const { html } = await renderPageGetHtml(env, params.target);
  const structuredData = parseHTML(html, params.target);
  logDone(tag, tStr, "output=structure DONE");

  await cachePut(env, cacheKey, JSON.stringify(structuredData));
  return json(structuredData, 200);
}
