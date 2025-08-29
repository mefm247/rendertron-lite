import puppeteer from "@cloudflare/puppeteer";

/**
 * Env variables:
 * - MYBROWSER                 Cloudflare Browser Rendering binding
 * - AI_ENDPOINT               AI HTTP endpoint (e.g., https://api.openai.com/v1/responses)
 * - AI_API_KEY                Optional. Sent as Bearer token if present
 * - AI_TIMEOUT_MS             Optional. Default 60000 (60s)
 * - OPENAI_MODEL              Optional. Default "gpt-4o-mini"
 *
 * Query or POST JSON fields:
 * Common:
 * - output            "html" | "structure" | "ai" | "screenshot" | "ai-describe" | "screenshotandai-describe"  (required)
 * - target            URL to load (required for render-based outputs)
 *
 * AI-related:
 * - prompt            Optional. Overrides default SCREENSHOT_ANALYSIS_PROMPT
 * - format            "json" | "text" (default "json")
 * - model             Model name (default env.OPENAI_MODEL or "gpt-4o-mini")
 * - includeScreenshot "true" to attach screenshot in JSON result for combined flow
 *
 * Screenshot controls (used by render-based flows):
 * - waitMs            Optional. Extra wait after render. Default 700
 * - viewportWidth     Optional. Default 1024
 * - viewportHeight    Optional. Default 768
 * - selectorToWaitFor Optional. CSS selector to wait for
 * - imageType         "jpeg" (default) | "png"
 * - imageQuality      JPEG quality 1-100. Default 60
 * - fullPage          "true" | "false". Default "false"
 *
 * For ai-describe (no render step):
 * - imageBase64       Base64 string of the image (required)
 * - imageMime         Optional mime, defaults to "image/jpeg"
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------- LOGGING HELPERS --------------------- */
function now() {
  return Date.now();
}
function ms(since) {
  return `${Date.now() - since}ms`;
}
function logStart(tag, msg = "") {
  console.log(`[${tag}] START ${msg}`);
  return now();
}
function logDone(tag, startedAt, msg = "") {
  console.log(`[${tag}] DONE in ${ms(startedAt)} ${msg}`);
}
function logInfo(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}
function newReqId() {
  return Math.random().toString(36).slice(2, 8);
}

