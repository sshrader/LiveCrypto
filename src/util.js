import crypto from 'node:crypto';

export const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

export const hoursSince = (iso, now = Date.now()) => (now - Date.parse(iso)) / 3.6e6;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
  hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

export function stripHtml(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** Turn feed markup into short plain text. */
export function cleanText(raw, max = 500) {
  let t = String(raw ?? '');
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t);
  t = stripHtml(t);
  t = decodeEntities(t);
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return t;
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export async function getText(url, deps, { timeoutMs = 15000, accept = '*/*' } = {}) {
  const res = await deps.fetchImpl(url, {
    headers: { 'user-agent': deps.userAgent, accept },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 3_000_000) throw new Error('response too large');
  return text;
}

export async function getJson(url, deps, opts = {}) {
  return JSON.parse(await getText(url, deps, { accept: 'application/json', ...opts }));
}
