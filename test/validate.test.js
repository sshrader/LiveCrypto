import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStory, extractNumbers } from '../src/validate.js';

const item = {
  id: 'abc',
  kind: 'news',
  title: 'Bitcoin falls to $81,000 as ETF outflows reach $679 million',
  summary: 'Bitcoin dropped about 2.3% to roughly 81,000 dollars. ETFs lost 679 million dollars over the week, and 672 million dollars of positions were liquidated.',
  outlet: 'Alpha News',
  also: [],
};

const good = () => ({
  itemId: 'abc',
  kind: 'desk',
  tag: 'markets',
  headline: 'Bitcoin slides toward 81K on ETF outflows',
  summary: 'Alpha News says bitcoin fell about 2.3% while ETFs saw outflows of 679 million dollars.',
  stat: { label: 'BTC', value: '$81K', sub: 'ALPHA NEWS', dir: 'down' },
  facts: [
    { k: 'ETF OUTFLOW', v: '$679M', s: 'warn' },
    { k: 'LIQUIDATED', v: '$672M', s: 'warn' },
    { k: 'CHECK', v: 'VERIFY', s: 'warn' },
  ],
  lines: [
    { who: 'lotti', text: 'Bitcoin took a tumble today.' },
    { who: 'bram', text: 'Alpha News reports it dropped about 2.3 percent to roughly 81 thousand dollars.' },
    { who: 'lotti', text: 'Why did it fall?' },
    { who: 'bram', text: 'ETFs lost 679 million dollars this week. Not financial advice.' },
  ],
});

test('extracts numbers with suffixes and separators', () => {
  const n = extractNumbers('$83.1K, 81,000, 1.2 million, 3.1 billion, 61%, 0.106');
  assert.deepEqual(n.map((x) => Math.round(x * 1000) / 1000), [83100, 81000, 1200000, 3100000000, 61, 0.106]);
});

test('accepts a faithful story and normalises the tag', () => {
  const v = validateStory(good(), item);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(v.story.tag, 'MARKETS');
  assert.deepEqual(v.story.lines[0], ['lotti', 'Bitcoin took a tumble today.']);
});

test('rejects a number that is not in the source', () => {
  const s = good();
  s.lines[1].text = 'Alpha News says bitcoin fell to 74,500 dollars.';
  const v = validateStory(s, item);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /74500/.test(e)));
});

test('rejects an invented figure in stat or facts', () => {
  const s = good();
  s.stat.value = '$95K';
  s.facts[0].v = '$1.2B';
  const v = validateStory(s, item);
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 2);
});

test('rejects advice and hype wording', () => {
  const s = good();
  s.lines[3].text = 'You should buy now before it goes to the moon.';
  assert.equal(validateStory(s, item).ok, false);
});

test('rejects links, handles and control characters', () => {
  let s = good();
  s.summary = 'Read more at https://evil.test/claim now.';
  assert.equal(validateStory(s, item).ok, false);
  s = good();
  s.lines[0].text = 'Follow @someone for more.';
  assert.equal(validateStory(s, item).ok, false);
  s = good();
  s.headline = 'Bitcoin slides\u0007';
  assert.equal(validateStory(s, item).ok, false);
});

test('enforces lengths and shapes', () => {
  let s = good();
  s.headline = 'x'.repeat(57);
  assert.equal(validateStory(s, item).ok, false);
  s = good();
  s.lines = s.lines.slice(0, 3);
  assert.equal(validateStory(s, item).ok, false);
  s = good();
  s.facts = s.facts.slice(0, 2);
  assert.equal(validateStory(s, item).ok, false);
  s = good();
  s.lines[0].who = 'narrator';
  assert.equal(validateStory(s, item).ok, false);
  s = good();
  s.kind = 'viral';
  assert.equal(validateStory(s, item).ok, false);
});

test('market items skip the stat and fact number checks (code supplies them)', () => {
  const m = { ...item, kind: 'market' };
  const s = good();
  s.stat.value = '+34%';
  s.facts[0].v = '$999K';
  assert.equal(validateStory(s, m).ok, true);
});

test('small counts and years are allowed without being in the source', () => {
  const s = good();
  s.lines[0].text = 'Three outlets covered it in 2026 and it was 12 hours ago.';
  assert.equal(validateStory(s, item).ok, true);
});
