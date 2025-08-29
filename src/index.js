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

const SCREENSHOT_ANALYSIS_PROMPT = `
You are an expert in visual-to-structure translation for websites.
You will be given a screenshot of a webpage.
Your job is to analyze the screenshot and output a structured pseudo-language description of the page.

=== Output Format ===
Use this structure:
PAGE {
  HEADER { ... }
  HERO { ... }
  SECTION { ... }
  SIDEBAR { ... }
  FOOTER { ... }
  PAGE_INTENT { "..." }
}

Allowed elements inside sections:
LOGO, HEADING, TEXT, IMAGE, BUTTON, LINK, VIDEO, FORM, INPUT, LIST, LIST_ITEM

For each ELEMENT, always include:
- text: "..." (exact visible text, if present)
- alt: "..." (literal description of the image/icon/video if present)
- intent: "..." (why it is included, or how it influences user perception)

For each SECTION, include:
- section_intent: "..." (overall purpose of this section)

At the end of the file, include:
PAGE_INTENT {
  "Overall description of the page’s communication strategy, emotional tone,
   target audience, and primary conversion goal."
}

=== Example (shortened) ===
HEADER {
  section_intent: "Provide brand identity and quick navigation"
  LOGO { alt: "BlueTech wordmark" intent: "Modern, tech-focused branding" }
  NAVIGATION {
    LINK { text: "Home" intent: "Return to entry point" }
    LINK { text: "Pricing" intent: "Guide user toward conversion decision" }
  }
}

HERO {
  section_intent: "Capture attention and drive sign-ups"
  IMAGE { alt: "Abstract blue background" intent: "Futuristic and professional tone" }
  HEADING { text: "Smarter Tools for Modern Teams" intent: "Highlight value proposition" }
  BUTTON { text: "Get Started" intent: "Primary call-to-action" }
}

PAGE_INTENT {
  "This page is designed to establish credibility with business users,
   emphasize trust and innovation, and funnel visitors toward creating an account."
}

=== Instructions ===
- Be exhaustive: include every visible block of content.
- Be descriptive: especially for images, icons, and visuals.
- Focus on intent: why is this element or section included? How is it meant to affect the user?
- Do not invent things that aren’t visible.
- Do not output HTML, CSS, or JS — only the pseudo-language.
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
  new URL(targetUrl);
  const browser = await puppeteer.launch(env.MYBROWSER);
  let html = "";
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 60000 }).catch(async () => {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    });
    await autoScroll(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(500);
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
    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 60000 }).catch(async () => {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    });
    if (selectorToWaitFor) {
      try { await page.waitForSelector(selectorToWaitFor, { timeout: 15000 }); } catch {}
    }
    await autoScroll(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    if (extraWaitMs > 0) await page.waitForTimeout(extraWaitMs);
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

async function postToAI({ endpoint, apiKey, prompt, url, screenshotPng, timeoutMs }) {
  const payload = {
    prompt,
    source_url: url,
    image: { mime: "image/png", base64: toBase64(screenshotPng) },
  };
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("AI request timed out"), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
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
