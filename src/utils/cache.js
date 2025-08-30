// src/utils/cache.js
import { json } from "./http.js";

// Simple stable hash (djb2) for small keys
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h = h & 0xffffffff;
  }
  // unsigned
  return (h >>> 0).toString(36);
}

// Build a deterministic cache key based on output + target + key params
export function buildCacheKey(output, params) {
  const allowlist = [
    "target", "viewportWidth", "viewportHeight", "fullPage",
    "imageType", "imageQuality", "waitMs", "selectorToWaitFor",
    "model", "format", "prompt", "includeScreenshot"
  ];
  const base = {};
  for (const k of allowlist) {
    if (params[k] != null) base[k] = String(params[k]);
  }
  const raw = JSON.stringify({ output, ...base });
  const h = hashString(raw);
  // prefix by output for easier namespace browsing
  return `${output}:${h}`;
}

export async function cacheGet(env, key) {
  if (!env.KV_CACHE) return null;
  try {
    return await env.KV_CACHE.get(key);
  } catch (e) {
    console.warn("[cache] get error", e?.message);
    return null;
  }
}

export async function cachePut(env, key, value, ttlSeconds = 600) { // default 10 minutes
  if (!env.KV_CACHE) return;
  try {
    await env.KV_CACHE.put(key, value, { expirationTtl: ttlSeconds });
  } catch (e) {
    console.warn("[cache] put error", e?.message);
  }
}

export async function cacheDeletePrefix(env, prefix) {
  if (!env.KV_CACHE) return { deleted: 0 };
  let cursor = undefined;
  let count = 0;
  do {
    const list = await env.KV_CACHE.list({ prefix, cursor });
    for (const k of list.keys) {
      await env.KV_CACHE.delete(k.name);
      count++;
    }
    cursor = list.cursor;
  } while (cursor);
  return { deleted: count };
}