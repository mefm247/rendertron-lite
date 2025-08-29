// src/render/browser.js
import puppeteer from "@cloudflare/puppeteer";
import { logStart, logDone, logInfo, now } from "../utils/logging.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function renderPageGetHtml(env, targetUrl) {
  const tag = "HTML";
  const tAll = logStart(tag, targetUrl);

  new URL(targetUrl); // validate
  const browser = await puppeteer.launch(env.MYBROWSER);
  let html = "";
  try {
    const page = await browser.newPage();
    logInfo(tag, "Setting viewport 1280x800");
    await page.setViewport({ width: 1280, height: 800 });

    logInfo(tag, "Navigating (networkidle0)…");
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
    try { await browser.close(); } catch {}
  }
  logDone(tag, tAll, `render html complete (length=${html.length})`);
  return { html };
}

export async function renderAndScreenshot({
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
    const width = Math.max(360, viewport.width || 1024);
    const height = Math.max(600, viewport.height || 768);
    logInfo(tag, `Setting viewport w=${width} h=${height} dpr=1`);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    logInfo(tag, "Navigating (networkidle0)…");
    const tNav = now();
    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 60000 }).catch(async () => {
      logInfo(tag, "networkidle0 failed → retry domcontentloaded");
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    });
    logDone(tag, tNav, "navigation complete");

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

    logInfo(tag, "Auto-scrolling…");
    const tScroll = now();
    await autoScroll(page);
    logDone(tag, tScroll, "auto-scroll done");

    logInfo(tag, "Scroll back to top");
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    if (extraWaitMs > 0) {
      logInfo(tag, `Extra wait ${extraWaitMs}ms…`);
      await new Promise(r => setTimeout(r, extraWaitMs));
    }

    const type = imageType === "png" ? "png" : "jpeg";
    const options = { type, fullPage: !!fullPage };
    if (type === "jpeg") options.quality = Math.max(1, Math.min(100, imageQuality));

    logInfo(tag, `Taking screenshot type=${type} quality=${options.quality ?? "-"} fullPage=${options.fullPage}`);
    const tShot = now();
    const data = await page.screenshot(options);
    const mime = type === "png" ? "image/png" : "image/jpeg";
    logDone(tag, tShot, `screenshot size=${data?.length || 0}B`);

    logDone(tag, tAll, "render complete");
    return { data, mime };
  } finally {
    try { await page.close(); } catch {}
    try { await browser.close(); } catch {}
  }
}

export async function autoScroll(page) {
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