/* --------------------- STRICT JSON PROMPT --------------------- */
const SCREENSHOT_ANALYSIS_PROMPT = `You are an expert in visual-to-structure translation for websites.
You will be given a screenshot of a webpage.
Your job is to analyze the screenshot and output a strictly valid JSON object
that conforms exactly to the schema below.

=== Required Output Schema ===
{
  "page_intent": "string, required. Full description of the page’s overall communication strategy, emotional tone, target audience, and primary conversion goal.",
  "sections": [
    {
      "id": "string, required unique identifier (e.g., sec_header, sec_hero, sec_001, ...)",
      "type": "string, one of: 'header' | 'hero' | 'content' | 'sidebar' | 'footer' | 'other'",
      "section_intent": "string, required. Purpose of this section as a whole.",
      "elements": [
        {
          "type": "string, one of: 'LOGO' | 'HEADING' | 'TEXT' | 'IMAGE' | 'BUTTON' | 'LINK' | 'VIDEO' | 'FORM' | 'INPUT' | 'LIST' | 'LIST_ITEM'",
          "text": "string, exact visible text if present, else empty string. Preserve the original language, accents, punctuation, and casing.",
          "alt": "string, literal description if visual (photo, icon, illustration, flag, social media icon, etc.), else empty string",
          "intent": "string, required. Why this element exists / how it affects the user"
        }
      ]
    }
  ]
}

=== Strict Rules ===
1. Always include "page_intent".
2. Each visually distinct block (separated by background color, spacing, or layout) must be a separate section. Do not merge unrelated blocks.
3. Every visible text must be a TEXT element: headings, subheadings, slogans, labels under numbers, captions under images, names, disclaimers, addresses, emails, credits, copyright, donation text.
4. Every number/statistic must be split into two TEXT elements: one for the number, one for the descriptive label. If multiple stat groups appear in different blocks, create a separate section for each.
5. Every button, call-to-action, or clearly interactive element must be a BUTTON element (even if styled as a link).
6. Every visual element must be an IMAGE element: logos, portraits, product shots, icons, illustrations, decorative graphics, social media icons. Do not replace icons with LINK text — always treat them as IMAGE elements with descriptive alt.
7. If a person, item, or card has both an image and associated text (name, role, quote), capture each separately within the same section.
8. Repeated patterns (cards, lists, testimonials, grids) must be fully enumerated. Do not collapse, summarize, or merge them.
9. Required minimums:
   - Header section: must include LOGO (if visible) + all navigation LINKs + any BUTTON CTAs.
   - Hero section: must include main headline, any subheading, all BUTTON/LINK CTAs, and the primary IMAGE/VIDEO if present.
   - Statistics: each block must be a distinct section; do not merge across differently styled backgrounds.
   - Footer: must include all visible items — navigation, contact details, address, emails, social icons, credits, and legal text.
10. Do not invent content. Only include elements visibly present in the screenshot.
11. Output must be strictly valid JSON following the schema, with no extra commentary.
12. Be exhaustive: if something is visible, it must appear in the JSON.

=== Example (short) ===
{
  "page_intent": "Establish credibility with business users and drive sign-ups.",
  "sections": [
    {
      "id": "sec_header",
      "type": "header",
      "section_intent": "Provide brand identity and navigation.",
      "elements": [
        { "type": "LOGO", "text": "", "alt": "Company logo", "intent": "Brand recognition" },
        { "type": "LINK", "text": "Pricing", "alt": "", "intent": "Navigate to pricing page" },
        { "type": "BUTTON", "text": "Sign up", "alt": "", "intent": "Primary call-to-action" }
      ]
    }
  ]
}

=== Final Self-Check ===
Before finalizing, verify that:
- Every visually distinct block is represented as a section.
- All visible text, numbers (with labels), buttons, and images/icons are included.
- Repeated items are fully enumerated (not merged or summarized).
- Header and hero contain their required elements.
- Statistics are not merged across blocks.
- Footer includes all visible details (links, contacts, social icons, credits).
- The output is strictly valid JSON with no extra commentary.
`;




// JSON Schema for enforcing AI output
const ANALYSIS_SCHEMA = {
  type: "object",
  required: ["page_intent", "sections"],
  additionalProperties: false,
  properties: {
    page_intent: {
      type: "string",
      minLength: 5,
      description:
        "Full description of the page’s overall communication strategy, emotional tone, target audience, and primary conversion goal.",
    },
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "type", "section_intent", "elements"],
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          type: {
            type: "string",
            enum: ["header", "hero", "content", "sidebar", "footer", "other"],
          },
          section_intent: { type: "string", minLength: 3 },
          elements: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["type", "text", "alt", "intent"],
              additionalProperties: false,
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "LOGO",
                    "HEADING",
                    "TEXT",
                    "IMAGE",
                    "BUTTON",
                    "LINK",
                    "VIDEO",
                    "FORM",
                    "INPUT",
                    "LIST",
                    "LIST_ITEM",
                  ],
                },
                text: { type: "string" },
                alt: { type: "string" },
                intent: { type: "string", minLength: 3 },
              },
            },
          },
        },
      },
    },
  },
};

