// src/render/rendertron.js
import { logInfo } from "../utils/logging.js";

/**
 * Proxy helper to Rendertron endpoint (if you want to keep that flow separate)
 */
export async function proxyRendertron(targetUrl, endpoint = "https://render-tron.appspot.com/render") {
  const url = `${endpoint}/${encodeURIComponent(targetUrl)}`;
  logInfo("RENDERTRON", `Fetching ${url}`);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Rendertron error ${res.status}`);
  }
  return await res.text();
}