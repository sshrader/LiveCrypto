import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { runCycle } from './cycle.js';
import { writerReady, writerLabel } from './llm.js';
import { attachAudio, ttsEnabled } from './tts.js';
import { SIGNOFF, WARMUP } from './static-segments.js';
import { sha1 } from './util.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const sameToken = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export function createApp(cfg, deps = {}) {
  const d = {
    fetchImpl: deps.fetchImpl || fetch,
    userAgent: cfg.userAgent,
    now: deps.now || (() => Date.now()),
    log: deps.log || ((...a) => console.log(new Date().toISOString(), ...a)),
  };
  const store = deps.store || new Store(cfg.dataDir);
  const statics = { signoff: structuredClone(SIGNOFF), warmup: structuredClone(WARMUP) };
  let running = false;
  let timer = null;
  let firstTimer = null;
  let nextRunAt = null;
  let lastSummary = null;
  const hits = new Map();

  function payload() {
    const st = store.state;
    const live = st.stories.slice(0, cfg.maxStories);
    const stories = [...(live.length ? live : [statics.warmup]), statics.signoff];
    const version = sha1(stories.map((s) => s.id + (s.createdAt || '') + (s.lines[0]?.[2] || '')).join('|'));
    return {
      version,
      updatedAt: st.lastSuccess || st.startedAt,
      refreshMinutes: cfg.refreshMinutes,
      stories,
    };
  }

  async function refresh() {
    if (running) return { skipped: true };
    running = true;
    try {
      lastSummary = await runCycle(cfg, d, store);
      d.log(
        'cycle done:',
        `picked ${lastSummary.picked}, built ${lastSummary.built}, rejected ${lastSummary.rejected.length}`,
        lastSummary.errors.length ? 'errors: ' + lastSummary.errors.join('; ') : '',
      );
      return lastSummary;
    } catch (e) {
      d.log('cycle crashed:', e.message);
      store.state.lastError = `${new Date().toISOString()} ${e.message}`;
      return { error: e.message };
    } finally {
      running = false;
      nextRunAt = Date.now() + cfg.refreshMinutes * 60_000;
    }
  }

  function allow(req) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now > h.reset) {
      h = { n: 0, reset: now + 60_000 };
      hits.set(ip, h);
      if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    return ++h.n <= 120;
  }

  function send(res, code, body, headers = {}) {
    res.writeHead(code, { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
    res.end(body);
  }
  const json = (res, code, obj, headers = {}) =>
    send(res, code, JSON.stringify(obj), { 'content-type': MIME['.json'], 'cache-control': 'no-store', ...headers });

  async function serveFile(res, file, headers = {}) {
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    send(res, 200, data, { 'content-type': MIME[ext] || 'application/octet-stream', ...headers });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const method = req.method || 'GET';

    if (p === '/api/health') return json(res, 200, { ok: true });

    if (p.startsWith('/api/') && !allow(req)) return json(res, 429, { error: 'Too many requests' });

    if (p === '/api/stories') {
      if (method !== 'GET' && method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      const body = payload();
      const etag = `"${body.version}"`;
      if (req.headers['if-none-match'] === etag) return send(res, 304, '', { etag });
      return json(res, 200, body, { etag, 'cache-control': 'public, max-age=15' });
    }

    if (p === '/api/status') {
      const st = store.state;
      return json(res, 200, {
        ok: true,
        storyCount: st.stories.length,
        lastRun: st.lastRun,
        lastSuccess: st.lastSuccess,
        lastError: st.lastError,
        nextRun: nextRunAt ? new Date(nextRunAt).toISOString() : null,
        running,
        feeds: st.feedStatus,
        lastCycle: lastSummary && { picked: lastSummary.picked, built: lastSummary.built, rejected: lastSummary.rejected.length },
        writer: writerLabel(cfg),
        voices: ttsEnabled(cfg) ? 'openai' : 'browser',
      });
    }

    if (p === '/api/refresh') {
      if (!cfg.adminToken) return json(res, 404, { error: 'Not found' });
      if (method !== 'POST') return json(res, 405, { error: 'Use POST' });
      if (!sameToken(req.headers['x-admin-token'] || '', cfg.adminToken)) return json(res, 401, { error: 'Unauthorized' });
      const wasRunning = running;
      refresh();
      return json(res, 202, { started: !wasRunning });
    }

    if (p.startsWith('/audio/')) {
      const name = p.slice('/audio/'.length);
      if (!/^[a-f0-9]{40}\.mp3$/.test(name)) return json(res, 404, { error: 'Not found' });
      try {
        return await serveFile(res, path.join(cfg.dataDir, 'audio', name), {
          'cache-control': 'public, max-age=31536000, immutable',
        });
      } catch {
        return json(res, 404, { error: 'Not found' });
      }
    }

    if (method !== 'GET' && method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, rel);
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return json(res, 404, { error: 'Not found' });
    try {
      const html = path.extname(file) === '.html';
      return await serveFile(res, file, html
        ? { 'cache-control': 'no-cache', 'content-security-policy': CSP }
        : { 'cache-control': 'public, max-age=3600' });
    } catch {
      return json(res, 404, { error: 'Not found' });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      d.log('request error:', e.message);
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
      else res.end();
    });
  });

  async function start(port = cfg.port) {
    await store.load();
    // Give the fixed segments voices too, so every line in the show sounds the same.
    for (const s of Object.values(statics)) await attachAudio(s, cfg, d);
    if (!writerReady(cfg)) {
      d.log('WARNING: no story writer is configured (set LLM_API_KEY for a free model, or ANTHROPIC_API_KEY), so no stories will be written. Use MOCK_LLM=1 to test.');
    }
    if (!ttsEnabled(cfg)) d.log('Voices: OPENAI_API_KEY not set, the page will use browser voices.');
    await new Promise((resolve) => server.listen(port, resolve));
    firstTimer = setTimeout(() => refresh(), 3000);
    timer = setInterval(() => refresh(), cfg.refreshMinutes * 60_000);
    nextRunAt = Date.now() + 3000;
    firstTimer.unref?.();
    return server.address().port;
  }

  async function stop() {
    if (timer) clearInterval(timer);
    if (firstTimer) clearTimeout(firstTimer);
    timer = firstTimer = null;
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    try {
      await store.save();
    } catch {
      /* nothing to save */
    }
  }

  return { server, start, stop, refresh, payload, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const app = createApp(cfg);
  const port = await app.start();
  console.log(`Gill & Horn is on port ${port}`);
  const bye = async () => {
    setTimeout(() => process.exit(0), 5000).unref();
    await app.stop();
    process.exit(0);
  };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}
