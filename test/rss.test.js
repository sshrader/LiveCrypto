import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../src/rss.js';
import { cleanText } from '../src/util.js';
import { rssXml } from './helpers.js';

test('parses RSS items, unwraps CDATA and strips HTML', () => {
  const xml = rssXml([
    { title: 'Bitcoin &amp; ether slip 3%', url: 'https://alpha.test/a', hoursAgo: 1, summary: 'Prices fell <b>3%</b> &amp; volume rose.' },
  ]);
  const items = parseFeed(xml, 'Alpha');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Bitcoin & ether slip 3%');
  assert.equal(items[0].url, 'https://alpha.test/a');
  assert.equal(items[0].outlet, 'Alpha');
  assert.match(items[0].summary, /^Prices fell 3% & volume rose\./);
  assert.ok(!items[0].summary.includes('<'));
  assert.ok(Number.isFinite(Date.parse(items[0].publishedAt)));
});

test('parses Atom entries', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <title>Solana upgrade ships</title>
    <link rel="alternate" href="https://atom.test/post/1"/>
    <link rel="replies" href="https://atom.test/post/1/comments"/>
    <updated>2026-11-19T18:00:00Z</updated>
    <summary type="html">&lt;p&gt;Validators upgrade.&lt;/p&gt;</summary>
  </entry></feed>`;
  const items = parseFeed(xml, 'Atom');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://atom.test/post/1');
  assert.equal(items[0].summary, 'Validators upgrade.');
  assert.equal(items[0].publishedAt, '2026-11-19T18:00:00.000Z');
});

test('skips items without a title, link or date', () => {
  const xml = `<rss><channel>
    <item><title>No link</title><pubDate>Thu, 19 Nov 2026 18:00:00 GMT</pubDate></item>
    <item><link>https://x.test/1</link><pubDate>Thu, 19 Nov 2026 18:00:00 GMT</pubDate></item>
    <item><title>No date</title><link>https://x.test/2</link></item>
  </channel></rss>`;
  assert.equal(parseFeed(xml, 'X').length, 0);
});

test('ignores non-http links', () => {
  const xml = `<rss><channel><item><title>Bad</title><link>javascript:alert(1)</link><pubDate>Thu, 19 Nov 2026 18:00:00 GMT</pubDate></item></channel></rss>`;
  assert.equal(parseFeed(xml, 'X').length, 0);
});

test('cleanText truncates on a word boundary and removes control characters', () => {
  const t = cleanText('word '.repeat(200) + '\u0000\u0007', 40);
  assert.ok(t.length <= 41);
  assert.ok(t.endsWith('…'));
  assert.ok(!/[\u0000-\u001f]/.test(t));
});
