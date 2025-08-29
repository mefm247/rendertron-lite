// src/utils/http.js
export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
  });
}

export function safeParams(p) {
  const copy = { ...p };
  if (copy.prompt && copy.prompt.length > 120) copy.prompt = copy.prompt.slice(0, 120) + "…";
  if (copy.imageBase64) copy.imageBase64 = `[base64:${copy.imageBase64.length}]`;
  return copy;
}

export function tryParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Extract the largest {...} block if the model returns extra text
export function normalizeToJSONObject(result) {
  if (result && typeof result === "object" && !("raw" in result) && !("error" in result) && !("status" in result)) {
    return result;
  }
  if (typeof result === "string") {
    const direct = tryParseJSON(result);
    if (direct) return direct;
    const start = result.indexOf("{");
    const end = result.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = result.slice(start, end + 1);
      const parsed = tryParseJSON(candidate);
      if (parsed) return parsed;
    }
  }
  return {
    error: "Model did not return valid JSON",
    raw: typeof result === "string" ? result : JSON.stringify(result),
  };
}

// Soft schema cleanup for stability
export function sanitizeSchema(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (!Array.isArray(obj.sections)) obj.sections = [];
  if (typeof obj.page_intent !== "string") obj.page_intent = String(obj.page_intent || "");

  obj.sections = obj.sections.map((sec, i) => {
    const s = sec && typeof sec === "object" ? sec : {};
    if (!s.id) s.id = `sec_${String(i).padStart(3, "0")}`;
    if (!s.type) s.type = "other";
    if (typeof s.section_intent !== "string") s.section_intent = String(s.section_intent || "");
    if (!Array.isArray(s.elements)) s.elements = [];
    s.elements = s.elements.map((el) => {
      const e = el && typeof el === "object" ? el : {};
      if (!e.type) e.type = "TEXT";
      if (typeof e.text !== "string") e.text = e.text == null ? "" : String(e.text);
      if (typeof e.alt !== "string") e.alt = e.alt == null ? "" : String(e.alt);
      if (typeof e.intent !== "string") e.intent = String(e.intent || "");
      return e;
    });
    return s;
  });
  return obj;
}

export function toBase64(uint8) {
  if (!uint8 || typeof uint8.length !== "number") {
    throw new Error("toBase64: invalid input buffer");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  // btoa is available in Workers runtime
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}