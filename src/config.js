import path from 'node:path';

export const DEFAULT_FEEDS = [
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml' },
  { name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
  { name: 'Bitcoin.com News', url: 'https://news.bitcoin.com/feed/' },
];

export const DEFAULT_TOPICS = [
  'solana', 'meme', 'memecoin', 'pump.fun', 'bonk', 'wif', 'pepe', 'dogecoin', 'robinhood',
  'sec', 'regulation', 'clarity act', 'etf', 'musk', 'ansem', 'cupsey', 'bitcoin', 'ethereum',
];

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

function parseFeeds(v) {
  if (!v) return null;
  const feeds = v
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('|');
      return i > 0 ? { name: p.slice(0, i).trim(), url: p.slice(i + 1).trim() } : null;
    })
    .filter((f) => f && /^https?:\/\//i.test(f.url));
  return feeds.length ? feeds : null;
}

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    dataDir: env.DATA_DIR || path.resolve('data'),
    refreshMinutes: int(env.REFRESH_MINUTES, 10),
    maxNewPerCycle: int(env.MAX_NEW_PER_CYCLE, 3),
    maxStories: int(env.MAX_STORIES, 12),
    storyTtlHours: int(env.STORY_TTL_HOURS, 24),
    maxItemAgeHours: int(env.MAX_ITEM_AGE_HOURS, 36),
    adminToken: env.ADMIN_TOKEN || '',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    mockLlm: env.MOCK_LLM === '1',
    // Any OpenAI-compatible chat endpoint (OpenRouter, Gemini, Groq, Ollama...). Used when LLM_API_KEY or LLM_BASE_URL is set.
    llmProvider: env.LLM_PROVIDER || (env.LLM_API_KEY || env.LLM_BASE_URL ? 'openai' : 'anthropic'),
    llmKey: env.LLM_API_KEY || '',
    llmBase: (env.LLM_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    llmModel: env.LLM_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    llmDelayMs: int(env.LLM_DELAY_MS, 4000),
    openaiKey: env.OPENAI_API_KEY || '',
    ttsModel: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voiceLotti: env.TTS_VOICE_LOTTI || 'coral',
    voiceBram: env.TTS_VOICE_BRAM || 'onyx',
    feeds: parseFeeds(env.FEEDS) || DEFAULT_FEEDS,
    topics: (env.TOPICS ? env.TOPICS.split(',') : DEFAULT_TOPICS)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    dex: {
      enabled: env.DEXSCREENER !== '0',
      minLiquidityUsd: int(env.MIN_LIQUIDITY_USD, 50000),
      minVolume1hUsd: int(env.MIN_VOLUME_1H_USD, 10000),
      top: int(env.MOVERS_COUNT, 3),
    },
    userAgent: env.USER_AGENT || 'GillAndHornBot/1.0 (news desk)',
  };
}
