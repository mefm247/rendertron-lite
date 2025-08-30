// src/handlers/html.js
import { json, corsHeaders } from "../utils/http.js";
import { logStart, logDone } from "../utils/logging.js";
import { renderPageGetHtml } from "../render/browser.js";
import { buildCacheKey, cacheGet, cachePut } from "../utils/cache.js";

export async function handleHtml(env, params, tag) {
  // cache: html get
  const cacheKey = buildCacheKey("html", params);
  const cached = await cacheGet(env, cacheKey);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (!params.target) return json({ error: "Missing 'target' parameter" }, 400);
  const tHtml = logStart(tag, "output=html START");
  const { html } = await renderPageGetHtml(env, params.target);
  logDone(tag, tHtml, "output=html DONE");

  // cache put html
  await cachePut(env, cacheKey, html);

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
