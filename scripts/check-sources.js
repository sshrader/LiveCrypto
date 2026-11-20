// Run this on your own machine or in a Railway shell to see which feeds work:  npm run check-sources
import { loadConfig } from '../src/config.js';
import { fetchFeeds } from '../src/ingest.js';
import { fetchMarketItem } from '../src/dexscreener.js';

const cfg = loadConfig();
const deps = { fetchImpl: fetch, userAgent: cfg.userAgent, now: () => Date.now() };

console.log('News feeds');
const { items, status } = await fetchFeeds(cfg, deps);
for (const s of status) {
  console.log(' ', s.ok ? 'OK  ' : 'FAIL', s.name.padEnd(18), s.ok ? `${s.items} items` : s.error);
}
const newest = items.map((i) => i.publishedAt).sort().pop();
console.log(`  ${items.length} items in total, newest published ${newest || 'n/a'}`);

console.log('\nDexScreener (boosted Solana tokens)');
try {
  const m = await fetchMarketItem(cfg, deps);
  if (!m) console.log('  reachable, but no tokens passed the filters right now');
  else console.log('  OK  ', m.summary.slice(0, 400));
} catch (e) {
  console.log('  FAIL', e.message);
}

console.log('\nWriter:', cfg.mockLlm ? 'MOCK_LLM (template stories)' : cfg.anthropicKey ? `Claude (${cfg.model})` : 'NOT CONFIGURED - set ANTHROPIC_API_KEY');
console.log('Voices:', cfg.openaiKey ? `OpenAI ${cfg.ttsModel}` : 'browser voices (set OPENAI_API_KEY for AI voices)');
