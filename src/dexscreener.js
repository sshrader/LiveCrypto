import { getJson, sha1 } from './util.js';

const BASE = 'https://api.dexscreener.com';
const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Token names and symbols are written by whoever launched the token, so treat them as untrusted. */
const safeName = (s, max = 24) =>
  String(s ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (x) => (Math.round(x * 10) / 10).toString();

export function fmtUsd(n) {
  if (n >= 1e9) return '$' + (n >= 1e10 ? Math.round(n / 1e9) : round1(n / 1e9)) + 'B';
  if (n >= 1e6) return '$' + (n >= 1e7 ? Math.round(n / 1e6) : round1(n / 1e6)) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

export function fmtPct(n) {
  const a = Math.abs(n);
  return (n < 0 ? '-' : '+') + (a >= 10 ? String(Math.round(a)) : round1(a)) + '%';
}

export function fmtAge(hours) {
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + ' MIN';
  if (hours < 48) return Math.round(hours) + ' HRS';
  return Math.round(hours / 24) + ' DAYS';
}

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

/** Pick the best pair per Solana token, apply the filters, rank by one-hour price change. */
export function selectMovers(pairs, cfg, now = Date.now()) {
  const best = new Map();
  for (const p of pairs) {
    if (!p || p.chainId !== 'solana' || typeof p.baseToken?.address !== 'string') continue;
    const liq = num(p.liquidity?.usd);
    if (liq === null) continue;
    const cur = best.get(p.baseToken.address);
    if (!cur || liq > cur.liq) best.set(p.baseToken.address, { p, liq });
  }
  const movers = [];
  for (const { p, liq } of best.values()) {
    const c1 = num(p.priceChange?.h1);
    const v1 = num(p.volume?.h1);
    if (c1 === null || v1 === null) continue;
    if (liq < cfg.dex.minLiquidityUsd || v1 < cfg.dex.minVolume1hUsd) continue;
    const created = num(p.pairCreatedAt);
    const pairOk = typeof p.pairAddress === 'string' && /^[A-Za-z0-9]+$/.test(p.pairAddress);
    movers.push({
      symbol: safeName(p.baseToken.symbol, 12) || '?',
      name: safeName(p.baseToken.name, 24),
      address: p.baseToken.address,
      url: pairOk ? `https://dexscreener.com/solana/${p.pairAddress}` : '',
      change1h: c1,
      change24h: num(p.priceChange?.h24),
      vol1h: v1,
      liquidityUsd: liq,
      fdv: num(p.fdv),
      marketCap: num(p.marketCap),
      ageHours: created ? (now - created) / 3.6e6 : null,
      buys1h: num(p.txns?.h1?.buys),
      sells1h: num(p.txns?.h1?.sells),
    });
  }
  movers.sort((a, b) => b.change1h - a.change1h);
  return movers.slice(0, cfg.dex.top);
}

function moverFacts(m) {
  const liqState = m.liquidityUsd < 100_000 ? 'bad' : m.liquidityUsd < 250_000 ? 'warn' : 'ok';
  const ageState = m.ageHours === null ? 'warn' : m.ageHours < 24 ? 'bad' : m.ageHours < 168 ? 'warn' : 'ok';
  const volState = m.vol1h > 3 * m.liquidityUsd ? 'warn' : 'ok';
  return [
    { k: 'LIQUIDITY', v: fmtUsd(m.liquidityUsd), s: liqState },
    { k: 'TOKEN AGE', v: m.ageHours === null ? 'UNKNOWN' : fmtAge(m.ageHours), s: ageState },
    { k: '1H VOLUME', v: fmtUsd(m.vol1h), s: volState },
  ];
}

/** Turn the ranked movers into one story item. Every figure here is computed in code. */
export function moversToItem(movers, cfg, now = Date.now()) {
  if (!movers.length) return null;
  const key = movers.map((m) => m.address).sort().join(',');
  const id = 'mv-' + sha1(key + '|' + Math.floor(now / 3.6e6)).slice(0, 10);
  const lines = movers.map((m, i) => {
    const bits = [`${i + 1}. ${m.symbol}${m.name ? ` (${m.name})` : ''}: price change ${m.change1h.toFixed(1)} percent in 1 hour`];
    if (m.change24h !== null) bits.push(`${m.change24h.toFixed(1)} percent in 24 hours`);
    bits.push(`liquidity ${money(m.liquidityUsd)}`, `1-hour volume ${money(m.vol1h)}`);
    if (m.ageHours !== null) bits.push(`token age ${m.ageHours < 48 ? Math.round(m.ageHours) + ' hours' : Math.round(m.ageHours / 24) + ' days'}`);
    if (m.marketCap !== null) bits.push(`market cap ${money(m.marketCap)}`);
    else if (m.fdv !== null) bits.push(`fully diluted value ${money(m.fdv)}`);
    return bits.join(', ') + '.';
  });
  const top = movers[0];
  const summary =
    `Solana tokens from DexScreener's boosted lists, filtered for at least ${money(cfg.dex.minLiquidityUsd)} liquidity and ${money(cfg.dex.minVolume1hUsd)} one-hour volume, ranked by one-hour price change. ` +
    `Boosts are paid promotion, so this list is not an organic ranking. ` +
    lines.join(' ');
  return {
    id,
    memberIds: [id],
    kind: 'market',
    key,
    title: 'Boosted Solana tokens with the biggest one-hour moves',
    url: top.url,
    outlet: 'DexScreener',
    publishedAt: new Date(now).toISOString(),
    summary,
    also: movers.slice(1).filter((m) => m.url).map((m) => ({ outlet: `${m.symbol} on DexScreener`, url: m.url })),
    score: 3,
    computed: {
      stat: {
        label: (top.symbol + ' 1H').slice(0, 16),
        value: fmtPct(top.change1h).slice(0, 11),
        sub: 'BOOSTED LIST · DEXSCREENER',
        dir: top.change1h > 0 ? 'up' : top.change1h < 0 ? 'down' : 'flat',
      },
      facts: moverFacts(top),
    },
  };
}

export async function fetchMarketItem(cfg, deps, now = Date.now()) {
  const lists = await Promise.allSettled([
    getJson(`${BASE}/token-boosts/top/v1`, deps),
    getJson(`${BASE}/token-boosts/latest/v1`, deps),
  ]);
  const addrs = new Set();
  for (const l of lists) {
    if (l.status !== 'fulfilled' || !Array.isArray(l.value)) continue;
    for (const e of l.value) {
      if (e?.chainId === 'solana' && typeof e.tokenAddress === 'string' && SOLANA_ADDR.test(e.tokenAddress)) addrs.add(e.tokenAddress);
    }
  }
  if (!addrs.size) {
    if (lists.every((l) => l.status === 'rejected')) throw new Error('boost lists unavailable');
    return null;
  }
  const list = [...addrs].slice(0, 90);
  const pairs = [];
  for (let i = 0; i < list.length; i += 30) {
    try {
      const r = await getJson(`${BASE}/tokens/v1/solana/${list.slice(i, i + 30).join(',')}`, deps);
      if (Array.isArray(r)) pairs.push(...r);
    } catch {
      /* keep what we have */
    }
  }
  return moversToItem(selectMovers(pairs, cfg, now), cfg, now);
}
