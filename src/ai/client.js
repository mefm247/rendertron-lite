// src/ai/client.js
import { ANALYSIS_SCHEMA } from "./schema.js";
import { toBase64 } from "../utils/http.js";

export function buildPromptWithSource(prompt, url) {
  const suffix = url ? `\n\n[Source URL: ${url}]` : "";
  return (prompt || "").trim() + suffix;
}

export function isOpenAIResponsesEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.hostname.includes("api.openai.com") || u.pathname.endsWith("/v1/responses");
  } catch {
    return false;
  }
}

export function extractOpenAIOutput(json, want = "json") {
  if (typeof json?.output_text === "string") {
    if (want === "json") {
      try { return JSON.parse(json.output_text); } catch { return json.output_text; }
    }
    return json.output_text;
  }
  if (Array.isArray(json?.output)) {
    for (const msg of json.output) {
      if (Array.isArray(msg?.content)) {
        for (const c of msg.content) {
          if (c?.type === "output_text" && typeof c.text === "string") {
            if (want === "json") {
              try { return JSON.parse(c.text); } catch { return c.text; }
            }
            return c.text;
          }
          if (typeof c?.text === "string") {
            if (want === "json") {
              try { return JSON.parse(c.text); } catch { return c.text; }
            }
            return c.text;
          }
        }
      }
    }
  }
  return json;
}

export async function postToAI({
  endpoint,
  apiKey,
  prompt,
  url,
  screenshotPng,
  timeoutMs,
  mime = "image/jpeg",
  reqId = "na",
  model = "gpt-4o-mini",
  format = "json",
}) {
  const tag = `postToAI#${reqId}`;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const isOAI = isOpenAIResponsesEndpoint(endpoint);
  const oaiFormatType = format === "json" ? "json_schema" : "text";

  console.log(`[${tag}] provider=${isOAI ? "openai" : "generic"} model=${model} format=${format} -> text.format.type=${oaiFormatType}`);
  console.log(`[${tag}] image bytes=${screenshotPng?.length || 0} mime=${mime} timeout=${timeoutMs}ms`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("AI request timed out"), timeoutMs);

  try {
    let body;
    if (isOAI) {
      body = {
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: `data:${mime};base64,${toBase64(screenshotPng)}` },
              { type: "input_text", text: prompt },
            ],
          },
        ],
        temperature: 0,
        text: {
          format: {
            type: "json_schema",
            name: "WebsiteAnalysisSchema",
            schema: ANALYSIS_SCHEMA,
          },
        },
      };
    } else {
      body = {
        prompt,
        image: { mime, base64: toBase64(screenshotPng) },
      };
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await res.text();
    console.log(`[${tag}] ai.status=${res.status} ai.ok=${res.ok} ai.body.len=${raw.length}`);
    console.log(`[${tag}] ai.body.preview=${raw.slice(0, 300).replace(/\s+/g, " ")}${raw.length > 300 ? " …" : ""}`);

    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      if (!res.ok) return { error: { message: raw || "AI request failed" }, status: res.status };
      return { raw, status: res.status };
    }
    if (!res.ok) return { error: parsed.error || parsed, status: res.status };

    if (isOAI) {
      const want = format === "json" ? "json" : "text";
      return extractOpenAIOutput(parsed, want);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}