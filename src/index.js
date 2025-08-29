import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("target");

    if (!targetUrl) {
      return new Response(JSON.stringify({
        error: 'Missing `target` query parameter.',
        example: `${url.origin}/analyze-html?target=https://example.com`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const browser = await puppeteer.launch(env.MYBROWSER);
      let html = '';

      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 45000 });
        html = await page.content();
      } finally {
        try {
          if (browser) await browser.close();
        } catch {}
      }

      const structuredJson = await buildStructuredPageObject(html, targetUrl);
      structuredJson.rendertron_url = `internal-puppeteer`; // for trace/debug info
      return Response.json(structuredJson);

    } catch (err) {
      return new Response(JSON.stringify({
        error: 'Failed to process the request.',
        message: err?.message || String(err)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};

async function buildStructuredPageObject(html, targetUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const getText = el => el?.textContent?.trim() || null;
  const getAttr = (el, name) => el?.getAttribute(name) || null;
  const getClassList = el => el?.classList ? Array.from(el.classList) : [];

  const HEADER = (() => {
    const header = doc.querySelector("header");
    if (!header) return null;

    const logo = header.querySelector("img");
    const navLinks = header.querySelectorAll("nav a");

    return {
      LOGO: logo ? {
        src: getAttr(logo, "src"),
        alt: getAttr(logo, "alt"),
        classes: getClassList(logo)
      } : null,
      NAVIGATION: {
        LINKS: Array.from(navLinks).map(a => ({
          text: getText(a),
          href: getAttr(a, "href"),
          target: getAttr(a, "target"),
          ariaLabel: getAttr(a, "aria-label"),
          classes: getClassList(a)
        }))
      }
    };
  })();

  const HERO = (() => {
    const hero = doc.querySelector(".hero, section.hero");
    if (!hero) return null;

    const heading = hero.querySelector("h1,h2,h3");
    const img = hero.querySelector("img");
    const button = hero.querySelector("a.btn, button");

    return {
      HEADING: heading ? {
        text: getText(heading),
        htmlTag: heading.tagName.toLowerCase(),
        classes: getClassList(heading),
        id: getAttr(heading, "id")
      } : null,
      IMAGE: img ? {
        src: getAttr(img, "src"),
        alt: getAttr(img, "alt"),
        width: getAttr(img, "width"),
        height: getAttr(img, "height"),
        classes: getClassList(img)
      } : null,
      BUTTON: button ? {
        text: getText(button),
        href: getAttr(button, "href"),
        type: button.tagName.toLowerCase() === 'button' ? getAttr(button, "type") : "link",
        classes: getClassList(button)
      } : null
    };
  })();

  const SECTIONS = Array.from(doc.querySelectorAll("main section, section:not(header):not(footer)"))
    .map((section, index) => {
      const heading = section.querySelector("h1,h2,h3,h4,h5,h6");
      const texts = Array.from(section.querySelectorAll("p")).map(p => ({
        text: getText(p),
        classes: getClassList(p)
      }));
      const listItems = section.querySelectorAll("ul li, ol li");

      return {
        section_index: index,
        HEADING: heading ? {
          text: getText(heading),
          htmlTag: heading.tagName.toLowerCase(),
          id: getAttr(heading, "id"),
          classes: getClassList(heading)
        } : null,
        TEXTS: texts.length ? texts : null,
        LIST: listItems.length ? {
          LIST_ITEMS: Array.from(listItems).map(li => ({
            text: getText(li),
            classes: getClassList(li)
          }))
        } : null
      };
    });

  const FOOTER = (() => {
    const footer = doc.querySelector("footer");
    if (!footer) return null;

    const links = footer.querySelectorAll("a");
    const text = footer.querySelector("p");

    return {
      TEXT: text ? { text: getText(text), classes: getClassList(text) } : null,
      LINKS: Array.from(links).map(a => ({
        text: getText(a),
        href: getAttr(a, "href")
      }))
    };
  })();

  const PAGE_INTENT = {
    description: null
  };

  return {
    PAGE: {
      HEADER,
      HERO,
      SECTION: SECTIONS,
      FOOTER,
      PAGE_INTENT
    },
    url: targetUrl
  };
}
