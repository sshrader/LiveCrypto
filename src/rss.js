import { cleanText } from './util.js';

/** Return the inner text of the first matching tag, or ''. */
function tagText(block, names) {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    const m = block.match(re);
    if (m) return m[1];
  }
  return '';
}

function linkOf(block) {
  // RSS: <link>https://...</link>
  const text = tagText(block, ['link']).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  if (/^https?:\/\//i.test(text)) return text;
  // Atom: <link rel="alternate" href="..."/> or <link href="..."/>
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const alt = links.find((a) => /rel\s*=\s*["']alternate["']/i.test(a)) || links.find((a) => !/rel\s*=/i.test(a)) || links[0];
  if (alt) {
    const h = alt.match(/href\s*=\s*["']([^"']+)["']/i);
    if (h && /^https?:\/\//i.test(h[1])) return h[1];
  }
  // Fallback: a permalink guid
  const guid = tagText(block, ['guid']).trim();
  return /^https?:\/\//i.test(guid) ? guid : '';
}

function dateOf(block) {
  const raw = tagText(block, ['pubDate', 'published', 'updated', 'dc:date']).trim();
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/** Parse RSS 2.0 or Atom text into plain-text items. */
export function parseFeed(xml, outlet) {
  const blocks = [...String(xml).matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const items = [];
  for (const b of blocks) {
    const title = cleanText(tagText(b, ['title']), 200);
    const url = linkOf(b);
    const publishedAt = dateOf(b);
    if (!title || !url || !publishedAt) continue;
    const summary = cleanText(tagText(b, ['description', 'summary', 'content:encoded', 'content']), 500);
    items.push({ title, url, publishedAt, summary, outlet });
  }
  return items;
}
