import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Check if this is the analyze-html endpoint
    if (url.pathname === '/analyze-html') {
      const targetUrl = url.searchParams.get('target');
      
      if (!targetUrl) {
        return new Response(JSON.stringify({ 
          error: 'Missing target URL parameter',
          example: `${url.origin}/analyze-html?target=https://example.com`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      try {
        // Validate URL
        new URL(targetUrl);
        
        // Launch Puppeteer and render the page
        const browser = await puppeteer.launch(env.MYBROWSER);
        let html = '';
        
        try {
          const page = await browser.newPage();
          await page.setViewport({ width: 1280, height: 800 });
          
          // Navigate to the target URL and wait for network idle
          await page.goto(targetUrl, { 
            waitUntil: "networkidle0", 
            timeout: 45000 
          });
          
          // Get the fully rendered HTML
          html = await page.content();
        } finally {
          try {
            if (browser) await browser.close();
          } catch (e) {
            console.error('Error closing browser:', e);
          }
        }
        
        // Parse HTML and extract structured data
        const structuredData = parseHTML(html, targetUrl);
        
        return new Response(JSON.stringify(structuredData, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: 'Failed to analyze HTML',
          details: error.message 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    return new Response('Not Found', { status: 404 });
  },
};

function parseHTML(html, originalUrl) {
  const result = {
    PAGE: {
      HEADER: {
        LOGO: null,
        NAVIGATION: {
          LINKS: []
        }
      },
      HERO: {
        HEADING: null,
        IMAGE: null,
        BUTTON: null
      },
      SECTION: [],
      FOOTER: {
        TEXT: null,
        LINKS: []
      },
      PAGE_INTENT: {
        description: null
      }
    },
    url: originalUrl
  };
  
  // Extract HEADER
  result.PAGE.HEADER = extractHeader(html);
  
  // Extract HERO section
  result.PAGE.HERO = extractHero(html);
  
  // Extract SECTIONS
  result.PAGE.SECTION = extractSections(html);
  
  // Extract FOOTER
  result.PAGE.FOOTER = extractFooter(html);
  
  return result;
}

function extractHeader(html) {
  const header = {
    LOGO: null,
    NAVIGATION: {
      LINKS: []
    }
  };
  
  // Find header element
  const headerMatch = html.match(/<header[^>]*>([\s\S]*?)<\/header>/i);
  if (headerMatch) {
    const headerContent = headerMatch[1];
    
    // Extract logo - look for img tags with logo-related classes or in logo containers
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
    
    // Extract navigation links
    const navMatch = headerContent.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
    if (navMatch) {
      header.NAVIGATION.LINKS = extractLinks(navMatch[1]);
    } else {
      // Try to find links directly in header if no nav element
      const headerLinks = extractLinks(headerContent);
      // Filter out logo link if present
      header.NAVIGATION.LINKS = headerLinks.filter(link => 
        !link.href.match(/^#$|^\/$/) || link.text.length > 0
      ).slice(0, 10);
    }
  }
  
  return header;
}

function extractHero(html) {
  const hero = {
    HEADING: null,
    IMAGE: null,
    BUTTON: null
  };
  
  // Look for hero section patterns
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
    if (match) {
      const heroContent = match[1];
      
      // Extract heading (prioritize h1, then h2)
      const h1Match = heroContent.match(/<h1[^>]*(?:id="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/h1>/i);
      const h2Match = heroContent.match(/<h2[^>]*(?:id="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/h2>/i);
      
      const headingMatch = h1Match || h2Match;
      if (headingMatch) {
        hero.HEADING = {
          text: cleanText(headingMatch[3]),
          htmlTag: h1Match ? 'h1' : 'h2',
          id: headingMatch[1] || "",
          classes: headingMatch[2] ? headingMatch[2].split(' ').filter(c => c) : []
        };
      }
      
      // Extract hero image (first prominent image)
      const imgMatches = heroContent.matchAll(/<img[^>]*>/gi);
      for (const imgMatch of imgMatches) {
        const imgData = extractImageData(imgMatch[0]);
        // Skip small images (likely icons)
        if (!imgData.src.match(/icon|logo|avatar/i)) {
          hero.IMAGE = imgData;
          break;
        }
      }
      
      // Extract CTA button/link
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
      
      // If we found hero content, stop searching
      if (hero.HEADING || hero.IMAGE) {
        break;
      }
    }
  }
  
  return hero;
}

function extractSections(html) {
  const sections = [];
  
  // Remove header and footer to avoid duplication
  let cleanHtml = html.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  cleanHtml = cleanHtml.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  
  // Find all section and article elements
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
      
      // Skip if this looks like hero, header, or footer
      if (sectionContent.match(/class="[^"]*(?:hero|header|footer|nav)[^"]*"/i)) {
        continue;
      }
      
      const section = {
        section_index: sectionIndex,
        HEADING: null,
        TEXTS: [],
        LIST: null
      };
      
      // Extract heading (h1-h6)
      const headingMatch = sectionContent.match(/<(h[1-6])[^>]*(?:id="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/\1>/i);
      if (headingMatch) {
        section.HEADING = {
          text: cleanText(headingMatch[4]),
          htmlTag: headingMatch[1],
          id: headingMatch[2] || "",
          classes: headingMatch[3] ? headingMatch[3].split(' ').filter(c => c) : []
        };
      }
      
      // Extract paragraphs
      const paragraphs = sectionContent.matchAll(/<p[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/gi);
      for (const p of paragraphs) {
        const text = cleanText(p[2]);
        if (text && text.length > 10) { // Skip very short paragraphs
          section.TEXTS.push({
            text: text,
            classes: p[1] ? p[1].split(' ').filter(c => c) : []
          });
        }
      }
      
      // Extract lists (ul/ol)
      const listMatch = sectionContent.match(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/i);
      if (listMatch) {
        const listItems = [];
        const itemMatches = listMatch[2].matchAll(/<li[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/li>/gi);
        
        for (const item of itemMatches) {
          const text = cleanText(item[2]);
          if (text) {
            listItems.push({
              text: text,
              classes: item[1] ? item[1].split(' ').filter(c => c) : []
            });
          }
        }
        
        if (listItems.length > 0) {
          section.LIST = {
            LIST_ITEMS: listItems
          };
        }
      }
      
      // Only add section if it has meaningful content
      if (section.HEADING || section.TEXTS.length > 0 || section.LIST) {
        sections.push(section);
        sectionIndex++;
      }
    }
  }
  
  return sections;
}

function extractFooter(html) {
  const footer = {
    TEXT: null,
    LINKS: []
  };
  
  // Find footer element
  const footerMatch = html.match(/<footer[^>]*>([\s\S]*?)<\/footer>/i);
  if (footerMatch) {
    const footerContent = footerMatch[1];
    
    // Extract copyright or main text
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
        footer.TEXT = {
          text: cleanText(textMatch[1]),
          classes: classMatch ? classMatch[1].split(' ').filter(c => c) : []
        };
        break;
      }
    }
    
    // If no copyright found, try first paragraph
    if (!footer.TEXT) {
      const pMatch = footerContent.match(/<p[^>]*(?:class="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch) {
        footer.TEXT = {
          text: cleanText(pMatch[2]),
          classes: pMatch[1] ? pMatch[1].split(' ').filter(c => c) : []
        };
      }
    }
    
    // Extract footer links
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
    classes: classMatch ? classMatch[1].split(' ').filter(c => c) : []
  };
}

function extractButtonData(buttonTag) {
  // Extract text content
  const textMatch = buttonTag.match(/>([^<]*)</i);
  let buttonText = "";
  
  if (textMatch) {
    buttonText = cleanText(textMatch[1]);
  } else {
    // Try to extract text from nested spans or other elements
    const nestedTextMatch = buttonTag.match(/<(?:span|div)[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
    if (nestedTextMatch) {
      buttonText = cleanText(nestedTextMatch[1]);
    }
  }
  
  const hrefMatch = buttonTag.match(/href="([^"]*)"/i);
  const classMatch = buttonTag.match(/class="([^"]*)"/i);
  const isLink = buttonTag.toLowerCase().startsWith('<a');
  
  return {
    text: buttonText,
    href: hrefMatch ? hrefMatch[1] : "",
    type: isLink ? "link" : "button",
    classes: classMatch ? classMatch[1].split(' ').filter(c => c) : []
  };
}

function extractLinks(content) {
  const links = [];
  const linkMatches = content.matchAll(/<a[^>]*(?:href="([^"]*)")?[^>]*(?:target="([^"]*)")?[^>]*(?:class="([^"]*)")?[^>]*(?:aria-label="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/gi);
  
  for (const match of linkMatches) {
    const text = cleanText(match[5]);
    const href = match[1] || "";
    
    // Only add if has both text and href, and it's not just an anchor
    if (text && href && !href.startsWith('#')) {
      links.push({
        text: text,
        href: href,
        target: match[2] || "",
        classes: match[3] ? match[3].split(' ').filter(c => c) : [],
        ariaLabel: match[4] || ""
      });
    }
  }
  
  // Remove duplicate links
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
  
  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&copy;/g, '©')
    .replace(/&reg;/g, '®')
    .replace(/&trade;/g, '™');
  
  // Clean whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}