/* --------------------- FETCH HANDLER --------------------- */
export default {
  async fetch(request, env) {
    // CORS / preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const u = new URL(request.url);
    if (u.pathname !== "/analyze") {
      return new Response("Not Found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    const rid = newReqId();
    const tag = `REQ#${rid}`;
    const tReq = logStart(tag, `${request.method} ${u.pathname}${u.search}`);

    try {
      const params = await readParams(request);
      logInfo(tag, `params: ${JSON.stringify(safeParams(params))}`);

      const { output, target } = params;
      const allowed = ["html", "structure", "ai", "screenshot", "ai-describe", "screenshotandai-describe"];
      if (!output || !allowed.includes(output)) {
        return json({ error: `Missing or invalid 'output'. Use one of: ${allowed.join(" | ")}` }, 400);
      }

      /* ---------------- html ---------------- */
      if (output === "html") {
        if (!target) return json({ error: "Missing 'target' parameter" }, 400);
        logInfo(tag, "output=html START");
        const tHtml = now();
        const { html } = await renderPageGetHtml(env, target);
        logDone(tag, tHtml, "output=html DONE");
        logDone(tag, tReq, "request DONE");
        return new Response(html, {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        });
      }

      /* ---------------- structure ---------------- */
      if (output === "structure") {
        if (!target) return json({ error: "Missing 'target' parameter" }, 400);
        logInfo(tag, "output=structure START");
        const tStr = now();
        const { html } = await renderPageGetHtml(env, target);
        const structuredData = parseHTML(html, target);
        logDone(tag, tStr, "output=structure DONE");
        logDone(tag, tReq, "request DONE");
        return json(structuredData, 200);
      }

      /* ---------------- screenshot ---------------- */
      if (output === "screenshot") {
        if (!env.MYBROWSER) return json({ error: "Missing MYBROWSER binding" }, 500);
        if (!target) return json({ error: "Missing 'target' parameter" }, 400);

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
          targetUrl: target,
          viewport,
          extraWaitMs,
          selectorToWaitFor: params.selectorToWaitFor || null,
          imageType,
          imageQuality,
          fullPage,
        });

        logDone(tag, tAll, `output=screenshot DONE size=${shot.data?.length || 0}B`);
        logDone(tag, tReq, "request DONE");

        return new Response(shot.data, {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": shot.mime,
            "Cache-Control": "public, max-age=60",
          },
        });
      }

      /* ---------------- ai-describe ---------------- */
      if (output === "ai-describe") {
        if (!env.AI_ENDPOINT) return json({ error: "Missing AI_ENDPOINT env var" }, 500);
        // No render here: expect image from caller
        const imgB64 = params.imageBase64;
        const imgMime = params.imageMime || "image/jpeg";
        if (!imgB64) {
          return json(
            {
              error: "Missing 'imageBase64' parameter for ai-describe",
              hint: "First call output=screenshot, then pass its base64 here.",
            },
            400
          );
        }
        let bytes;
        try {
          bytes = fromBase64(imgB64);
        } catch {
          return json({ error: "Invalid imageBase64 (not base64?)" }, 400);
        }

        const model = params.model || env.OPENAI_MODEL || "gpt-4o-mini";
        const format = (params.format || "json").toLowerCase();
        const basePrompt =
          params.prompt && params.prompt.trim().length > 0 ? params.prompt : SCREENSHOT_ANALYSIS_PROMPT;
        const finalPrompt = buildPromptWithSource(basePrompt, params.target || "");

        const tAI = logStart(tag, `output=ai-describe model=${model} format=${format}`);
        const aiResponse = await postToAI({
          endpoint: env.AI_ENDPOINT,
          apiKey: env.AI_API_KEY,
          prompt: finalPrompt,
          url: params.target || "",
          screenshotPng: bytes,
          timeoutMs: parseInt(env.AI_TIMEOUT_MS || "60000", 10),
          mime: imgMime,
          reqId: rid,
          model,
          format,
        });
        logDone(tag, tAI, "ai-describe DONE");
        logDone(tag, tReq, "request DONE");

        if (format === "json") {
          const obj = sanitizeSchema(normalizeToJSONObject(aiResponse));
          return json(obj, 200);
        }
        return new Response(typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse, null, 2), {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type":
              typeof aiResponse === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
          },
        });
      }

      /* ---------------- screenshotandai-describe ---------------- */
      if (output === "screenshotandai-describe" || output === "ai") {
        if (!env.MYBROWSER) return json({ error: "Missing MYBROWSER binding" }, 500);
        if (!env.AI_ENDPOINT) return json({ error: "Missing AI_ENDPOINT env var" }, 500);
        if (!target) return json({ error: "Missing 'target' parameter" }, 400);

        const tAll = logStart(tag, "output=screenshotandai-describe");
        // 1) Screenshot
        const viewport = {
          width: parseInt(params.viewportWidth || "1024", 10),
          height: parseInt(params.viewportHeight || "768", 10),
        };
        const imageType = (params.imageType || "jpeg").toLowerCase();
        const imageQuality = parseInt(params.imageQuality || "60", 10);
        const fullPage = (params.fullPage || "false") === "true";
        const extraWaitMs = parseInt(params.waitMs || "700", 10);

        logInfo(tag, "Step 1: Screenshot capture START");
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
        logDone(tag, tShot, `Screenshot captured mime=${shot.mime} size=${shot.data?.length || 0}B`);

        // 2) AI
        const model = params.model || env.OPENAI_MODEL || "gpt-4o-mini";
        const format = (params.format || "json").toLowerCase();
        const basePrompt =
          params.prompt && params.prompt.trim().length > 0 ? params.prompt : SCREENSHOT_ANALYSIS_PROMPT;
        const finalPrompt = buildPromptWithSource(basePrompt, target);

        logInfo(tag, `Step 2: AI call START endpoint=${env.AI_ENDPOINT} model=${model} format=${format}`);
        const tAI = now();
        const aiResponse = await postToAI({
          endpoint: env.AI_ENDPOINT,
          apiKey: env.AI_API_KEY,
          prompt: finalPrompt,
          url: target,
          screenshotPng: shot.data,
          timeoutMs: parseInt(env.AI_TIMEOUT_MS || "60000", 10),
          mime: shot.mime,
          reqId: rid,
          model,
          format,
        });
        logDone(tag, tAI, "AI call DONE");
        logDone(tag, tAll, "output=screenshotandai-describe DONE");
        logDone(tag, tReq, "request DONE");

        if (format === "json") {
          const obj = sanitizeSchema(normalizeToJSONObject(aiResponse));
          if (params.includeScreenshot === "true" && shot?.data) {
            obj._screenshot = { mime: shot.mime, base64: toBase64(shot.data) };
          }
          return json(obj, 200);
        }

        return new Response(typeof aiResponse === "string" ? aiResponse : JSON.stringify(aiResponse, null, 2), {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type":
              typeof aiResponse === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
          },
        });
      }

      return json({ error: "Unhandled output type" }, 400);
    } catch (err) {
      console.error(`[${tag}] ERROR`, err?.stack || err?.message || String(err));
      return json({ error: err?.message || String(err) }, 500);
    }
  },
};

