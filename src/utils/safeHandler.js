// src/utils/safeHandler.js
import { json } from "./http.js";

/**
 * Wrap a route/handler so any thrown error returns a JSON error
 * instead of hanging the request.
 */
export function safeHandler(fn) {
  return async (env, params, tag, rid) => {
    try {
      const res = await fn(env, params, tag, rid);
      // If a handler accidentally returns null/undefined, guard it.
      if (!res) {
        return json({ error: "Handler returned no response" }, 500);
      }
      return res;
    } catch (err) {
      console.error(`[${tag}] Handler error:`, err?.stack || err?.message || String(err));
      return json({ error: err?.message || "Handler failed" }, 500);
    }
  };
}