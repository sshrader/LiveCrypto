import { loadConfig } from '../src/config.js';

export const NOW = Date.parse('2026-11-19T20:00:00Z');
export const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3.6e6).toISOString();
export const rfc822 = (hoursAgo) => new Date(NOW - hoursAgo * 3.6e6).toUTCString();

export function rssXml(items) {
  const body = items
    .map(
      (i) => `<item>
  <title><![CDATA[${i.title}]]></title>
  <link>${i.url}</link>
  <pubDate>${rfc822(i.hoursAgo)}</pubDate>
  <description><![CDATA[<p>${i.summary}</p><p>Read more at the site.</p>]]></description>
</item>`,
    )
    .join('\n');
  return `<?xml version="1.0"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>t</title><atom:link href="https://x.test/feed" rel="self"/>${body}</channel></rss>`;
}

export function res(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

export function testConfig(over = {}) {
  const cfg = loadConfig({});
  return {
    ...cfg,
    feeds: [
      { name: 'Alpha News', url: 'https://alpha.test/rss' },
      { name: 'Beta Wire', url: 'https://beta.test/rss' },
    ],
    mockLlm: true,
    dataDir: over.dataDir || cfg.dataDir,
    ...over,
  };
}

export const deps = (fetchImpl, extra = {}) => ({
  fetchImpl,
  userAgent: 'test',
  now: () => NOW,
  log: () => {},
  ...extra,
});

export const SOL_A = 'So11111111111111111111111111111111111111112';
export const SOL_B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_C = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

export function pair(addr, symbol, over = {}) {
  return {
    chainId: 'solana',
    dexId: 'raydium',
    url: `https://dexscreener.com/solana/pair${symbol}`,
    pairAddress: `pair${symbol}`,
    baseToken: { address: addr, name: `${symbol} Coin`, symbol },
    quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'SOL', symbol: 'SOL' },
    priceUsd: '0.01',
    txns: { m5: { buys: 1, sells: 1 }, h1: { buys: 300, sells: 250 }, h6: { buys: 1, sells: 1 }, h24: { buys: 1, sells: 1 } },
    volume: { m5: 1, h1: 90000, h6: 1, h24: 1 },
    priceChange: { m5: 1, h1: 34.2, h6: 1, h24: 80.1 },
    liquidity: { usd: 212431, base: 1, quote: 1 },
    fdv: 4100000,
    marketCap: 3900000,
    pairCreatedAt: NOW - 19 * 24 * 3.6e6,
    ...over,
  };
}
