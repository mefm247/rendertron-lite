import puppeteer from "@cloudflare/puppeteer";

// Define the Rendertron endpoint URL for the default behavior.
const DEFAULT_RENDER_ENDPOINT = 'https://rendertron-lite.joyjet.workers.dev/';

/**
 * Welcome to Cloudflare Workers! This worker can either proxy a Rendertron request
 * or perform its own rendering and HTML parsing based on a flag.
 */

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const targetUrl = u.searchParams.get("target");

    if (!targetUrl) {
      return new Response(JSON.stringify({
        error: 'Missing `target` query parameter.',
        example: `${u.origin}/?target=https://example.com`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check for the `analyze=true` flag to switch behavior.
    if (u.searchParams.get('analyze') === 'true') {
      // Use internal rendering and analysis logic
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

        const parsedData = parseHtml(html);
        const pageData = {
          PAGE: parsedData,
          url: targetUrl
        };

        return new Response(JSON.stringify(pageData, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600'
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({
          error: 'Failed to process the request.',
          message: err?.message || String(err)
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      // Default behavior: proxy the request to the external Rendertron endpoint
      const rendertronUrl = `${DEFAULT_RENDER_ENDPOINT}?url=${encodeURIComponent(targetUrl)}&waitFor=networkidle0`;
      
      try {
        const response = await fetch(rendertronUrl);

        if (!response.ok) {
          throw new Error(`Rendertron error: ${response.status} ${response.statusText}`);
        }

        return new Response(response.body, {
          status: response.status,
          headers: response.headers
        });
      } catch (err) {
        return new Response(JSON.stringify({
          error: 'Failed to proxy the request to the default endpoint.',
          message: err?.message || String(err)
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  },
};

/**
 * Parses the HTML string using the HTMLRewriter API.
 * This is a synchronous function that processes the HTML once it's available.
 * @param {string} html The raw HTML string.
 * @returns {object} The structured page data.
 */
function parseHtml(html) {
  const parser = new HTMLRewriter();
  const result = {
    HEADER: { LOGO: {}, NAVIGATION: { LINKS: [] } },
    HERO: { HEADING: {}, IMAGE: {}, BUTTON: {} },
    SECTION: [],
    FOOTER: { TEXT: {}, LINKS: [] },
    PAGE_INTENT: { description: null }
  };

  parser.on('header img', {
    element: (img) => {
      result.HEADER.LOGO = {
        src: img.getAttribute('src') || '',
        alt: img.getAttribute('alt') || '',
        classes: (img.getAttribute('class') || '').split(' ').filter(c => c)
      };
    }
  }).on('header nav a', {
    element: (link) => {
      result.HEADER.NAVIGATION.LINKS.push({
        text: link.text || '',
        href: link.getAttribute('href') || '',
        target: link.getAttribute('target') || '',
        classes: (link.getAttribute('class') || '').split(' ').filter(c => c),
        ariaLabel: link.getAttribute('aria-label') || ''
      });
    }
  });

  parser.on('.hero h1, .jumbotron h1, .main-banner h1', {
    element: (h1) => {
      result.HERO.HEADING = {
        text: h1.text || '',
        htmlTag: 'h1',
        classes: (h1.getAttribute('class') || '').split(' ').filter(c => c),
        id: h1.getAttribute('id') || ''
      };
    }
  }).on('.hero img, .jumbotron img, .main-banner img', {
    element: (img) => {
      result.HERO.IMAGE = {
        src: img.getAttribute('src') || '',
        alt: img.getAttribute('alt') || '',
        width: img.getAttribute('width') || '',
        height: img.getAttribute('height') || '',
        classes: (img.getAttribute('class') || '').split(' ').filter(c => c)
      };
    }
  }).on('.hero a, .hero button, .jumbotron a, .jumbotron button, .main-banner a, .main-banner button', {
    element: (button) => {
      if (!result.HERO.BUTTON.text) {
        result.HERO.BUTTON = {
          text: button.text || '',
          href: button.tagName === 'a' ? button.getAttribute('href') || '' : null,
          type: button.tagName === 'a' ? 'link' : 'button',
          classes: (button.getAttribute('class') || '').split(' ').filter(c => c)
        };
      }
    }
  });

  let sectionIndex = 0;
  parser.on('section, article', {
    element: (section) => {
      const sectionData = {
        section_index: sectionIndex++,
        HEADING: {},
        TEXTS: [],
        LIST: { LIST_ITEMS: [] }
      };

      section.on('h2, h3, h4', {
        element: (heading) => {
          if (!sectionData.HEADING.text) {
            sectionData.HEADING = {
              text: heading.text || '',
              htmlTag: heading.tagName,
              id: heading.getAttribute('id') || '',
              classes: (heading.getAttribute('class') || '').split(' ').filter(c => c)
            };
          }
        }
      });
      section.on('p', {
        element: (p) => {
          if (p.text()) {
            sectionData.TEXTS.push({
              text: p.text(),
              classes: (p.getAttribute('class') || '').split(' ').filter(c => c)
            });
          }
        }
      });
      section.on('ul li, ol li', {
        element: (li) => {
          if (li.text()) {
            sectionData.LIST.LIST_ITEMS.push({
              text: li.text(),
              classes: (li.getAttribute('class') || '').split(' ').filter(c => c)
            });
          }
        }
      });
      result.SECTION.push(sectionData);
    }
  });

  parser.on('footer p', {
    element: (p) => {
      if (!result.FOOTER.TEXT.text) {
        result.FOOTER.TEXT = {
          text: p.text || '',
          classes: (p.getAttribute('class') || '').split(' ').filter(c => c)
        };
      }
    }
  }).on('footer a', {
    element: (link) => {
      result.FOOTER.LINKS.push({
        text: link.text || '',
        href: link.getAttribute('href') || ''
      });
    }
  });

  return result;
}