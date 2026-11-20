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
  const byId = new Map(items.map((i) => [i.id, i]));
  const stories = [];
  let rejected = [];
  const done = new Set();

  async function process(raw) {
    const bad = [];
    for (const r of raw) {
      const item = byId.get(r?.itemId);
      if (!item || done.has(item.id)) {
        bad.push({ itemId: String(r?.itemId), errors: ['unknown or duplicate itemId'] });
        continue;
      }
      done.add(item.id);
      const v = validateStory(r, item);
      if (!v.ok) {
        done.delete(item.id);
        bad.push({ itemId: item.id, errors: v.errors });
        continue;
      }
      stories.push(await attachAudio(assemble(v.story, item, deps.now()), cfg, deps));
    }
    return bad;
  }

  const first = await generateStories(items, cfg, deps);
  const notes = { ...(first.notes || {}) };
  rejected = await process(first);
  for (const it of items) {
    if (!done.has(it.id) && !rejected.some((r) => r.itemId === it.id)) rejected.push({ itemId: it.id, errors: [notes[it.id] || 'not returned by the model'] });
  }

  // One repair pass for the real writers: show the model what was wrong and ask again.
  const retry = rejected.filter((r) => byId.has(r.itemId) && !done.has(r.itemId));
  if (retry.length && !cfg.mockLlm && cfg.llmProvider === 'openai') {
    const fb = Object.fromEntries(retry.map((r) => [r.itemId, r.errors]));
    try {
      const again = await generateStories(retry.map((r) => byId.get(r.itemId)), cfg, deps, fb);
      const still = await process(again);
      for (const [id, why] of Object.entries(again.notes || {})) {
        const old = rejected.find((r) => r.itemId === id);
        if (old && !done.has(id)) old.errors = ['retry: ' + why];
      }
      rejected = rejected.filter((r) => !done.has(r.itemId)); // repaired ones leave the list
      for (const st of still) {
        const old = rejected.find((r) => r.itemId === st.itemId);
        if (old) old.errors = st.errors.map((e) => 'retry: ' + e);
      }
    } catch (e) {
      deps.log?.('repair pass failed:', e.message);
    }
  }
  return { stories, rejected };
}
