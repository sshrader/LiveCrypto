import { fetchFeeds, prepareItems } from './ingest.js';
import { fetchMarketItem } from './dexscreener.js';
import { buildStories } from './builder.js';
import { pruneAudio } from './tts.js';
import { SIGNOFF, WARMUP } from './static-segments.js';

const DAY = 24 * 3.6e6;

/** One pass: read feeds, pick the best new items, write stories, keep the rolling window tidy. */
export async function runCycle(cfg, deps, store) {
  const now = deps.now();
  const st = store.state;
  const summary = { startedAt: new Date(now).toISOString(), feeds: [], picked: 0, built: 0, rejected: [], errors: [] };

  const { items: raw, status } = await fetchFeeds(cfg, deps);
  st.feedStatus = status;
  summary.feeds = status;
  if (status.length && status.every((s) => !s.ok)) summary.errors.push('every news feed failed');

  let candidates = prepareItems(raw, cfg, now, st.seen).filter((c) => (st.failed[c.id]?.n || 0) < 2);

  let market = null;
  if (cfg.dex.enabled) {
    try {
      market = await fetchMarketItem(cfg, deps, now);
      if (market && (market.key === st.lastMoversKey || st.seen[market.id])) market = null;
    } catch (e) {
      summary.errors.push('dexscreener: ' + e.message);
    }
  }

  const limit = st.stories.length < 6 ? cfg.maxNewPerCycle * 2 : cfg.maxNewPerCycle;
  const picked = [];
  if (market) picked.push(market);
  for (const c of candidates) {
    if (picked.length >= limit) break;
    picked.push(c);
  }
  summary.picked = picked.length;

  st.lastRun = new Date(now).toISOString();

  if (picked.length) {
    let result;
    try {
      result = await buildStories(picked, cfg, deps);
    } catch (e) {
      // The writer itself failed (network, key, quota). Do not mark items as failed so they retry next cycle.
      st.lastError = `${new Date(now).toISOString()} ${e.message}`;
      summary.errors.push('writer: ' + e.message);
      await safeSave(store, deps);
      return summary;
    }
    const byId = new Map(picked.map((p) => [p.id, p]));
    for (const s of result.stories) {
      const item = byId.get(s.id.replace(/^st-/, ''));
      for (const id of item?.memberIds || []) st.seen[id] = now;
      if (item?.kind === 'market') st.lastMoversKey = item.key;
    }
    for (const r of result.rejected) {
      const prev = st.failed[r.itemId]?.n || 0;
      st.failed[r.itemId] = { n: prev + 1, ts: now };
    }
    st.stories.unshift(...result.stories);
    summary.built = result.stories.length;
    summary.rejected = result.rejected;
    if (result.rejected.length) deps.log?.('rejected', JSON.stringify(result.rejected));
    st.lastSuccess = new Date(now).toISOString();
    st.lastError = null;
  } else {
    st.lastSuccess = new Date(now).toISOString();
  }

  // Keep a rolling window
  st.stories = st.stories
    .filter((s) => now - Date.parse(s.createdAt) < cfg.storyTtlHours * 3.6e6)
    .slice(0, cfg.maxStories);
  for (const [id, ts] of Object.entries(st.seen)) if (now - ts > 7 * DAY) delete st.seen[id];
  for (const [id, v] of Object.entries(st.failed)) if (now - v.ts > 2 * DAY) delete st.failed[id];

  await safeSave(store, deps);
  await pruneAudio(cfg, [...st.stories, SIGNOFF, WARMUP], now).catch(() => {});
  return summary;
}

async function safeSave(store, deps) {
  try {
    await store.save();
  } catch (e) {
    deps.log?.('could not save state:', e.message);
  }
}
