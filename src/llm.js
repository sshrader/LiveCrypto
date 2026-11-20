import { SYSTEM, STORY_TOOL, buildUserMessage } from './prompt.js';
import { fmtDate } from './util.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Template stories so the whole pipeline and the page can be tested without an API key. */
export function mockStories(items) {
  return items.map((it) => {
    // Cut on a word boundary and never leave half a figure behind ("$679" from "$679 million").
    const cut = (t, n) => (t.length <= n ? t : t.slice(0, n - 3).split(' ').slice(0, -1).filter((w) => !/\d/.test(w)).join(' ') + '...');
    const title = cut(it.title, 56);
    const short = cut(it.title, 150);
    const date = fmtDate(it.publishedAt);
    return {
      itemId: it.id,
      kind: it.kind === 'market' ? 'trending' : 'desk',
      tag: it.kind === 'market' ? 'MOVERS' : 'NEWS',
      headline: title,
      summary: (it.summary || it.title).slice(0, 400),
      stat: { label: it.outlet.slice(0, 16), value: 'NEWS', sub: date.toUpperCase(), dir: 'flat' },
      facts: [
        { k: 'SOURCE', v: it.outlet.slice(0, 12).toUpperCase(), s: 'ok' },
        { k: 'PUBLISHED', v: date.slice(0, 12).toUpperCase(), s: 'ok' },
        { k: 'CHECK', v: 'VERIFY', s: 'warn' },
      ],
      lines: [
        { who: 'lotti', text: `Next up, a story from ${it.outlet}.` },
        { who: 'bram', text: `${short}` },
        { who: 'lotti', text: 'That is only the headline, so what is the catch?' },
        { who: 'bram', text: 'Read the original before you act on it. Not financial advice.' },
      ],
    };
  });
}

export const writerReady = (cfg) =>
  cfg.mockLlm || (cfg.llmProvider === 'openai' ? !!(cfg.llmKey || /localhost|127\.0\.0\.1/.test(cfg.llmBase)) : !!cfg.anthropicKey);
export const writerLabel = (cfg) =>
  cfg.mockLlm ? 'mock'
    : cfg.llmProvider === 'openai' ? (writerReady(cfg) ? `${cfg.llmModel} via ${new URL(cfg.llmBase).host}` : 'not configured')
    : cfg.anthropicKey ? `claude (${cfg.model})` : 'not configured';

/** Pull the first complete JSON object out of a model reply (handles code fences and chatter). */
export function extractJson(text) {
  const t = String(text || '');
  for (let start = t.indexOf('{'); start !== -1; start = t.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

const SHAPE = `Reply with ONLY one JSON object, no markdown and no commentary, in exactly this shape:
{"stories":[{"itemId":"<the item id>","kind":"breaking|desk|trending","tag":"MARKETS","headline":"...","summary":"...","stat":{"label":"BTC","value":"$83.1K","sub":"SOURCE NAME","dir":"up|down|flat"},"facts":[{"k":"LABEL","v":"VALUE","s":"ok|warn|bad"},{"k":"..","v":"..","s":"ok"},{"k":"..","v":"..","s":"warn"}],"lines":[{"who":"lotti","text":"..."},{"who":"bram","text":"..."},{"who":"lotti","text":"..."},{"who":"bram","text":"..."}]}]}`;

/** OpenAI-compatible writer: one item per request, JSON in plain text (free models are unreliable at tool calls). */
async function generateOpenAI(items, cfg, deps) {
  const out = [];
  for (let n = 0; n < items.length; n++) {
    if (n > 0) await sleep(cfg.llmDelayMs);
    const item = items[n];
    const body = {
      model: cfg.llmModel,
      temperature: 0.6,
      max_tokens: 2500,
      messages: [
        { role: 'system', content: SYSTEM.replace(/by calling publish_stories/g, 'in the JSON reply') },
        { role: 'user', content: buildUserMessage([item], deps.now()).replace(/by calling publish_stories\./, '') + '\n' + SHAPE },
      ],
    };
    let text = null, lastErr;
    for (let attempt = 0; attempt < 2 && text === null; attempt++) {
      try {
        const res = await deps.fetchImpl(`${cfg.llmBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cfg.llmKey ? { authorization: `Bearer ${cfg.llmKey}` } : {}),
            'x-title': 'Purr & Bark',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
        if (res.status === 429 || res.status >= 500) {
          const e = new Error(`LLM API ${res.status} (rate limit or provider busy)`);
          e.retry = true;
          throw e;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const e = new Error(`LLM API ${res.status}: ${data?.error?.message || 'request failed'}`);
          e.fatal = true;
          throw e;
        }
        text = data?.choices?.[0]?.message?.content ?? '';
        if (!text) throw Object.assign(new Error('empty reply'), { retry: true });
      } catch (e) {
        lastErr = e;
        if (e.fatal) throw e;
        if (attempt === 0) await sleep(Math.max(cfg.llmDelayMs, 6000));
      }
    }
    if (text === null) {
      if (n === 0 && !out.length) throw lastErr; // nothing worked at all: treat as a writer outage, retry later
      break; // keep what we have; the rest retry next cycle
    }
    const json = extractJson(text);
    const story = Array.isArray(json?.stories) ? json.stories[0] : json && json.headline ? json : null;
    if (story) out.push({ ...story, itemId: item.id });
  }
  return out;
}

/** Ask Claude for one segment per item. The reply is forced through a tool so it is always structured. */
export async function generateStories(items, cfg, deps) {
  if (cfg.mockLlm) return mockStories(items);
  if (cfg.llmProvider === 'openai') {
    if (!writerReady(cfg)) throw new Error('LLM_API_KEY is not set (get a free key from OpenRouter or Google AI Studio, or set MOCK_LLM=1 to test)');
    return generateOpenAI(items, cfg, deps);
  }
  if (!cfg.anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY is not set (or set MOCK_LLM=1 to test with template stories)');
  }
  const body = {
    model: cfg.model,
    max_tokens: 6000,
    system: SYSTEM,
    tools: [STORY_TOOL],
    tool_choice: { type: 'tool', name: STORY_TOOL.name },
    messages: [{ role: 'user', content: buildUserMessage(items, deps.now()) }],
  };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await deps.fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`Anthropic API ${res.status}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(`Anthropic API ${res.status}: ${data?.error?.message || 'request failed'}`);
        err.fatal = true;
        throw err;
      }
      const block = (data?.content || []).find((b) => b.type === 'tool_use' && b.name === STORY_TOOL.name);
      if (!block || !Array.isArray(block.input?.stories)) throw new Error('the model did not return stories');
      return block.input.stories;
    } catch (e) {
      lastErr = e;
      if (e.fatal) throw e;
      if (attempt === 0) await sleep(2000);
    }
  }
  throw lastErr;
}
