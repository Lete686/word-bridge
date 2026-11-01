import { describe, expect, it } from 'vitest';
import { syncWordsToNotepad } from '../src/core/sync';
import { MaimemoClient, MaimemoError } from '../src/core/maimemo';
import type { Notepad } from '../src/core/types';

function parseList(content: string, transform: (word: string) => string | null = (word) => word): Notepad['list'] {
  const list: NonNullable<Notepad['list']> = [];
  let chapter = '';
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      chapter = trimmed.replace(/^#+/, '').trim();
      list.push({ type: 'CHAPTER', data: { chapter } });
      continue;
    }
    if (trimmed.startsWith('//')) continue;
    const mapped = transform(trimmed);
    if (mapped !== null) list.push({ type: 'WORD', data: { chapter, word: mapped } });
  }
  return list;
}

function makeNotepad(content: string): Notepad {
  return {
    id: 'abc',
    type: 'NOTEPAD',
    creator: 7,
    status: 'PUBLISHED',
    content,
    title: 'T',
    brief: 'B',
    tags: [],
    list: parseList(content),
    created_time: '2026-01-01T00:00:00.000Z',
    updated_time: 't1',
  };
}

type WritePlan = 'ok' | '503' | 'timeout' | 'apply-then-503' | 'apply-normalized-503';

class FakeClient {
  notepad: Notepad;
  updates: string[] = [];
  writeAttempts = 0;
  getCalls = 0;
  writePlan: WritePlan[] = [];
  transform: (word: string) => string | null = (word) => word;
  hideList = false;
  failReadAfter: number | null = null;
  concurrentContent: string | null = null;
  concurrentMetadata: Partial<Notepad> | null = null;
  appendOnFail: string | null = null;
  lastPayloadMetadata: { title: string; brief: string; tags: string[] } | null = null;
  private clock = 1;

  constructor(content: string) {
    this.notepad = makeNotepad(content);
  }

  async getNotepad(): Promise<Notepad> {
    this.getCalls += 1;
    if (this.failReadAfter !== null && this.getCalls > this.failReadAfter) {
      throw new MaimemoError('network', 'read failed');
    }
    if (this.getCalls === 2 && this.concurrentContent !== null) {
      this.notepad.content = this.concurrentContent;
      this.notepad.list = parseList(this.concurrentContent, this.transform);
      this.notepad.updated_time = `t${(this.clock += 1)}`;
      this.concurrentContent = null;
    }
    if (this.getCalls === 2 && this.concurrentMetadata) {
      this.notepad = { ...this.notepad, ...this.concurrentMetadata };
      this.concurrentMetadata = null;
    }
    const clone = structuredClone(this.notepad);
    if (this.hideList) delete clone.list;
    return clone;
  }

  async updateNotepad(base: Notepad, content: string): Promise<Notepad> {
    this.writeAttempts += 1;
    this.lastPayloadMetadata = { title: base.title, brief: base.brief, tags: [...(base.tags ?? [])] };
    const plan = this.writePlan.shift() ?? 'ok';
    if (plan === '503') {
      if (this.appendOnFail) {
        this.notepad.content += `${this.appendOnFail}\n`;
        this.notepad.list = parseList(this.notepad.content, this.transform);
        this.notepad.updated_time = `t${(this.clock += 1)}`;
        this.appendOnFail = null;
      }
      throw new MaimemoError('server', '503', 503, true);
    }
    if (plan === 'timeout') throw new MaimemoError('timeout', 'timeout', undefined, true);
    if (plan === 'apply-normalized-503') {
      this.notepad.updated_time = `t${(this.clock += 1)}`;
      throw new MaimemoError('server', '503', 503, true);
    }
    this.apply(content);
    if (plan === 'apply-then-503') {
      this.notepad.content += 'cat\n';
      this.notepad.list = parseList(this.notepad.content, this.transform);
      this.notepad.updated_time = `t${(this.clock += 1)}`;
      throw new MaimemoError('server', '503', 503, true);
    }
    return structuredClone(this.notepad);
  }

  private apply(content: string): void {
    this.updates.push(content);
    this.notepad = {
      ...this.notepad,
      content,
      list: parseList(content, this.transform),
      updated_time: `t${(this.clock += 1)}`,
    };
  }
}

const clientOf = (fake: FakeClient) => fake as unknown as MaimemoClient;
const noSleep = async () => undefined;

async function sync(fake: FakeClient, words: string[], lemmaOf: (word: string) => string | null = () => null) {
  return syncWordsToNotepad({
    client: clientOf(fake),
    notepadId: 'abc',
    words,
    chapterTitle: 'Word Bridge',
    lemmaOf,
    sleep: noSleep,
  });
}

