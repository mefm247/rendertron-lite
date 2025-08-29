// src/handlers/html.js
import { json, corsHeaders } from "../utils/http.js";
import { logStart, logDone } from "../utils/logging.js";
import { renderPageGetHtml } from "../render/browser.js";

export async function handleHtml(env, params, tag) {
  if (!params.target) return json({ error: "Missing 'target' parameter" }, 400);
  const tHtml = logStart(tag, "output=html START");
  const { html } = await renderPageGetHtml(env, params.target);
  logDone(tag, tHtml, "output=html DONE");
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}