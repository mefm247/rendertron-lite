// src/handlers/merge.js
import { json, toBase64 } from "../utils/http.js";
import { logStart, logDone, logInfo, now } from "../utils/logging.js";
import { renderPageGetHtml, renderAndScreenshot } from "../render/browser.js";
import { parseHTML } from "../parsers/htmlParser.js";
import { postToAI, buildPromptWithSource } from "../ai/client.js";
import { MERGE_PROMPT, ANALYSIS_SCHEMA } from "../ai/schema.js";
import { sanitizeSchema, normalizeToJSONObject } from "../utils/http.js";

/**
 * merged-structure:
 * - Renders HTML and parses a rough DOM structure (structure)
 * - Captures a screenshot (screenshot)
 * - Runs screenshot analysis to produce a vision-first structure (screenshotandai-describe)
 * - Sends all three to the AI with MERGE_PROMPT to produce a single, strict JSON structure
 */
export async function handleMergedStructure(env, params, tag, rid) {
  if (!env.MYBROWSER) return json({ error: "Missing MYBROWSER binding" }, 500);
  if (!env.AI_ENDPOINT) return json({ error: "Missing AI_ENDPOINT env var" }, 500);
  if (!params.target) return json({ error: "Missing 'target' parameter" }, 400);

  const target = params.target;
  const model = params.model || env.OPENAI_MODEL || "gpt-4o-mini";
  const format = (params.format || "json").toLowerCase();

  // 1) Render and parse HTML to structure
  logInfo(tag, "merged-structure: step 1/4 render HTML");
  const tHtml = now();
  const { html } = await renderPageGetHtml(env, target);
  logDone(tag, tHtml, "HTML rendered");

  const tParse = now();
  const domStructure = parseHTML(html, target);
  logDone(tag, tParse, "DOM structure parsed");

  // 2) Screenshot
  logInfo(tag, "merged-structure: step 2/4 screenshot");
  const viewport = {
    width: parseInt(params.viewportWidth || "1280", 10),
    height: parseInt(params.viewportHeight || "1000", 10),
  };
  const imageType = (params.imageType || "jpeg").toLowerCase();
  const imageQuality = parseInt(params.imageQuality || "60", 10);
  const fullPage = (params.fullPage || "false") === "true";
  const extraWaitMs = parseInt(params.waitMs || "700", 10);

  const tShot = now();
  const shot = await renderAndScreenshot({
    env,
    targetUrl: target,
    viewport,
    extraWaitMs,
    selectorToWaitFor: params.selectorToWaitFor || null,
    imageType,
    imageQuality,
    fullPage,
  });
  logDone(tag, tShot, `Screenshot captured (${shot.mime}, ${shot.data?.length || 0}B)`);

  // 3) Vision structure via AI (screenshotandai-describe style)
  logInfo(tag, "merged-structure: step 3/4 ai vision structure");
  const visionPrompt = params.prompt && params.prompt.trim().length > 0 ? params.prompt : MERGE_PROMPT;
  // Build a prompt that instructs the model to FIRST generate a vision structure,
  // then merge; we pass the DOM structure as context.
  const finalVisionPrompt = buildPromptWithSource(
    visionPrompt
      .replace("{{MODE}}", "vision-only")
      .replace("{{DOM_STRUCTURE_JSON}}", JSON.stringify(domStructure)),
    target
  );

  const tVision = now();
  const visionStructureRaw = await postToAI({
    endpoint: env.AI_ENDPOINT,
    apiKey: env.AI_API_KEY,
    prompt: finalVisionPrompt,
    url: target,
    screenshotPng: shot.data,
    timeoutMs: parseInt(env.AI_TIMEOUT_MS || "60000", 10),
    mime: shot.mime,
    reqId: rid + "-vision",
    model,
    format: "json",
  });
  logDone(tag, tVision, "Vision structure obtained");

  const visionStructure = sanitizeSchema(normalizeToJSONObject(visionStructureRaw));

  // 4) Merge using AI with both structures + screenshot
  logInfo(tag, "merged-structure: step 4/4 merge");
  const mergePrompt = MERGE_PROMPT
    .replace("{{MODE}}", "merge")
    .replace("{{DOM_STRUCTURE_JSON}}", JSON.stringify(domStructure))
    .replace("{{VISION_STRUCTURE_JSON}}", JSON.stringify(visionStructure));

  const tMerge = now();
  const merged = await postToAI({
    endpoint: env.AI_ENDPOINT,
    apiKey: env.AI_API_KEY,
    prompt: buildPromptWithSource(mergePrompt, target),
    url: target,
    screenshotPng: shot.data,
    timeoutMs: parseInt(env.AI_TIMEOUT_MS || "60000", 10),
    mime: shot.mime,
    reqId: rid + "-merge",
    model,
    format: "json",
  });
  logDone(tag, tMerge, "Merged structure obtained");

  const mergedObj = sanitizeSchema(normalizeToJSONObject(merged));

  if (params.includeScreenshot === "true" && shot?.data) {
    mergedObj._screenshot = { mime: shot.mime, base64: toBase64(shot.data) };
  }

  if (params.debug === "true") {
    mergedObj._debug = {
      domStructure,
      visionStructure,
    };
  }

  return json(mergedObj, 200);
}