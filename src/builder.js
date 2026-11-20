import { generateStories } from './llm.js';
import { validateStory } from './validate.js';
import { attachAudio } from './tts.js';
import { fmtDate } from './util.js';

const httpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/** Combine the model's wording with data the code controls: links, dates, and market figures. */
function assemble(v, item, now) {
  const ageH = (now - Date.parse(item.publishedAt)) / 3.6e6;
  const market = item.kind === 'market';
  let kind = v.kind;
  if (market) kind = 'trending';
  else if (kind === 'breaking' && ageH > 3) kind = 'desk';
  const flag = market ? 'Paid boost list' : ageH > 72 ? 'Older report' : (item.also || []).length ? 'Several outlets' : 'Single outlet';
  return {
    id: 'st-' + item.id,
    kind,
    tag: market ? 'MOVERS' : v.tag,
    headline: v.headline,
    stat: market ? item.computed.stat : v.stat,
    facts: market ? item.computed.facts : v.facts,
    source: {
      outlet: item.outlet,
      url: httpUrl(item.url) ? item.url : '',
      date: fmtDate(item.publishedAt),
      publishedAt: item.publishedAt,
      flag,
      summary: v.summary,
    },
    also: (item.also || []).filter((a) => httpUrl(a.url)).map((a) => ({ outlet: a.outlet, url: a.url })),
    lines: v.lines,
    createdAt: new Date(now).toISOString(),
  };
}

export async function buildStories(items, cfg, deps) {
  const raw = await generateStories(items, cfg, deps);
  const byId = new Map(items.map((i) => [i.id, i]));
  const stories = [];
  const rejected = [];
  const done = new Set();
  for (const r of raw) {
    const item = byId.get(r?.itemId);
    if (!item || done.has(item.id)) {
      rejected.push({ itemId: String(r?.itemId), errors: ['unknown or duplicate itemId'] });
      continue;
    }
    done.add(item.id);
    const v = validateStory(r, item);
    if (!v.ok) {
      rejected.push({ itemId: item.id, errors: v.errors });
      continue;
    }
    const story = assemble(v.story, item, deps.now());
    stories.push(await attachAudio(story, cfg, deps));
  }
  for (const it of items) {
    if (!done.has(it.id)) rejected.push({ itemId: it.id, errors: ['not returned by the model'] });
  }
  return { stories, rejected };
}
