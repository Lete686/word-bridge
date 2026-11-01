import { describe, expect, it } from 'vitest';
import {
  addWord,
  emptyData,
  findWord,
  normalizeData,
  pendingWords,
  removeWords,
  SECRET_LLM_KEY,
  setSyncStatus,
  statusLabel,
  targetKey,
} from '../src/core/store';

describe('plugin data', () => {
  it('drops forbidden fields and keeps only allowed data', () => {
    const raw = {
      schemaVersion: 1,
      words: [
        {
          w: 'running',
          addedAt: 123,
          sync: { '1:abc': { state: 'verified', at: 5 } },
          meaning: '赛跑',
          sentence: 'He is running.',
          sourcePath: 'notes/a.md',
          url: 'https://example.com',
        },
        { w: 'US', addedAt: 124, sync: {} },
      ],
      settings: {
        llm: { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'sk-secret', apiKeySecretId: 'word-bridge-llm-key', timeoutMs: 5000 },
        maimemo: { token: 'mm-secret', notepadId: 'abc', notepadTitle: 'T', notepadCreator: 1, chapterTitle: 'WB' },
        extra: 'drop',
      },
      history: ['nope'],
    };
    const { data, changed } = normalizeData(raw);
    expect(changed).toBe(true);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('赛跑');
    expect(serialized).not.toContain('He is running');
    expect(serialized).not.toContain('notes/a.md');
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('mm-secret');
    expect(serialized).not.toContain('history');
    expect(data.words).toHaveLength(2);
    expect(data.words[0].sync['1:abc'].state).toBe('verified');
  });

  it('keeps US and us as separate entries', () => {
    const { data } = normalizeData({ words: [{ w: 'US', addedAt: 1 }, { w: 'us', addedAt: 2 }] });
    expect(data.words.map((w) => w.w)).toEqual(['US', 'us']);
  });

  it('dedupes exact duplicates and rejects non-English words', () => {
    const { data } = normalizeData({
      words: [{ w: 'running' }, { w: 'running' }, { w: '你好' }, { w: 'hello world' }, { w: "don't" }],
    });
    expect(data.words.map((w) => w.w)).toEqual(['running', "don't"]);
  });

  it('adds, finds and removes words', () => {
    const data = emptyData();
    expect(addWord(data, 'running', 1)).toBe(true);
    expect(addWord(data, 'running', 2)).toBe(false);
    expect(addWord(data, 'run', 3)).toBe(true);
    expect(addWord(data, '你好', 4)).toBe(false);
    expect(findWord(data, 'running')?.w).toBe('running');
    expect(removeWords(data, ['running'])).toBe(1);
    expect(data.words.map((w) => w.w)).toEqual(['run']);
  });

  it('scopes sync status by target and computes pending words', () => {
    const data = emptyData();
    addWord(data, 'run', 1);
    addWord(data, 'walk', 2);
    data.settings.maimemo.notepadId = 'abc';
    data.settings.maimemo.notepadCreator = 7;
    const key = targetKey(data.settings);
    expect(key).toBe('7:abc');
    setSyncStatus(data, 'run', key, { state: 'verified', at: 3 });
    expect(data.words[0].sync[key].state).toBe('verified');
    expect(pendingWords(data, key).map((w) => w.w)).toEqual(['walk']);
    expect(pendingWords(data, '7:other')).toHaveLength(2);
    expect(statusLabel('normalized')).toBe('服务端词形不同');
  });

  it('uses fixed secret ids so data.json never stores secrets', () => {
    const data = emptyData();
    expect(data.settings.llm.apiKeySecretId).toBe(SECRET_LLM_KEY);
    expect(JSON.stringify(data)).not.toContain('sk-');
  });
});
