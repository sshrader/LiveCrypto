import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, generateStories, writerReady, writerLabel } from '../src/llm.js';
import { mockStories } from '../src/llm.js';
import { loadConfig } from '../src/config.js';
import { res, deps } from './helpers.js';

const item = (id) => ({ id, kind: 'news', title: 'Solana volume surges 40%', summary: 'Volume rose 40%.', outlet: 'Alpha', publishedAt: new Date().toISOString(), also: [] });

test('extractJson survives fences, chatter and braces inside strings', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1,"b":"x}y"}\n```\nDone'), { a: 1, b: 'x}y' });
  assert.deepEqual(extractJson('{bad} then {"ok":true}'), { ok: true });
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{"unterminated": '), null);
});

test('config picks the OpenAI-style writer when LLM_API_KEY is set', () => {
  const c = loadConfig({ LLM_API_KEY: 'k' });
  assert.equal(c.llmProvider, 'openai');
  assert.equal(writerReady(c), true);
  assert.match(writerLabel(c), /openrouter\.ai/);
  assert.equal(loadConfig({}).llmProvider, 'anthropic');
  assert.equal(writerReady(loadConfig({})), false);
  assert.equal(writerReady(loadConfig({ LLM_BASE_URL: 'http://localhost:11434/v1' })), true); // Ollama needs no key
});

test('free-model writer: one request per item, JSON pulled from chatty replies, ids forced', async () => {
  const cfg = { ...loadConfig({ LLM_API_KEY: 'k', LLM_DELAY_MS: '0' }) };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.authorization, body: JSON.parse(opts.body) });
    const s = mockStories([item('x')])[0];
    return res({ choices: [{ message: { content: 'Here you go:\n```json\n' + JSON.stringify({ stories: [{ ...s, itemId: 'WRONG' }] }) + '\n```' } }] });
  };
  const out = await generateStories([item('a'), item('b')], cfg, deps(fetchImpl));
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/chat/completions'));
  assert.equal(calls[0].auth, 'Bearer k');
  assert.ok(calls[0].body.messages[1].content.includes('id="a"'));
  assert.deepEqual(out.map((s) => s.itemId), ['a', 'b']);
});

test('free-model writer: a garbled reply skips that item, a 401 is fatal, a 429 outage throws', async () => {
  const cfg = loadConfig({ LLM_API_KEY: 'k', LLM_DELAY_MS: '0' });
  let n = 0;
  const garbled = async () => res({ choices: [{ message: { content: n++ === 0 ? 'I cannot do that' : JSON.stringify({ stories: mockStories([item('x')]) }) } }] });
  const out = await generateStories([item('a'), item('b')], cfg, deps(garbled));
  assert.deepEqual(out.map((s) => s.itemId), ['b']);
  await assert.rejects(() => generateStories([item('a')], cfg, deps(async () => res({ error: { message: 'bad key' } }, 401))), /401.*bad key/);
});

import { buildStories } from '../src/builder.js';
test('repair pass: a rejected story is re-asked with the reasons and can then air', async () => {
  const cfg = { ...loadConfig({ LLM_API_KEY: 'k', LLM_DELAY_MS: '0' }), dataDir: '/tmp/x', maxStories: 5 };
  const it = { ...item('a'), summary: 'Volume rose 40%.' };
  let call = 0;
  const bodies = [];
  const fetchImpl = async (url, opts) => {
    const b = JSON.parse(opts.body); bodies.push(b.messages[1].content);
    const s = mockStories([it])[0];
    if (call++ === 0) s.lines[1].text = 'Volume rose 4,400 percent, so you should buy now.';
    return res({ choices: [{ message: { content: JSON.stringify({ stories: [s] }) } }] });
  };
  const out = await buildStories([it], cfg, deps(fetchImpl));
  assert.equal(out.stories.length, 1);
  assert.equal(out.rejected.length, 0);
  assert.equal(call, 2);
  assert.match(bodies[1], /rejected by an automatic checker/);
});
