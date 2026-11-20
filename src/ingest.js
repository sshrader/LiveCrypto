import { getText, sha1 } from './util.js';
import { parseFeed } from './rss.js';

export async function fetchFeeds(cfg, deps) {
  const status = [];
  const all = [];
  await Promise.all(
    cfg.feeds.map(async (f) => {
      try {
        const xml = await getText(f.url, deps, {
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        });
        const items = parseFeed(xml, f.name);
        status.push({ name: f.name, ok: true, items: items.length });
        all.push(...items);
      } catch (e) {
        status.push({ name: f.name, ok: false, error: String(e.message || e).slice(0, 120) });
      }
    }),
  );
  status.sort((a, b) => a.name.localeCompare(b.name));
  return { items: all, status };
}

const STOP = new Set(
  'the and for with from that this are was were been has have had says say said after over into new more than will could would about out off how why what who which their his her they you your its not but can may amid'.split(' '),
);
const words = (t) =>
  new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)));
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};
const normUrl = (u) => {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return String(u).toLowerCase();
  }
};
export const urlId = (u) => sha1(normUrl(u)).slice(0, 12);

/**
 * Drop stale and already-covered items, group near-duplicate headlines from different outlets,
 * and rank what is left. Returns clusters shaped like story items.
 */
export function prepareItems(raw, cfg, now = Date.now(), seen = {}) {
  const maxAgeMs = cfg.maxItemAgeHours * 3.6e6;
  const fresh = raw
    .filter((it) => {
      const t = Date.parse(it.publishedAt);
      return Number.isFinite(t) && now - t <= maxAgeMs && t - now <= 3.6e6;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const clusters = [];
  const byUrl = new Set();
  for (const it of fresh) {
    const nu = normUrl(it.url);
    if (byUrl.has(nu)) continue;
    byUrl.add(nu);
    const w = words(it.title);
    const home = clusters.find((c) => jaccard(c.words, w) >= 0.5);
    if (home) home.members.push(it);
    else clusters.push({ lead: it, members: [it], words: w });
  }

  const out = [];
  for (const c of clusters) {
    const memberIds = c.members.map((m) => urlId(m.url));
    if (memberIds.some((id) => seen[id])) continue;
    const lead = c.lead;
    const others = c.members.slice(1).filter((m) => m.outlet !== lead.outlet);
    const outlets = new Set(c.members.map((m) => m.outlet));
    const text = `${lead.title} ${lead.summary}`.toLowerCase();
    const matches = cfg.topics.filter((t) => text.includes(t)).length;
    const ageH = (now - Date.parse(lead.publishedAt)) / 3.6e6;
    const score = 2 * Math.pow(2, -ageH / 6) + Math.min(2, matches * 0.5) + Math.min(1.8, 0.6 * (outlets.size - 1));
    out.push({
      id: memberIds[0],
      memberIds,
      kind: 'news',
      title: lead.title,
      url: lead.url,
      outlet: lead.outlet,
      publishedAt: lead.publishedAt,
      summary: lead.summary,
      also: others.slice(0, 3).map((m) => ({ outlet: m.outlet, url: m.url, title: m.title })),
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}
