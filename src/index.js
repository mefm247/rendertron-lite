import puppeteer from "@cloudflare/puppeteer";

/**
 * Env variables:
 * - MYBROWSER         Cloudflare Browser Rendering binding
 * - AI_ENDPOINT       AI HTTP endpoint that accepts JSON
 * - AI_API_KEY        Optional. Sent as Bearer token if present
 * - AI_TIMEOUT_MS     Optional. Default 45000
 *
 * Query or POST JSON fields:
 * - output            "html" | "structure" | "ai"   (required)
 * - target            URL to load                  (required)
 * - prompt            Optional. Overrides default SCREENSHOT_ANALYSIS_PROMPT for output=ai
 * - includeScreenshot "true" to include base64 screenshot in output=ai response
 * - waitMs            Optional. Extra wait after render. Default 1500
 * - viewportWidth     Optional. Default 1280
 * - viewportHeight    Optional. Default 800
 * - selectorToWaitFor Optional. CSS selector to wait for
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCREENSHOT_ANALYSIS_PROMPT = `
You are an expert in visual-to-structure translation for websites.
You will be given a screenshot of a webpage.
Your job is to analyze the screenshot and output a strictly valid JSON object
that captures the page structure using a uniform, section-based schema.

=== Output Format (must be valid JSON) ===
{
  "page_intent": "Overall description of the page’s communication strategy, emotional tone, target audience, and primary conversion goal.",
  "meta": {
    "title": "...",                  // if visible or inferable from the screenshot
    "language": "...",               // ISO code if visible/inferable, else null
    "screenshot_notes": "..."        // any constraints or notable artifacts
  },
  "sections": [
    {
      "id": "sec_001",
      "type": "header" | "hero" | "content" | "sidebar" | "footer" | "nav" | "callout" | "form" | "gallery" | "testimonials" | "faq" | "pricing" | "features" | "partners" | "legal" | "other",
      "section_intent": "...",
      "elements": [
        {
          "type": "LOGO" | "HEADING" | "TEXT" | "IMAGE" | "BUTTON" | "LINK" | "VIDEO" | "FORM" | "INPUT" | "LIST" | "LIST_ITEM" | "ICON" | "BADGE" | "CARD" | "TABLE" | "TAG" | "BREADCRUMB",
          "text": "...",                 // exact visible text, if present; else ""
          "alt": "...",                  // literal description for non-text visuals; else ""
          "intent": "...",               // why it exists / how it influences perception
          "url": "...",                  // href/src if visible; else ""
          "name": "...",                 // element name/label (e.g., input name, icon name)
          "state": {
            "emphasis": "primary|secondary|tertiary|muted|neutral|danger|success|warning|info|none",
            "disabled": false,
            "selected": false,
            "active": false,
            "visible": true
          },
          "layout": {
            "order": 0,                  // visual reading order within the section
            "bounding_box": { "x": 0, "y": 0, "width": 0, "height": 0 }, // pixels if you can infer; else null
            "alignment": "left|center|right|justify|stretch|unknown"
          },
          "form_meta": {
            "role": "form|input|label|checkbox|radio|select|textarea|submit|none",
            "required": false,
            "placeholder": "...",
            "options": [ "..." ]         // for selects/radios/lists; else []
          },
          "list_meta": {
            "ordered": false,
            "items": [                   // when type === "LIST"
              { "text": "...", "intent": "...", "alt": "" }
            ]
          }
        }
      ]
    }
  ]
}

=== Rules ===
1) Use ONLY this JSON structure. No extra top-level keys. No comments in the final output.
2) The entire page must be represented through the "sections" array. The hero is a section with "type": "hero".
3) Be exhaustive: include every visible block (header, nav, hero, content blocks, sidebars, footers, banners, notices, cookie bars, etc.).
4) Be descriptive for visuals: for images/icons/video, fill "alt" with a literal, concrete description.
5) Focus on intent for both sections and elements.
6) Do not invent content that isn’t visible. If a field is unknown, use "" (empty string) or null where appropriate.
7) Keep JSON valid: no trailing commas, correct quoting, arrays/objects only as specified.
8) If something doesn’t fit known types, use section.type = "other" or element.type = "CARD"/"ICON"/"TAG" as the closest match and explain in "intent".

=== Short Example ===
{
  "page_intent": "Establish credibility with business users and drive sign-ups.",
  "meta": {
    "title": "BlueTech — Smarter Tools",
    "language": "en",
    "screenshot_notes": ""
  },
  "sections": [
    {
      "id": "sec_header",
      "type": "header",
      "section_intent": "Provide brand identity and quick navigation.",
      "elements": [
        {
          "type": "LOGO",
          "text": "",
          "alt": "BlueTech wordmark logo",
          "intent": "Modern, tech-focused branding.",
          "url": "",
          "name": "BlueTech",
          "state": { "emphasis": "none", "disabled": false, "selected": false, "active": false, "visible": true },
          "layout": { "order": 0, "bounding_box": null, "alignment": "left" },
          "form_meta": { "role": "none", "required": false, "placeholder": "", "options": [] },
          "list_meta": { "ordered": false, "items": [] }
        },
        {
          "type": "LINK",
          "text": "Pricing",
          "alt": "",
          "intent": "Guide user toward conversion decision.",
          "url": "/pricing",
          "name": "",
          "state": { "emphasis": "primary", "disabled": false, "selected": false, "active": false, "visible": true },
          "layout": { "order": 1, "bounding_box": null, "alignment": "right" },
          "form_meta": { "role": "none", "required": false, "placeholder": "", "options": [] },
          "list_meta": { "ordered": false, "items": [] }
        }
      ]
    },
    {
      "id": "sec_hero",
      "type": "hero",
      "section_intent": "Capture attention and drive sign-ups.",
      "elements": [
        {
          "type": "IMAGE",
          "text": "",
          "alt": "Abstract blue gradient background with subtle grid",
          "intent": "Futuristic and professional tone.",
          "url": "",
          "name": "",
          "state": { "emphasis": "none", "disabled": false, "selected": false, "active": false, "visible": true },
          "layout": { "order": 0, "bounding_box": null, "alignment": "center" },
          "form_meta": { "role": "none", "required": false, "placeholder": "", "options": [] },
          "list_meta": { "ordered": false, "items": [] }
        },
        {
          "type": "HEADING",
          "text": "Smarter Tools for Modern Teams",
          "alt": "",
          "intent": "Highlight value proposition.",
          "url": "",
          "name": "h1",
          "state": { "emphasis": "primary", "disabled": false, "selected": false, "active": true, "visible": true },
          "layout": { "order": 1, "bounding_box": null, "alignment": "center" },
          "form_meta": { "role": "none", "required": false, "placeholder": "", "options": [] },
          "list_meta": { "ordered": false, "items": [] }
        },
        {
          "type": "BUTTON",
          "text": "Get Started",
          "alt": "",
          "intent": "Primary call-to-action.",
          "url": "/signup",
          "name": "cta_primary",
          "state": { "emphasis": "primary", "disabled": false, "selected": false, "active": true, "visible": true },
          "layout": { "order": 2, "bounding_box": null, "alignment": "center" },
          "form_meta": { "role": "submit", "required": false, "placeholder": "", "options": [] },
          "list_meta": { "ordered": false, "items": [] }
        }
      ]
    }
  ]
}
`;

export default {
  async fetch(request, env) {
    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const u = new URL(request.url);
    if (u.pathname !== "/analyze") {
      return new Response("Not Found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    try {
      const params = await readParams(request);
      const { output, target, includeScreenshot, waitMs, viewportWidth, viewportHeight, selectorToWaitFor } = params;

      if (!output || !["html", "structure", "ai"].includes(output)) {
        return json({ error: "Missing or invalid 'output' parameter. Use html | structure | ai." }, 400);
      }
      if (!target) {
        return json({ error: "Missing 'target' parameter", example: `${u.origin}/analyze?output=html&target=https://example.com` }, 400);
      }

      // 1) Rendered HTML
      if (output === "html") {
        const { html } = await renderPageGetHtml(env, target);
        return new Response(html, {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300"
          }
        });
      }

      // 2) Structure (parse rendered HTML)
      if (output === "structure") {
        const { html } = await renderPageGetHtml(env, target);
        const structuredData = parseHTML(html, target);
        return json(structuredData, 200);
      }

      // 3) AI: screenshot + prompt to external API
      if (output === "ai") {
        if (!env.MYBROWSER) return json({ error: "Missing MYBROWSER binding" }, 500);
        if (!env.AI_ENDPOINT) return json({ error: "Missing AI_ENDPOINT env var" }, 500);

        const screenshotPng = await renderAndScreenshot({
          env,
          targetUrl: target,
          viewport: { width: parseInt(params.viewportWidth || "1280", 10), height: parseInt(params.viewportHeight || "800", 10) },
          extraWaitMs: parseInt(params.waitMs || "1500", 10),
          selectorToWaitFor: selectorToWaitFor || null,
        });

        const finalPrompt = params.prompt && params.prompt.trim().length > 0
          ? params.prompt
          : SCREENSHOT_ANALYSIS_PROMPT;

        const aiTimeout = parseInt(env.AI_TIMEOUT_MS || "45000", 10);
        const aiResponse = await postToAI({
          endpoint: env.AI_ENDPOINT,
          apiKey: env.AI_API_KEY,
          prompt: finalPrompt,
          url: target,
          screenshotPng,
          timeoutMs: aiTimeout,
        });

        return json({
          ok: true,
          sourceUrl: target,
          ai: aiResponse,
          screenshot: includeScreenshot === "true" ? { mime: "image/png", base64: toBase64(screenshotPng) } : undefined
        });
      }

      // Fallback
      return json({ error: "Unhandled output type" }, 400);
    } catch (err) {
      return json({ error: err?.message || String(err) }, 500);
    }
  },
};

/* -------------------------- Helpers -------------------------- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" }
  });
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
    };
  }
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("POST must be application/json");
    return await request.json();
  }
  throw new Error("Only GET and POST are supported");
}

async function renderPageGetHtml(env, targetUrl) {
  new URL(targetUrl); // validate

  const browser = await puppeteer.launch(env.MYBROWSER);
  let html = "";
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Try networkidle0, fallback to domcontentloaded
    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 60000 })
      .catch(async () => {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      });

    await autoScroll(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(500); // instead of page.waitForTimeout

    html = await page.content();
    await page.close();
  } finally {
    try { await browser.close(); } catch {}
  }
  return { html };
}


async function renderAndScreenshot({ env, targetUrl, viewport, extraWaitMs, selectorToWaitFor }) {
  const browser = await puppeteer.launch(env.MYBROWSER);
  const page = await browser.newPage();
  try {
    await page.setViewport(viewport);

    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 60000 })
      .catch(async () => {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      });

    if (selectorToWaitFor) {
      try { await page.waitForSelector(selectorToWaitFor, { timeout: 15000 }); } catch {}
    }

    await autoScroll(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    if (extraWaitMs > 0) await sleep(extraWaitMs); // instead of page.waitForTimeout

    return await page.screenshot({ type: "png", fullPage: true });
  } finally {
    try { await page.close(); } catch {}
    try { await browser.close(); } catch {}
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

function toBase64(uint8) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// helper to append the source URL into the prompt text safely
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

async function postToAI({ endpoint, apiKey, prompt, url, screenshotPng, timeoutMs }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("AI request timed out"), timeoutMs);

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const imageDataUrl = `data:image/png;base64,${toBase64(screenshotPng)}`;

    const body = {
      model: "gpt-4o",
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: imageDataUrl },
            { type: "input_text", text: buildPromptWithSource(prompt, url) },
          ],
        },
      ],
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json = await res.json();

    // ✅ Extract just the structured pseudo-language text
    if (json.output && Array.isArray(json.output)) {
      for (const msg of json.output) {
        if (msg.content) {
          for (const c of msg.content) {
            if (c.type === "output_text" && c.text) {
              return c.text;   // only return the text
            }
          }
        }
      }
    }

    // fallback: return output_text if present
    if (typeof json.output_text === "string") {
      return json.output_text;
    }

    // if nothing matches, return whole object (debug)
    return json(aiResponse, 200);
  } finally {
    clearTimeout(t);
  }
}



/* -------------------------- Your existing parsing logic -------------------------- */

