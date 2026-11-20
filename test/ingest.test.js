import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeeds, prepareItems, urlId } from '../src/ingest.js';
import { rssXml, res, testConfig, deps, NOW, iso } from './helpers.js';

const cfg = testConfig();

const raw = (title, outlet, hoursAgo, url, summary = 'Summary text.') => ({
  title, outlet, url, summary, publishedAt: iso(hoursAgo),
});

test('drops stale items and groups the same story from two outlets', () => {
  const items = [
    raw('Bitcoin falls below 81,000 as ETF outflows mount', 'Alpha News', 1, 'https://alpha.test/1'),
    raw('Bitcoin falls below 81,000 on ETF outflows mounting', 'Beta Wire', 2, 'https://beta.test/9'),
    raw('Solana meme coin launchpad volume surges', 'Alpha News', 3, 'https://alpha.test/2'),
    raw('Old news from last week', 'Alpha News', 24 * 7, 'https://alpha.test/3'),
  ];
  const out = prepareItems(items, cfg, NOW, {});
  assert.equal(out.length, 2);
  const btc = out.find((c) => /Bitcoin/.test(c.title));
  assert.equal(btc.also.length, 1);
  assert.equal(btc.also[0].outlet, 'Beta Wire');
  assert.equal(btc.memberIds.length, 2);
  assert.ok(!out.some((c) => /Old news/.test(c.title)));
});

test('items seen before are skipped, even when a different outlet leads the cluster', () => {
  const a = raw('Senate delays crypto market structure bill again', 'Alpha News', 1, 'https://alpha.test/s');
  const b = raw('Senate delays crypto market structure bill again today', 'Beta Wire', 0.5, 'https://beta.test/s');
  const seen = { [urlId(a.url)]: NOW };
  assert.equal(prepareItems([a, b], cfg, NOW, seen).length, 0);
});

test('ranks newer, on-topic, multi-outlet stories higher', () => {
  const items = [
    raw('Gardening tips for spring', 'Alpha News', 1, 'https://alpha.test/g'),
    raw('Solana memecoin Pump.fun launches surge', 'Alpha News', 1, 'https://alpha.test/m'),
    raw('Dogecoin rallies after Musk post', 'Beta Wire', 30, 'https://beta.test/d'),
  ];
  const out = prepareItems(items, cfg, NOW, {});
  assert.equal(out[0].title, 'Solana memecoin Pump.fun launches surge');
});

test('ignores items dated far in the future', () => {
  const items = [raw('From the future', 'Alpha News', -5, 'https://alpha.test/f')];
  assert.equal(prepareItems(items, cfg, NOW, {}).length, 0);
});

test('fetchFeeds keeps going when one feed fails', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('alpha')) return res(rssXml([{ title: 'Hello', url: 'https://alpha.test/1', hoursAgo: 1, summary: 's' }]));
    return res('nope', 503);
  };
  const { items, status } = await fetchFeeds(cfg, deps(fetchImpl));
  assert.equal(items.length, 1);
  assert.deepEqual(status.map((s) => [s.name, s.ok]), [['Alpha News', true], ['Beta Wire', false]]);
  assert.match(status[1].error, /503/);
});