/* -------------------------- Helpers -------------------------- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
  });
}

// keep logs readable: don't dump full prompt or base64 in params log
function safeParams(p) {
  const copy = { ...p };
  if (copy.prompt && copy.prompt.length > 120) copy.prompt = copy.prompt.slice(0, 120) + "…";
  if (copy.imageBase64) copy.imageBase64 = `[base64:${copy.imageBase64.length}]`;
  return copy;
}

function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// If the model ever returns extra text around the JSON, extract the largest {...} block.
function normalizeToJSONObject(result) {
  if (result && typeof result === "object" && !("raw" in result) && !("error" in result) && !("status" in result)) {
    return result; // already an object
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
function sanitizeSchema(obj) {
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

async function readParams(request) {
  const u = new URL(request.url);
  if (request.method === "GET") {
    return {
      output: u.searchParams.get("output"),
      target: u.searchParams.get("target"),
      prompt: u.searchParams.get("prompt"),
      includeScreenshot: u.searchParams.get("includeScreenshot") || "false",
      waitMs: u.searchParams.get("waitMs"),
      viewportWidth: u.searchParams.get("viewportWidth"),
      viewportHeight: u.searchParams.get("viewportHeight"),
      selectorToWaitFor: u.searchParams.get("selectorToWaitFor"),
      imageType: u.searchParams.get("imageType"),
      imageQuality: u.searchParams.get("imageQuality"),
      fullPage: u.searchParams.get("fullPage") ?? "true",
      model: u.searchParams.get("model"),
      format: u.searchParams.get("format"),

      // for ai-describe
      imageBase64: u.searchParams.get("imageBase64"),
      imageMime: u.searchParams.get("imageMime"),
    };
  }
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("POST must be application/json");
    return await request.json();
  }
  throw new Error("Only GET and POST are supported");
}

/* -------------------------- Render + Screenshot -------------------------- */

