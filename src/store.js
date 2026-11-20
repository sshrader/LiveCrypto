import fs from 'node:fs/promises';
import path from 'node:path';

const empty = () => ({
  stories: [],
  seen: {},
  failed: {},
  lastRun: null,
  lastSuccess: null,
  lastError: null,
  lastMoversKey: '',
  feedStatus: [],
  startedAt: new Date().toISOString(),
});

/** One JSON file on disk. On Railway, mount a Volume at DATA_DIR so it survives redeploys. */
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    this.state = empty();
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state = { ...empty(), ...raw, startedAt: new Date().toISOString() };
    } catch {
      /* first run or unreadable file: start clean */
    }
  }

  async save() {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.state));
    await fs.rename(tmp, this.file);
  }
}