describe('sync orchestration (baseline behavior)', () => {
  it('appends missing words, preserves remote content and verifies by readback', async () => {
    const fake = new FakeClient('# C\ndog\n');
    const outcome = await sync(fake, ['run', 'dog']);
    expect(outcome.writeState).toBe('written');
    expect(outcome.appended).toEqual(['run']);
    expect(outcome.skipped).toEqual(['dog']);
    expect(outcome.verifiedCount).toBe(2);
    expect(outcome.failedCount).toBe(0);
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]).toBe('# C\ndog\n# Word Bridge\nrun\n');
  });

  it('reports normalized when the service stores the lemma instead of the selected form', async () => {
    const fake = new FakeClient('');
    fake.transform = (word) => (word === 'running' ? 'run' : word);
    const outcome = await sync(fake, ['running'], (word) => (word === 'running' ? 'run' : null));
    expect(outcome.normalizedCount).toBe(1);
    expect(outcome.results[0].state).toBe('normalized');
    expect(outcome.results[0].detail).toContain('run');
  });

  it('marks unparsed words as failed without claiming success', async () => {
    const fake = new FakeClient('');
    fake.transform = (word) => (word === 'zzznotaword' ? null : word);
    const outcome = await sync(fake, ['run', 'zzznotaword']);
    expect(outcome.verifiedCount).toBe(1);
    expect(outcome.failedCount).toBe(1);
    expect(outcome.results.find((r) => r.word === 'zzznotaword')?.state).toBe('failed');
  });

  it('treats repeated write timeouts as unknown after bounded re-read and re-merge', async () => {
    const fake = new FakeClient('# C\ndog\n');
    fake.writePlan = ['timeout', 'timeout'];
    const outcome = await sync(fake, ['run']);
    expect(outcome.writeState).toBe('unknown');
    expect(outcome.unknownCount).toBe(1);
    expect(outcome.results[0].state).toBe('unknown');
    expect(fake.updates).toHaveLength(0);
    expect(fake.writeAttempts).toBe(2);
  });

  it('re-reads before writing and merges into concurrent content changes', async () => {
    const fake = new FakeClient('# C\ndog\n');
    fake.concurrentContent = '# C\ndog\n# 其他\ncat\n';
    const outcome = await sync(fake, ['run']);
    expect(fake.updates[0]).toContain('# 其他\ncat\n');
    expect(fake.updates[0]).toContain('run');
    expect(outcome.verifiedCount).toBe(1);
  });

  it('does not write when all words already exist remotely', async () => {
    const fake = new FakeClient('# C\nrun\n');
    const outcome = await sync(fake, ['run']);
    expect(outcome.writeState).toBe('no-change');
    expect(outcome.verifiedCount).toBe(1);
    expect(fake.updates).toHaveLength(0);
  });
});

describe('F1: write failures must not replay stale payloads', () => {
  it('keeps another client\'s cat when the first 503 write already applied', async () => {
    const fake = new FakeClient('# C\napple\n');
    fake.writePlan = ['apply-then-503'];
    const outcome = await sync(fake, ['run']);
    expect(fake.writeAttempts).toBe(1);
    expect(fake.notepad.content).toContain('cat');
    expect(fake.notepad.content).toContain('run');
    expect(outcome.writeState).toBe('recovered');
    expect(outcome.verifiedCount).toBe(1);
  });

  it('re-merges on the latest content before retrying a 503 that did not apply', async () => {
    const fake = new FakeClient('# C\napple\n');
    fake.writePlan = ['503', 'ok'];
    fake.appendOnFail = 'cat';
    const outcome = await sync(fake, ['run']);
    expect(fake.writeAttempts).toBe(2);
    expect(fake.notepad.content).toContain('cat');
    expect(fake.notepad.content).toContain('run');
    expect(outcome.writeState).toBe('written');
    expect(outcome.verifiedCount).toBe(1);
  });

  it('keeps unknown and stops after two failed 503 attempts', async () => {
    const fake = new FakeClient('# C\napple\n');
    fake.writePlan = ['503', '503'];
    const outcome = await sync(fake, ['run']);
    expect(fake.writeAttempts).toBe(2);
    expect(outcome.writeState).toBe('unknown');
    expect(outcome.unknownCount).toBe(1);
    expect(outcome.verifiedCount).toBe(0);
  });

  it('does not replay when readback after an uncertain write fails', async () => {
    const fake = new FakeClient('# C\napple\n');
    fake.writePlan = ['503'];
    fake.failReadAfter = 2;
    const outcome = await sync(fake, ['run']);
    expect(fake.writeAttempts).toBe(1);
    expect(outcome.writeState).toBe('unknown');
    expect(outcome.unknownCount).toBe(1);
  });

  it('uses the latest metadata when only metadata changed between reads', async () => {
    const fake = new FakeClient('# C\napple\n');
    fake.concurrentMetadata = { title: 'changed remotely', brief: 'remote brief', tags: ['new'] };
    await sync(fake, ['run']);
    expect(fake.lastPayloadMetadata).toEqual({ title: 'changed remotely', brief: 'remote brief', tags: ['new'] });
  });
});