function parseHTML(html, originalUrl) {
  const result = {
    PAGE: {
      HEADER: { LOGO: null, NAVIGATION: { LINKS: [] } },
      HERO: { HEADING: null, IMAGE: null, BUTTON: null },
      SECTION: [],
      FOOTER: { TEXT: null, LINKS: [] },
      PAGE_INTENT: { description: null }
    },
    url: originalUrl
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
      /<img[^>]*id="[^"]*logo[^"]*"[^>]*>/i
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
        .filter(link => !link.href.match(/^#$|^\/$/) || link.text.length > 0)
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
    /<main[^>]*>([\s\S]{0,3000})/i
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
        classes: headingMatch[2] ? headingMatch[2].split(" ").filter(c => c) : []
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
      /<a[^>]*class="[^"]*primary[^"]*"[^>]*>([\s\S]*?)<\/a>/i
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
    /<div[^>]*class="[^"]*(?:section|content-block|container)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  ];
  let sectionIndex = 0;
  for (const pattern of sectionPatterns) {
    const matches = [...cleanHtml.matchAll(pattern)];
    for (const match of matches) {
      const sectionContent = match[1];
      if (sectionContent.match(/class="[^"]*(?:hero|header|footer|nav)[^"]*"/i)) continue;

      const section = { section_index: sectionIndex, HEADING: null, TEXTS: [], LIST: null };

      const headingMatch = sectionContent.match(/<(h[1-6])[^>]*(?:id="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/\1>/i);
      if (headingMatch) {
        section.HEADING = {
          text: cleanText(headingMatch[4]),
          htmlTag: headingMatch[1],
          id: headingMatch[2] || "",
          classes: headingMatch[3] ? headingMatch[3].split(" ").filter(c => c) : []
        };
      }

      const paragraphs = sectionContent.matchAll(/<p[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/gi);
      for (const p of paragraphs) {
        const text = cleanText(p[2]);
        if (text && text.length > 10) {
          section.TEXTS.push({ text, classes: p[1] ? p[1].split(" ").filter(c => c) : [] });
        }
      }

      const listMatch = sectionContent.match(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/i);
      if (listMatch) {
        const listItems = [];
        const itemMatches = listMatch[2].matchAll(/<li[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/li>/gi);
        for (const item of itemMatches) {
          const text = cleanText(item[2]);
          if (text) listItems.push({ text, classes: item[1] ? item[1].split(" ").filter(c => c) : [] });
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
      /<p[^>]*>([\s\S]*?(?:©|&copy;|Copyright)[\s\S]*?)<\/p>/i
    ];
    for (const pattern of copyrightPatterns) {
      const textMatch = footerContent.match(pattern);
      if (textMatch) {
        const classMatch = textMatch[0].match(/class="([^"]*)"/);
        footer.TEXT = { text: cleanText(textMatch[1]), classes: classMatch ? classMatch[1].split(" ").filter(c => c) : [] };
        break;
      }
    }
    if (!footer.TEXT) {
      const pMatch = footerContent.match(/<p[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch) footer.TEXT = { text: cleanText(pMatch[2]), classes: pMatch[1] ? pMatch[1].split(" ").filter(c => c) : [] };
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
    classes: classMatch ? classMatch[1].split(" ").filter(c => c) : []
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
    classes: classMatch ? classMatch[1].split(" ").filter(c => c) : []
  };
}

function extractLinks(content) {
  const links = [];
  const linkMatches = content.matchAll(/<a[^>]*(?:href="([^"]*)")?[^>]*(?:target="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*(?:aria-label="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of linkMatches) {
    const text = cleanText(match[5]);
    const href = match[1] || "";
    if (text && href && !href.startsWith("#")) {
      links.push({
        text,
        href,
        target: match[2] || "",
        classes: match[3] ? match[3].split(" ").filter(c => c) : [],
        ariaLabel: match[4] || ""
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
