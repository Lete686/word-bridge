import { describe, expect, it } from 'vitest';
import { Dictionary } from '../src/core/dictionary';
import type { DictionaryData } from '../src/core/types';

const data: DictionaryData = {
  meta: { name: 'test', source: 'test', license: 'MIT' },
  entries: {
    run: ['[rʌn]', 'v. 跑', null, null],
    running: ["['rʌniŋ]", 'n. 赛跑', 'run', '现在分词'],
    study: ['', 'n. 学习', null, null],
    studies: ['', 'n. 研究', 'study', '第三人称单数'],
    we: ['', 'pron. 我们', null, null],
    us: ['[ʌs]', 'pron. 我们', 'we', ''],
    apple: ['', 'n. 苹果', null, null],
    "don't": ['', '(= do not)不要', null, null],
    'E-MAIL': ['', 'n. 电子邮件', null, null],
    'U.S.': ['', '美国', null, null],
  },
};

describe('dictionary lookup', () => {
  const dict = new Dictionary(data);
  it('returns exact entries with lemma information', () => {
    const result = dict.lookup('running');
    expect(result?.entry.lemma).toBe('run');
    expect(result?.entry.relation).toBe('现在分词');
    expect(result?.variantNote).toBeNull();
  });

  it('falls back from sentence-case to lowercase with a note', () => {
    const result = dict.lookup('Apple');
    expect(result?.matchedKey).toBe('apple');
    expect(result?.variantNote).toContain('小写词条');
  });

  it('does not fall back from all-caps acronyms to lowercase words', () => {
    expect(dict.lookup('US')).toBeNull();
  });

  it('finds lowercase hyphenated/period variants case-insensitively', () => {
    const mail = dict.lookup('e-mail');
    expect(mail?.matchedKey).toBe('E-MAIL');
    expect(mail?.variantNote).toContain('E-MAIL');
  });

  it('returns null for unknown words', () => {
    expect(dict.lookup('zzzznotaword')).toBeNull();
  });

  it('keeps selected spelling while exposing matched key', () => {
    const result = dict.lookup('Don’t');
    expect(result?.matchedKey).toBe("don't");
    expect(result?.word).toBe('Don’t');
    expect(result?.variantNote).toContain('小写词条');
    const lower = dict.lookup('Apple');
    expect(lower?.word).toBe('Apple');
    expect(lower?.matchedKey).toBe('apple');
  });
});