describe('R1: pre-existing aliases are not evidence that an uncertain write applied', () => {
  it('retries a failed uppercase write when only lowercase us pre-exists', async () => {
    const fake = new FakeClient('# C\nus\n');
    fake.writePlan = ['503', 'ok'];
    const outcome = await sync(fake, ['US']);
    expect(fake.writeAttempts).toBe(2);
    expect(fake.notepad.content).toContain('US');
    expect(outcome.writeState).toBe('written');
    expect(outcome.results[0].state).toBe('verified');
  });

  it('retries a failed original-form write when only lemma run pre-exists', async () => {
    const fake = new FakeClient('# C\nrun\n');
    fake.writePlan = ['503', 'ok'];
    const outcome = await sync(fake, ['running'], (word) => (word === 'running' ? 'run' : null));
    expect(fake.writeAttempts).toBe(2);
    expect(fake.notepad.content).toContain('running');
    expect(outcome.writeState).toBe('written');
    expect(outcome.results[0].state).toBe('verified');
  });

  it('keeps unknown when the write may have normalized to a pre-existing alias', async () => {
    const fake = new FakeClient('# C\nus\n');
    fake.writePlan = ['apply-normalized-503'];
    const outcome = await sync(fake, ['US']);
    expect(fake.writeAttempts).toBe(1);
    expect(outcome.writeState).toBe('unknown');
    expect(outcome.unknownCount).toBe(1);
    expect(outcome.results[0].state).toBe('unknown');
  });
});

describe('R2: repeated sync must not append duplicate raw lines', () => {
  it('does not append running again in lemma mode when content already has it', async () => {
    const fake = new FakeClient('//\nrun\n');
    fake.transform = (word) => (word === 'running' ? 'run' : word);
    const lemmaOf = (word: string) => (word === 'running' ? 'run' : null);
    const first = await sync(fake, ['running'], lemmaOf);
    const second = await sync(fake, ['running'], lemmaOf);
    const third = await sync(fake, ['running'], lemmaOf);
    expect(fake.writeAttempts).toBe(1);
    expect(fake.updates).toHaveLength(1);
    expect(fake.notepad.content.split('\n').filter((line) => line === 'running')).toHaveLength(1);
    expect(first.results[0].state).toBe('normalized');
    expect(second.results[0].state).toBe('normalized');
    expect(third.results[0].state).toBe('normalized');
  });

  it('does not append when content has running but list is empty', async () => {
    const fake = new FakeClient('//\nrun\nrunning\n');
    fake.notepad.list = [];
    const outcome = await sync(fake, ['running'], (word) => (word === 'running' ? 'run' : null));
    expect(fake.writeAttempts).toBe(0);
    expect(fake.notepad.content.split('\n').filter((line) => line === 'running')).toHaveLength(1);
    expect(outcome.failedCount).toBe(1);
  });

  it('does not append when content has running but list is missing', async () => {
    const fake = new FakeClient('//\nrun\nrunning\n');
    fake.hideList = true;
    const outcome = await sync(fake, ['running'], (word) => (word === 'running' ? 'run' : null));
    expect(fake.writeAttempts).toBe(0);
    expect(fake.notepad.content.split('\n').filter((line) => line === 'running')).toHaveLength(1);
    expect(outcome.unknownCount).toBe(1);
  });
});

describe('F2: word identity is exact and mode-aware', () => {
  it('does not treat us as already containing US', async () => {
    const fake = new FakeClient('# C\nus\n');
    const outcome = await sync(fake, ['US']);
    expect(outcome.appended).toEqual(['US']);
    expect(fake.notepad.content).toContain('US');
  });

  it('does not append an already present dotted abbreviation again', async () => {
    const fake = new FakeClient('# C\nU.S.\n');
    const outcome = await sync(fake, ['U.S.']);
    expect(outcome.appended).toEqual([]);
    expect(outcome.skipped).toEqual(['U.S.']);
    expect(fake.writeAttempts).toBe(0);
  });

  it('does not treat a phrase token as a standalone entry', async () => {
    const fake = new FakeClient('# C\nwatching TV\n');
    const outcome = await sync(fake, ['watching']);
    expect(outcome.appended).toEqual(['watching']);
    expect(fake.notepad.content).toContain('watching');
  });
});

describe('F3: verification requires server parse list', () => {
  it('marks words unknown when the response has no list, even if content echoes them', async () => {
    const fake = new FakeClient('');
    fake.hideList = true;
    const outcome = await sync(fake, ['zzznotaword']);
    expect(outcome.writeState).toBe('written');
    expect(outcome.verifiedCount).toBe(0);
    expect(outcome.unknownCount).toBe(1);
    expect(outcome.results[0].state).toBe('unknown');
    expect(outcome.results[0].detail).toContain('list');
  });
});
