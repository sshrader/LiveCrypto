import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from './util.js';

export const ttsEnabled = (cfg) => Boolean(cfg.openaiKey);

const exists = (f) => fs.access(f).then(() => true, () => false);

async function synth(text, who, cfg, deps) {
  const voice = who === 'lotti' ? cfg.voiceLotti : cfg.voiceBram;
  const body = { model: cfg.ttsModel, voice, input: text, response_format: 'mp3' };
  if (cfg.ttsModel.startsWith('gpt-4o')) {
    body.instructions =
      who === 'lotti'
        ? 'Speak as a bright, quick, friendly news anchor with lively energy.'
        : 'Speak as a calm, deadpan news anchor with a low, steady delivery.';
  }
  const res = await deps.fetchImpl('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.openaiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`TTS request failed with ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Give every line an audio clip. All or nothing per story: if any line fails,
 * the story goes out without audio and the page falls back to the browser's voices.
 */
export async function attachAudio(story, cfg, deps) {
  if (!ttsEnabled(cfg)) return story;
  const dir = path.join(cfg.dataDir, 'audio');
  try {
    await fs.mkdir(dir, { recursive: true });
    const lines = [];
    for (const [who, text] of story.lines) {
      const voice = who === 'lotti' ? cfg.voiceLotti : cfg.voiceBram;
      const key = sha1(`${cfg.ttsModel}|${voice}|${who}|${text}`);
      const file = path.join(dir, key + '.mp3');
      if (!(await exists(file))) {
        const buf = await synth(text, who, cfg, deps);
        const tmp = file + '.tmp';
        await fs.writeFile(tmp, buf);
        await fs.rename(tmp, file);
      }
      lines.push([who, text, `/audio/${key}.mp3`]);
    }
    story.lines = lines;
  } catch (e) {
    deps.log?.('tts failed for', story.id, '-', e.message);
    story.lines = story.lines.map(([who, text]) => [who, text]);
  }
  return story;
}

/** Remove clips that no current story points at (and are not brand new). */
export async function pruneAudio(cfg, segments, now = Date.now()) {
  const dir = path.join(cfg.dataDir, 'audio');
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return 0;
  }
  const keep = new Set();
  for (const s of segments) for (const l of s.lines || []) if (l[2]) keep.add(path.basename(l[2]));
  let removed = 0;
  for (const f of files) {
    if (keep.has(f) || !/^[a-f0-9]{40}\.mp3(\.tmp)?$/.test(f)) continue;
    try {
      const st = await fs.stat(path.join(dir, f));
      if (now - st.mtimeMs > 2 * 3.6e6) {
        await fs.unlink(path.join(dir, f));
        removed++;
      }
    } catch {
      /* already gone */
    }
  }
  return removed;
}
