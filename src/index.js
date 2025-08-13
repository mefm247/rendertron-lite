// Rendertron-lite (Cloudflare Worker + Browser Rendering)
// Routes:
//   /render/<url-encoded>
//   /?url=<https-url>&waitUntil=networkidle2&timeout=45000&w=1280&h=800&ua=...&waitFor=selector:.ready|ms:2000

import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    try {
      const u = new URL(request.url);

      // 1) Resolve target URL from /render/<encoded> or ?url=
      let target = u.searchParams.get("url");
      if (!target && u.pathname.startsWith("/render/")) {
        target = decodeURIComponent(u.pathname.slice("/render/".length));
      }
      if (!target) return respond(400, "Usage: /render/<url-encoded> or ?url=<https-url>");

      try {
        const parsed = new URL(target);
        if (!/^https?:$/i.test(parsed.protocol)) throw new Error("Only http/https allowed");
      } catch (e) {
        return respond(400, "Invalid target URL");
      }

      // 2) Options
      const waitUntil = u.searchParams.get("waitUntil") || "networkidle0"; // load | domcontentloaded | networkidle0 | networkidle2
      const timeout = clampInt(u.searchParams.get("timeout"), 5_000, 90_000, 30_000);
      const width = clampInt(u.searchParams.get("w"), 320, 2400, 1280);
      const height = clampInt(u.searchParams.get("h"), 480, 2400, 800);
      const ua = u.searchParams.get("ua") || "";
      const waitFor = u.searchParams.get("waitFor"); // "selector:.ready" or "ms:2000"

      // 3) Launch headless Chrome on Cloudflare’s Browser Rendering
      const browser = await puppeteer.launch(env.MYBROWSER);
      try {
        const page = await browser.newPage();
        await page.setViewport({ width, height });
        if (ua) await page.setUserAgent(ua);

        await page.goto(target, { waitUntil, timeout });

        // Optional extra wait
        if (waitFor) {
          const [kind, value] = waitFor.split(":", 2);
          if (kind === "selector" && value) {
            await page.waitForSelector(value, { timeout: Math.max(2000, timeout / 2) });
          } else if (kind === "ms" && value) {
            await page.waitForTimeout(Number(value) || 0);
          }
        }

        // 4) Return the fully rendered HTML snapshot
        const html = await page.content();
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-renderer": "cf-browser",
          },
        });
      } finally {
        try {
          await browser.close();
        } catch {}
      }
    } catch (err) {
      return respond(500, `Render error: ${err?.message || String(err)}`);
    }
  },
};

function clampInt(v, min, max, dflt) {
  const n = parseInt(v ?? "", 10);
  if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
  return dflt;
}
function respond(status, msg) {
  return new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
