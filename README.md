# Gill & Horn: live crypto news desk

Two animated anchors (Lotti the axolotl, Bram the ox) read stories that a small Node server builds on a timer:

1. Every `REFRESH_MINUTES` the server reads RSS feeds (Decrypt, Cointelegraph, CoinDesk, CryptoSlate, Bitcoin.com) and DexScreener's Solana data.
2. It drops stale items and duplicates, groups the same story from several outlets, and ranks what is left.
3. Claude writes one short segment per new item (forced tool call, so the reply is structured).
4. Code checks each segment before it can air (see Safeguards). Failures are discarded.
5. Optionally, OpenAI TTS makes one audio clip per line; otherwise the page uses browser voices.
6. The page polls `/api/stories` every 30 s and airs unseen segments first.

No npm dependencies. Node 20+.

## Deploy on Railway

1. Push this folder to a GitHub repo.
2. Railway: **New Project → Deploy from GitHub repo**. It detects Node and uses `railway.json` (start `node src/server.js`, health check `/api/health`).
3. **Variables**: add `ANTHROPIC_API_KEY`. Optional: `OPENAI_API_KEY` (AI voices), `ADMIN_TOKEN` (enables `POST /api/refresh`). Do not set `PORT`; Railway sets it.
4. **Volume**: add one, mount path `/data`, and set `DATA_DIR=/data`. This keeps stories, the seen-list and audio across deploys. Without it everything rebuilds after each deploy.
5. **Settings → Networking → Generate Domain**, open it, press *Go live*.
6. Check `https://<your-domain>/api/status`. It shows each feed's health, the last cycle (picked/built/rejected), and the last error. The first cycle runs about 3 s after boot.

Run `npm run check-sources` (locally or in Railway's shell) to test every feed, DexScreener, and which writer/voice is configured.

## Settings (env vars)

See `.env.example`. The main ones:

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required for real stories |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | `claude-haiku-5-5` is cheaper |
| `REFRESH_MINUTES` | 10 | Cycle interval |
| `MAX_NEW_PER_CYCLE` | 3 | New segments per cycle (doubled while fewer than 6 exist) |
| `MAX_STORIES` / `STORY_TTL_HOURS` | 12 / 24 | Rolling window |
| `MAX_ITEM_AGE_HOURS` | 36 | Ignore older articles |
| `FEEDS` | built-in list | `Name|url;Name|url` |
| `DEXSCREENER` | on | Set `0` to disable the movers segment |
| `MIN_LIQUIDITY_USD`, `MIN_VOLUME_1H_USD` | 50000 / 10000 | Filters out thin pools |
| `OPENAI_API_KEY`, `TTS_VOICE_LOTTI`, `TTS_VOICE_BRAM` | none, coral, onyx | AI voices |
| `MOCK_LLM` | off | `1` writes template stories with no API call (for testing) |
| `ADMIN_TOKEN` | none | Enables `POST /api/refresh` with header `x-admin-token` |

## Safeguards

- Feed text and token names are treated as untrusted: cleaned, length-limited, wrapped as data in the prompt.
- Every number over 31 (other than years) in a segment must appear in the source text (K/M/B normalised, 2% tolerance), or the segment is rejected.
- Rejects advice/hype wording ("buy now", "moon"), URLs, @handles, control characters, bad lengths.
- Code, not the model, supplies links, dates, outlet names, and the market stat and facts.
- DexScreener "boosts" are paid promotion; the segment says so, and only pools above the liquidity and volume floors are used.
- Hash-named audio route, path-traversal-safe static serving, rate limit (120/min/IP), CSP on the page.

## Limits you should know

- **Not tested here against live feeds, the real Claude API, or OpenAI TTS.** The sandbox could only reach a local fake feed. 33 automated tests plus a browser run with a fake feed and `MOCK_LLM=1` pass. Feed URLs are from public docs and may need adjusting: use `npm run check-sources` and `/api/status` after the first deploy.
- RSS gives headlines and short summaries, so segments rest on that, not full articles.
- No X/Telegram KOL feeds (Ansem, Cupsey, etc.). RSS can't provide them. Adding them needs an X API plan or another source, as a new module next to `src/rss.js`.
- The number check is best-effort. Spelled-out numbers aren't checked, and it can't catch a claim that is wrong but uses source numbers. Keep the "not financial advice" framing.
- One instance only (state is a JSON file on the volume).

## Cost (rough)

At defaults a cycle sends ~3 items to Claude (a few thousand tokens), so roughly 400 to 600 calls a day on Sonnet; Haiku is several times cheaper. TTS adds one clip per line (~5 per segment). Lower `REFRESH_MINUTES` cost scales linearly.

## Develop

```
npm run dev     # MOCK_LLM=1, no keys needed
npm test
```
