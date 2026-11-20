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

/** Ask Claude for one segment per item. The reply is forced through a tool so it is always structured. */
export async function generateStories(items, cfg, deps) {
  if (cfg.mockLlm) return mockStories(items);
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
