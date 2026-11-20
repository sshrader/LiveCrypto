import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { res, testConfig, rssXml, deps as mkDeps } from './helpers.js';

async function boot(over = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-srv-'));
  const cfg = testConfig({ dataDir: dir, ...over });
  const fetchImpl = async (url) => {
    if (url.includes('alpha.test')) return res(rssXml([{ title: 'Solana memecoin volume surges 40%', url: 'https://alpha.test/2', hoursAgo: 1, summary: 'Volume rose 40% on the platform.' }]));
    return res('', 500);
  };
  const app = createApp(cfg, { fetchImpl, log: () => {} });
  const port = await app.start(0);
  const base = `http://127.0.0.1:${port}`;
  return { app, base, dir, cfg };
}

test('health, stories (warmup first), ETag 304, status', async () => {
  const { app, base } = await boot();
  try {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const r = await fetch(base + '/api/stories');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(j.stories.map((s) => s.id), ['warmup', 'signoff']);
    assert.ok(j.version && j.refreshMinutes > 0);
    const r2 = await fetch(base + '/api/stories', { headers: { 'if-none-match': r.headers.get('etag') } });
    assert.equal(r2.status, 304);

    await app.refresh();
    const j2 = await (await fetch(base + '/api/stories')).json();
    assert.notEqual(j2.version, j.version);
    assert.ok(j2.stories.length >= 2);
    assert.equal(j2.stories.at(-1).id, 'signoff');
    assert.ok(!j2.stories.some((s) => s.id === 'warmup'));
    for (const s of j2.stories) for (const l of s.lines) assert.ok(Array.isArray(l));

    const st = await (await fetch(base + '/api/status')).json();
    assert.equal(st.writer, 'mock');
    assert.equal(st.voices, 'browser');
  } finally { await app.stop(); }
});

test('refresh endpoint is hidden without ADMIN_TOKEN and protected with it', async () => {
  let { app, base } = await boot();
  try { assert.equal((await fetch(base + '/api/refresh', { method: 'POST' })).status, 404); } finally { await app.stop(); }
  ({ app, base } = await boot({ adminToken: 'sekret' }));
  try {
    assert.equal((await fetch(base + '/api/refresh', { method: 'POST', headers: { 'x-admin-token': 'nope' } })).status, 401);
    assert.equal((await fetch(base + '/api/refresh', { method: 'GET', headers: { 'x-admin-token': 'sekret' } })).status, 405);
    assert.equal((await fetch(base + '/api/refresh', { method: 'POST', headers: { 'x-admin-token': 'sekret' } })).status, 202);
  } finally { await app.stop(); }
});

test('audio route serves only hash-named files and static route cannot escape public/', async () => {
  const { app, base, dir } = await boot();
  try {
    const name = 'a'.repeat(40) + '.mp3';
    await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
    await fs.writeFile(path.join(dir, 'audio', name), 'ID3');
    await fs.writeFile(path.join(dir, 'state.json.secret'), 'x');
    assert.equal((await fetch(`${base}/audio/${name}`)).status, 200);
    assert.equal((await fetch(`${base}/audio/${'b'.repeat(40)}.mp3`)).status, 404);
    assert.equal((await fetch(`${base}/audio/..%2fstate.json`)).status, 404);
    assert.equal((await fetch(`${base}/audio/../state.json`)).status, 404);
    assert.equal((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status >= 400, true);
    assert.equal((await fetch(base + '/', { method: 'DELETE' })).status, 405);
  } finally { await app.stop(); }
});
