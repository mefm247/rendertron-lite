// src/parsers/htmlParser.js
// This is the extraction logic split from handlers/structure.js

export function parseHTML(html, originalUrl) {
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

// --- helper functions ---
function extractHeader(html) {
  const header = { LOGO: null, NAVIGATION: { LINKS: [] } };
  const headerMatch = html.match(/<header[^>]*>([\s\S]*?)<\/header>/i);
  if (headerMatch) {
    const headerContent = headerMatch[1];
    const logoMatch = headerContent.match(/<img[^>]*logo[^>]*>/i);
    if (logoMatch) {
      header.LOGO = extractImageData(logoMatch[0]);
    }
    const navMatch = headerContent.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
    if (navMatch) {
      header.NAVIGATION.LINKS = extractLinks(navMatch[1]);
    }
  }
  return header;
}

function extractHero(html) {
  const hero = { HEADING: null, IMAGE: null, BUTTON: null };
  const heroMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (heroMatch) hero.HEADING = { text: cleanText(heroMatch[1]), htmlTag: "h1" };
  return hero;
}

function extractSections(html) {
  const sections = [];
  const sectionMatches = html.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/gi);
  let i = 0;
  for (const match of sectionMatches) {
    const sectionContent = match[1];
    const heading = sectionContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (heading) {
      sections.push({ section_index: i, HEADING: { text: cleanText(heading[1]), htmlTag: "h2" } });
      i++;
    }
  }
  return sections;
}

function extractFooter(html) {
  const footer = { TEXT: null, LINKS: [] };
  const footerMatch = html.match(/<footer[^>]*>([\s\S]*?)<\/footer>/i);
  if (footerMatch) {
    footer.TEXT = { text: cleanText(footerMatch[1]) };
  }
  return footer;
}

function extractImageData(imgTag) {
  const srcMatch = imgTag.match(/src="([^"]*)"/i);
  const altMatch = imgTag.match(/alt="([^"]*)"/i);
  return { src: srcMatch ? srcMatch[1] : "", alt: altMatch ? altMatch[1] : "" };
}

function extractLinks(content) {
  const links = [];
  const linkMatches = content.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of linkMatches) {
    links.push({ href: match[1], text: cleanText(match[2]) });
  }
  return links;
}

function cleanText(text) {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}