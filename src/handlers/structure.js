// src/handlers/structure.js
import { json } from "../utils/http.js";
import { logStart, logDone } from "../utils/logging.js";
import { renderPageGetHtml } from "../render/browser.js";

export async function handleStructure(env, params, tag) {
  if (!params.target) return json({ error: "Missing 'target' parameter" }, 400);
  const tStr = logStart(tag, "output=structure START");
  const { html } = await renderPageGetHtml(env, params.target);
  const structuredData = parseHTML(html, params.target);
  logDone(tag, tStr, "output=structure DONE");
  return json(structuredData, 200);
}

// --- Minimal parser (copied/split from your monolith). In next bundle, this will move to parsers/htmlParser.js ---
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