async function renderPageGetHtml(env, targetUrl) {
  const tag = "HTML";
  const tAll = logStart(tag, targetUrl);

  new URL(targetUrl); // validate
  const browser = await puppeteer.launch(env.MYBROWSER);
  let html = "";
  try {
    const page = await browser.newPage();
    logInfo(tag, "Setting viewport 1280x800");
    await page.setViewport({ width: 1280, height: 800 });

    logInfo(tag, "Navigating (networkidle0)...");
    const tNav = now();
    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 60000 }).catch(async () => {
      logInfo(tag, "networkidle0 failed → retry domcontentloaded");
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    });
    logDone(tag, tNav, "navigation complete");

    logInfo(tag, "Auto-scrolling for lazy content");
    const tScroll = now();
    await autoScroll(page);
    logDone(tag, tScroll, "auto-scroll done");

    logInfo(tag, "Scroll to top + short settle");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(500);

    html = await page.content();
    await page.close();
  } finally {
    try {
      await browser.close();
    } catch {}
  }
  logDone(tag, tAll, `render html complete (length=${html.length})`);
  return { html };
}

async function renderAndScreenshot({
  env,
  targetUrl,
  viewport,
  extraWaitMs,
  selectorToWaitFor,
  imageType = "jpeg",
  imageQuality = 60,
  fullPage = true,
}) {
  const tag = "render";
  const tAll = logStart(tag, targetUrl);

  const browser = await puppeteer.launch(env.MYBROWSER);
  const page = await browser.newPage();
  try {
    // 1) Set a sane viewport (width matters for layout; height is irrelevant when fullPage=true)
    const width = Math.max(360, viewport.width || 1024);
    const height = Math.max(600, viewport.height || 768);
    logInfo(tag, `Setting viewport w=${width} h=${height} dpr=1`);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    // 2) Navigate
    logInfo(tag, "Navigating (networkidle0)...");
    const tNav = now();
    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 60000 }).catch(async () => {
      logInfo(tag, "networkidle0 failed → retry domcontentloaded");
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    });
    logDone(tag, tNav, "navigation complete");

    // 3) Optionally wait for a selector
    if (selectorToWaitFor) {
      logInfo(tag, `Waiting for selector: ${selectorToWaitFor}`);
      const tSel = now();
      try {
        await page.waitForSelector(selectorToWaitFor, { timeout: 15000 });
      } catch {
        logInfo(tag, "selector wait timed out (continuing)");
      }
      logDone(tag, tSel, "selector wait done");
    }

    // 4) Prep the page for a smooth full-page capture:
    //    - disable CSS smooth scrolling to avoid async transitions
    //    - remove common overflow locks that can clip screenshots
    await page.evaluate(() => {
      try {
        const root = document.scrollingElement || document.documentElement;
        root.style.scrollBehavior = "auto";
        document.body.style.scrollBehavior = "auto";
        for (const el of [document.documentElement, document.body]) {
          el.style.overflowX = "visible";
          el.style.overflowY = "visible";
        }
      } catch {}
    });

    // 5) Scroll to load lazy content (very important before fullPage shot)
    logInfo(tag, "Auto-scrolling…");
    const tScroll = now();
    await autoScroll(page);
    logDone(tag, tScroll, "auto-scroll done");

    // 6) Back to top and settle
    logInfo(tag, "Scroll back to top");
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    if (extraWaitMs > 0) {
      logInfo(tag, `Extra wait ${extraWaitMs}ms…`);
      await sleep(extraWaitMs);
    }

    // 7) Screenshot (fullPage defaults to true now)
    const type = imageType === "png" ? "png" : "jpeg";
    const options = { type, fullPage: !!fullPage };
    if (type === "jpeg") options.quality = Math.max(1, Math.min(100, imageQuality));

    logInfo(tag, `Taking screenshot type=${type} quality=${options.quality ?? "-"} fullPage=${options.fullPage}`);
    const tShot = now();
    const data = await page.screenshot(options); // Uint8Array
    const mime = type === "png" ? "image/png" : "image/jpeg";
    logDone(tag, tShot, `screenshot size=${data?.length || 0}B`);

    logDone(tag, tAll, "render complete");
    return { data, mime };
  } finally {
    try {
      await page.close();
    } catch {}
    try {
      await browser.close();
    } catch {}
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 800;
      const timer = setInterval(() => {
        const root = document.scrollingElement || document.documentElement;
        window.scrollBy(0, distance);
        total += distance;
        if (total >= root.scrollHeight - window.innerHeight - 10) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });
}

/* -------------------------- AI POST (OpenAI or Generic) -------------------------- */

function buildPromptWithSource(prompt, url) {
  const suffix = url ? `\n\n[Source URL: ${url}]` : "";
  return (prompt || "").trim() + suffix;
}

function isOpenAIResponsesEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.hostname.includes("api.openai.com") || u.pathname.endsWith("/v1/responses");
  } catch {
    return false;
  }
}

function extractOpenAIOutput(json, want = "json") {
  // Prefer output_text
  if (typeof json?.output_text === "string") {
    if (want === "json") {
      try {
        return JSON.parse(json.output_text);
      } catch {
        return json.output_text;
      }
    }
    return json.output_text;
  }
  // Fallback to output[].content[].text
  if (Array.isArray(json?.output)) {
    for (const msg of json.output) {
      if (Array.isArray(msg?.content)) {
        for (const c of msg.content) {
          if (c?.type === "output_text" && typeof c.text === "string") {
            if (want === "json") {
              try {
                return JSON.parse(c.text);
              } catch {
                return c.text;
              }
            }
            return c.text;
          }
          if (typeof c?.text === "string") {
            if (want === "json") {
              try {
                return JSON.parse(c.text);
              } catch {
                return c.text;
              }
            }
            return c.text;
          }
        }
      }
    }
  }
  return json;
}

async function postToAI({
  endpoint,
  apiKey,
  prompt,
  url,
  screenshotPng,
  timeoutMs,
  mime = "image/jpeg",
  reqId = "na",
  model = "gpt-4o-mini",
  format = "json", // accepts "json" | "text"; mapped below
}) {
  const tag = `postToAI#${reqId}`;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const isOAI = isOpenAIResponsesEndpoint(endpoint);
  const oaiFormatType = format === "json" ? "json_object" : "text";

  logInfo(
    tag,
    `provider=${isOAI ? "openai" : "generic"} model=${model} format=${format} -> text.format.type=${oaiFormatType}`
  );
  logInfo(tag, `image bytes=${screenshotPng?.length || 0} mime=${mime} timeout=${timeoutMs}ms`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("AI request timed out"), timeoutMs);

  try {
    let body;
    if (isOAI) {
      const dataUrl = `data:${mime};base64,${toBase64(screenshotPng)}`;
      body = {
        model: "gpt-4o-mini",
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
            name: "WebsiteAnalysisSchema", // <-- REQUIRED
            schema: ANALYSIS_SCHEMA, // <-- the schema object we wrote earlier
          },
        },
      };
    } else {
      // Generic fallback
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
    try {
      parsed = JSON.parse(raw);
    } catch {
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

/* -------------------------- Utils -------------------------- */

function toBase64(uint8) {
  if (!uint8 || typeof uint8.length !== "number") {
    throw new Error("toBase64: invalid input buffer");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* -------------------------- Your existing parsing logic -------------------------- */

function parseHTML(html, originalUrl) {
  const result = {
    PAGE: {
      HEADER: { LOGO: null, NAVIGATION: { LINKS: [] } },
      HERO: { HEADING: null, IMAGE: null, BUTTON: null },
      SECTION: [],
      FOOTER: { TEXT: null, LINKS: [] },
      PAGE_INTENT: { description: null },
    },
    url: originalUrl,
  };
  result.PAGE.HEADER = extractHeader(html);
  result.PAGE.HERO = extractHero(html);
  result.PAGE.SECTION = extractSections(html);
  result.PAGE.FOOTER = extractFooter(html);
  return result;
}

function extractHeader(html) {
  const header = { LOGO: null, NAVIGATION: { LINKS: [] } };
  const headerMatch = html.match(/<header[^>]*>([\s\S]*?)<\/header>/i);
  if (headerMatch) {
    const headerContent = headerMatch[1];
    const logoPatterns = [
      /<img[^>]*class="[^"]*logo[^"]*"[^>]*>/i,
      /<a[^>]*class="[^"]*logo[^"]*"[^>]*>[\s\S]*?<img[^>]*>/i,
      /<div[^>]*class="[^"]*logo[^"]*"[^>]*>[\s\S]*?<img[^>]*>/i,
      /<img[^>]*id="[^"]*logo[^"]*"[^>]*>/i,
    ];
    for (const pattern of logoPatterns) {
      const logoMatch = headerContent.match(pattern);
      if (logoMatch) {
        const imgMatch = logoMatch[0].match(/<img[^>]*>/i);
        if (imgMatch) {
          header.LOGO = extractImageData(imgMatch[0]);
          break;
        }
      }
    }
    const navMatch = headerContent.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
    if (navMatch) {
      header.NAVIGATION.LINKS = extractLinks(navMatch[1]);
    } else {
      const headerLinks = extractLinks(headerContent);
      header.NAVIGATION.LINKS = headerLinks
        .filter((link) => !link.href.match(/^#$|^\/$/) || link.text.length > 0)
        .slice(0, 10);
    }
  }
  return header;
}

function extractHero(html) {
  const hero = { HEADING: null, IMAGE: null, BUTTON: null };
  const heroPatterns = [
    /<section[^>]*class="[^"]*hero[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*hero[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*jumbotron[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*jumbotron[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*banner[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*banner[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*id="hero"[^>]*>([\s\S]*?)<\/section>/i,
    /<main[^>]*>([\s\S]{0,3000})/i,
  ];
  for (const pattern of heroPatterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const heroContent = match[1];

    const h1Match = heroContent.match(/<h1[^>]*(?:id="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/h1>/i);
    const h2Match = heroContent.match(/<h2[^>]*(?:id="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/h2>/i);
    const headingMatch = h1Match || h2Match;
    if (headingMatch) {
      hero.HEADING = {
        text: cleanText(headingMatch[3]),
        htmlTag: h1Match ? "h1" : "h2",
        id: headingMatch[1] || "",
        classes: headingMatch[2] ? headingMatch[2].split(" ").filter((c) => c) : [],
      };
    }

    const imgMatches = heroContent.matchAll(/<img[^>]*>/gi);
    for (const imgMatch of imgMatches) {
      const imgData = extractImageData(imgMatch[0]);
      if (!imgData.src.match(/icon|logo|avatar/i)) {
        hero.IMAGE = imgData;
        break;
      }
    }

    const buttonPatterns = [
      /<a[^>]*class="[^"]*(?:btn|button|cta)[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      /<button[^>]*class="[^"]*(?:btn|button|cta)[^"]*"[^>]*>([\s\S]*?)<\/button>/i,
      /<a[^>]*class="[^"]*primary[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    ];
    for (const buttonPattern of buttonPatterns) {
      const buttonMatch = heroContent.match(buttonPattern);
      if (buttonMatch) {
        hero.BUTTON = extractButtonData(buttonMatch[0]);
        break;
      }
    }

    if (hero.HEADING || hero.IMAGE) break;
  }
  return hero;
}

function extractSections(html) {
  const sections = [];
  let cleanHtml = html.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  cleanHtml = cleanHtml.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  const sectionPatterns = [
    /<section[^>]*>([\s\S]*?)<\/section>/gi,
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*class="[^"]*(?:section|content-block|container)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  let sectionIndex = 0;
  for (const pattern of sectionPatterns) {
    const matches = [...cleanHtml.matchAll(pattern)];
    for (const match of matches) {
      const sectionContent = match[1];
      if (sectionContent.match(/class="[^"]*(?:hero|header|footer|nav)[^"]*"/i)) continue;

      const section = { section_index: sectionIndex, HEADING: null, TEXTS: [], LIST: null };

      const headingMatch = sectionContent.match(
        /<(h[1-6])[^>]*(?:id="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/\1>/i
      );
      if (headingMatch) {
        section.HEADING = {
          text: cleanText(headingMatch[4]),
          htmlTag: headingMatch[1],
          id: headingMatch[2] || "",
          classes: headingMatch[3] ? headingMatch[3].split(" ").filter((c) => c) : [],
        };
      }

      const paragraphs = sectionContent.matchAll(/<p[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/gi);
      for (const p of paragraphs) {
        const text = cleanText(p[2]);
        if (text && text.length > 10) {
          section.TEXTS.push({ text, classes: p[1] ? p[1].split(" ").filter((c) => c) : [] });
        }
      }

      const listMatch = sectionContent.match(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/i);
      if (listMatch) {
        const listItems = [];
        const itemMatches = listMatch[2].matchAll(/<li[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/li>/gi);
        for (const item of itemMatches) {
          const text = cleanText(item[2]);
          if (text) listItems.push({ text, classes: item[1] ? item[1].split(" ").filter((c) => c) : [] });
        }
        if (listItems.length > 0) section.LIST = { LIST_ITEMS: listItems };
      }

      if (section.HEADING || section.TEXTS.length > 0 || section.LIST) {
        sections.push(section);
        sectionIndex++;
      }
    }
  }
  return sections;
}

function extractFooter(html) {
  const footer = { TEXT: null, LINKS: [] };
  const footerMatch = html.match(/<footer[^>]*>([\s\S]*?)<\/footer>/i);
  if (footerMatch) {
    const footerContent = footerMatch[1];
    const copyrightPatterns = [
      /<p[^>]*class="[^"]*(?:copyright|copy)[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
      /<div[^>]*class="[^"]*(?:copyright|copy)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<span[^>]*class="[^"]*(?:copyright|copy)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      /<p[^>]*>([\s\S]*?(?:©|&copy;|Copyright)[\s\S]*?)<\/p>/i,
    ];
    for (const pattern of copyrightPatterns) {
      const textMatch = footerContent.match(pattern);
      if (textMatch) {
        const classMatch = textMatch[0].match(/class="([^"]*)"/);
        footer.TEXT = {
          text: cleanText(textMatch[1]),
          classes: classMatch ? classMatch[1].split(" ").filter((c) => c) : [],
        };
        break;
      }
    }
    if (!footer.TEXT) {
      const pMatch = footerContent.match(/<p[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch)
        footer.TEXT = { text: cleanText(pMatch[2]), classes: pMatch[1] ? pMatch[1].split(" ").filter((c) => c) : [] };
    }
    footer.LINKS = extractLinks(footerContent);
  }
  return footer;
}

function extractImageData(imgTag) {
  const srcMatch = imgTag.match(/src="([^"]*)"/i);
  const altMatch = imgTag.match(/alt="([^"]*)"/i);
  const widthMatch = imgTag.match(/width="([^"]*)"/i);
  const heightMatch = imgTag.match(/height="([^"]*)"/i);
  const classMatch = imgTag.match(/class="([^"]*)"/i);
  return {
    src: srcMatch ? srcMatch[1] : "",
    alt: altMatch ? altMatch[1] : "",
    width: widthMatch ? widthMatch[1] : "",
    height: heightMatch ? heightMatch[1] : "",
    classes: classMatch ? classMatch[1].split(" ").filter((c) => c) : [],
  };
}

function extractButtonData(buttonTag) {
  const textMatch = buttonTag.match(/>([^<]*)</i);
  let buttonText = "";
  if (textMatch) buttonText = cleanText(textMatch[1]);
  else {
    const nestedTextMatch = buttonTag.match(/<(?:span|div)[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
    if (nestedTextMatch) buttonText = cleanText(nestedTextMatch[1]);
  }
  const hrefMatch = buttonTag.match(/href="([^"]*)"/i);
  const classMatch = buttonTag.match(/class="([^"]*)"/i);
  const isLink = buttonTag.toLowerCase().startsWith("<a");
  return {
    text: buttonText,
    href: hrefMatch ? hrefMatch[1] : "",
    type: isLink ? "link" : "button",
    classes: classMatch ? classMatch[1].split(" ").filter((c) => c) : [],
  };
}

function extractLinks(content) {
  const links = [];
  const linkMatches = content.matchAll(
    /<a[^>]*(?:href="([^"]*)")?[^>]*(?:target="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*(?:aria-label="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/gi
  );
  for (const match of linkMatches) {
    const text = cleanText(match[5]);
    const href = match[1] || "";
    if (text && href && !href.startsWith("#")) {
      links.push({
        text,
        href,
        target: match[2] || "",
        classes: match[3] ? match[3].split(" ").filter((c) => c) : [],
        ariaLabel: match[4] || "",
      });
    }
  }
  const uniqueLinks = [];
  const seen = new Set();
  for (const link of links) {
    const key = `${link.text}|${link.href}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueLinks.push(link);
    }
  }
  return uniqueLinks;
}

function cleanText(text) {
  if (!text) return "";
  text = text.replace(/<[^>]*>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&copy;/g, "©")
    .replace(/&reg;/g, "®")
    .replace(/&trade;/g, "™");
  return text.replace(/\s+/g, " ").trim();
}
