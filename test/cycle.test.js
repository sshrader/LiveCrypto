import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCycle } from '../src/cycle.js';
import { Store } from '../src/store.js';
import { rssXml, res, testConfig, deps, pair, SOL_A, SOL_B } from './helpers.js';

async function setup(over = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-'));
  const cfg = testConfig({ dataDir: dir, ...over });
  const store = new Store(dir);
  return { dir, cfg, store };
}

const world = (extra = {}) => async (url) => {
  if (url.includes('alpha.test')) return res(rssXml([
    { title: 'Bitcoin falls to $81,000 as ETF outflows reach $679 million', url: 'https://alpha.test/1', hoursAgo: 1, summary: 'Bitcoin dropped about 2.3% to roughly 81,000 dollars. ETFs lost 679 million dollars.' },
    { title: 'Solana memecoin launchpad volume surges', url: 'https://alpha.test/2', hoursAgo: 2, summary: 'Volume rose 40% on the platform.' },
  ]));
  if (url.includes('beta.test')) return res('down', 500);
  if (url.includes('token-boosts')) return res([{ chainId: 'solana', tokenAddress: SOL_A }, { chainId: 'solana', tokenAddress: SOL_B }]);
  if (url.includes('/tokens/v1/solana/')) return res([pair(SOL_A, 'WOB'), pair(SOL_B, 'FRG', { priceChange: { h1: 20 } })]);
  if (extra.other) return extra.other(url);
  return res('', 404);
};

test('a full cycle builds validated stories, survives a dead feed, and does not repeat itself', async () => {
  const { cfg, store } = await setup();
  const d = deps(world());
  const s1 = await runCycle(cfg, d, store);
  assert.equal(s1.errors.length, 0, s1.errors.join(';'));
  assert.ok(s1.built >= 2, `built ${s1.built}, rejected ${JSON.stringify(s1.rejected)}`);
  const ids = store.state.stories.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const news = store.state.stories.find((s) => s.source?.url === 'https://alpha.test/1');
  assert.ok(news, 'news story exists');
  assert.equal(news.lines.length >= 4, true);
  assert.ok(Array.isArray(news.lines[0]));
  assert.equal(store.state.feedStatus.find((f) => f.name === 'Beta Wire').ok, false);

  const before = store.state.stories.length;
  const s2 = await runCycle(cfg, d, store);
  const dup = store.state.stories.map((s) => s.id);
  assert.equal(new Set(dup).size, dup.length, 'no duplicate stories');
  assert.ok(store.state.stories.length - before <= 1, 'second pass adds at most a fresh item');
  assert.ok(s2.picked <= cfg.maxNewPerCycle * 2);
});

test('state is saved and reloaded', async () => {
  const { dir, cfg, store } = await setup();
  await runCycle(cfg, deps(world()), store);
  const again = new Store(dir);
  await again.load();
  assert.equal(again.state.stories.length, store.state.stories.length);
});

test('when every feed and DexScreener fail the cycle reports it and does not throw', async () => {
  const { cfg, store } = await setup();
  const s = await runCycle(cfg, deps(async () => res('', 500)), store);
  assert.ok(s.errors.some((e) => /every news feed failed/.test(e)));
  assert.equal(store.state.stories.length, 0);
});

test('old stories fall out of the window and the window is capped', async () => {
  const { cfg, store } = await setup({ maxStories: 2 });
  store.state.stories = [0, 1, 2].map((i) => ({ id: 'st-old' + i, createdAt: new Date(Date.parse('2026-11-19T19:00:00Z') - i * 1000).toISOString(), lines: [] }));
  store.state.stories.push({ id: 'st-ancient', createdAt: '2026-11-01T00:00:00Z', lines: [] });
  await runCycle(cfg, deps(async () => res('', 500)), store);
  assert.ok(store.state.stories.length <= 2);
  assert.ok(!store.state.stories.some((s) => s.id === 'st-ancient'));
});
