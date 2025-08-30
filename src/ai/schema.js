// src/ai/schema.js

export const SCREENSHOT_ANALYSIS_PROMPT = `You are an expert in visual-to-structure translation for websites.
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

export const ANALYSIS_SCHEMA = {
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

export const MERGE_PROMPT = `You will receive:
1) A DOM-derived structure (rough, from HTML parsing).
2) A screenshot of the page.
3) Instructions about MODE.

If MODE is "vision-only": Analyze only the screenshot with the strict JSON schema below, ignoring the DOM structure, but you may reference it for naming hints if needed. Output MUST be strictly valid JSON.

If MODE is "merge": You are given both a DOM-derived structure and a vision-derived structure. Merge them into a single, consistent structure that follows the exact JSON schema below. When the two sources conflict:
- Prefer the screenshot (vision) for visual truth (layout, what is actually visible).
- Use the DOM structure to fill in missing text or to split large text blocks when helpful.
- Ensure every visible section from the screenshot is represented. Do not invent content.
- Be exhaustive: include header, hero, stats, navigation, footer details, etc.
- Output MUST be strictly valid JSON and conform to the schema exactly.

DOM_STRUCTURE_JSON:
{{DOM_STRUCTURE_JSON}}

VISION_STRUCTURE_JSON (may be empty if MODE is "vision-only"):
{{VISION_STRUCTURE_JSON}}

=== Strict JSON Schema to follow ===
(Same as ANALYSIS_SCHEMA in this codebase; you do not need to restate it in your output — just follow it.)`;
