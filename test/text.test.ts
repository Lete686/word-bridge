import { describe, expect, it } from 'vitest';
import { classifySelection, dedupeKey, normalizeText, stripWrappers } from '../src/core/text';

describe('text classification', () => {
  it('treats simple, hyphenated and apostrophe words as words', () => {
    for (const word of ['running', "don't", 'well-known', "rock'n'roll", "O'Brien", 'e-mail', 'A']) {
      expect(classifySelection(word).kind).toBe('word');
    }
  });

  it('accepts abbreviations with periods', () => {
    expect(classifySelection('U.S.').kind).toBe('word');
    expect(classifySelection('e.g.').kind).toBe('word');
  });

  it('treats sentences, phrases and Chinese as text', () => {
    for (const text of ['hello world', 'This is a sentence.', '你好', 'running quickly', 'a, b']) {
      expect(classifySelection(text).kind).toBe('text');
    }
  });

  it('strips wrapping quotes and brackets', () => {
    expect(stripWrappers('“running”')).toBe('running');
    expect(stripWrappers("'running'")).toBe('running');
    expect(stripWrappers('(running)')).toBe('running');
    expect(classifySelection('“running”').kind).toBe('word');
  });

  it('normalizes unicode and whitespace', () => {
    expect(normalizeText('  running  ')).toBe('running');
    expect(normalizeText('hello\nworld')).toBe('hello world');
    expect(dedupeKey('  running ')).toBe('running');
  });

  it('does not merge case variants in dedupe keys', () => {
    expect(dedupeKey('US')).not.toBe(dedupeKey('us'));
  });

  it('leaves empty selection as text', () => {
    expect(classifySelection('   ').text).toBe('');
  });
});
