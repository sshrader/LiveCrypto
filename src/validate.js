/**
 * Checks on what the model writes before anything goes on air.
 * The number check is a guard, not a proof: it catches figures that do not appear in the source text.
 */

const MULT = {
  k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9, t: 1e12, trillion: 1e12,
};

export function extractNumbers(text) {
  const out = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(thousand|million|billion|trillion|[kmbt])?(?![a-z0-9])/gi;
  let m;
  while ((m = re.exec(String(text)))) {
    const base = parseFloat(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
    const mult = m[3] ? MULT[m[3].toLowerCase()] : 1;
    if (Number.isFinite(base)) out.push(base * mult);
  }
  return out;
}

export function allowedNumbers(item) {
  const text = [item.title, item.summary, ...(item.also || []).map((a) => a.title || '')].join(' ');
  return extractNumbers(text);
}

/** Small counts and years are fine. Anything else must match a number in the source within 2%. */
export function checkNumbers(text, allowed, label, errors) {
  for (const n of extractNumbers(text)) {
    if (n <= 31) continue;
    if (Number.isInteger(n) && n >= 1990 && n <= 2035) continue;
    const ok = allowed.some((a) => Math.abs(a - n) <= Math.max(0.02 * Math.abs(a), 0.0005));
    if (!ok) errors.push(`${label}: number ${n} is not in the source`);
  }
}

const ADVICE =
  /\b(buy now|sell now|you should (?:buy|sell|invest|ape)|go long|go short|guaranteed|can'?t lose|cannot lose|risk[- ]free|to the moon|load up|ape in|100x|1000x|financial freedom|get in (?:now|early)|don'?t miss)\b/i;
const LINKISH = /(https?:\/\/|www\.|@\w)/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/; // eslint-disable-line no-control-regex

const KINDS = new Set(['breaking', 'trending', 'desk']);
const DIRS = new Set(['up', 'down', 'flat']);
const STATES = new Set(['ok', 'warn', 'bad']);
const WHO = new Set(['lotti', 'bram']);

const hasControl = (v) =>
  typeof v === 'string' ? CONTROL.test(v)
    : Array.isArray(v) ? v.some(hasControl)
    : v && typeof v === 'object' ? Object.values(v).some(hasControl)
    : false;
const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function validateStory(raw, item) {
  const errors = [];
  const market = item.kind === 'market';
  const allowed = allowedNumbers(item);

  const story = {
    kind: str(raw?.kind),
    tag: str(raw?.tag).toUpperCase().slice(0, 12),
    headline: str(raw?.headline),
    summary: str(raw?.summary),
    stat: {
      label: str(raw?.stat?.label),
      value: str(raw?.stat?.value),
      sub: str(raw?.stat?.sub),
      dir: str(raw?.stat?.dir),
    },
    facts: Array.isArray(raw?.facts)
      ? raw.facts.map((f) => ({ k: str(f?.k), v: str(f?.v), s: str(f?.s) }))
      : [],
    lines: Array.isArray(raw?.lines) ? raw.lines.map((l) => [str(l?.who), str(l?.text)]) : [],
  };

  if (!KINDS.has(story.kind)) errors.push('kind is not allowed');
  if (!story.tag) errors.push('tag is empty');
  if (!story.headline || story.headline.length > 56) errors.push('headline must be 1-56 characters');
  if (!story.summary || story.summary.length > 420) errors.push('summary must be 1-420 characters');

  if (!market) {
    const s = story.stat;
    if (!s.label || s.label.length > 16) errors.push('stat.label must be 1-16 characters');
    if (!s.value || s.value.length > 11) errors.push('stat.value must be 1-11 characters');
    if (!s.sub || s.sub.length > 40) errors.push('stat.sub must be 1-40 characters');
    if (!DIRS.has(s.dir)) errors.push('stat.dir is not allowed');
    if (story.facts.length !== 3) errors.push('exactly 3 facts are required');
    for (const f of story.facts) {
      if (!f.k || f.k.length > 13) errors.push('fact key must be 1-13 characters');
      if (!f.v || f.v.length > 12) errors.push('fact value must be 1-12 characters');
      if (!STATES.has(f.s)) errors.push('fact state is not allowed');
    }
    checkNumbers(s.value, allowed, 'stat.value', errors);
    checkNumbers(s.sub, allowed, 'stat.sub', errors);
    for (const f of story.facts) checkNumbers(f.v, allowed, 'fact', errors);
  }

  if (story.lines.length < 4 || story.lines.length > 6) errors.push('4 to 6 dialogue lines are required');
  for (const [who, text] of story.lines) {
    if (!WHO.has(who)) errors.push('unknown speaker');
    if (!text || text.length > 260) errors.push('a dialogue line must be 1-260 characters');
    checkNumbers(text, allowed, 'dialogue', errors);
  }
  checkNumbers(story.headline, allowed, 'headline', errors);
  checkNumbers(story.summary, allowed, 'summary', errors);

  const everything = [story.headline, story.summary, story.stat.label, story.stat.value, story.stat.sub,
    ...story.facts.flatMap((f) => [f.k, f.v]), ...story.lines.map((l) => l[1])].join(' \n ');
  if (ADVICE.test(everything)) errors.push('contains advice or hype wording');
  if (LINKISH.test(everything)) errors.push('contains a link or handle');
  if (hasControl(raw)) errors.push('contains control characters');

  return { ok: errors.length === 0, errors: [...new Set(errors)], story };
}
