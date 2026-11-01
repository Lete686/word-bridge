import type { DictionaryData, DictEntry, LookupResult, RawDictEntry } from './types';
import { isAllCaps, lookupAlias } from './text';

function toEntry(raw: RawDictEntry): DictEntry {
  return {
    phonetic: raw[0] ?? '',
    definition: raw[1] ?? '',
    lemma: raw[2] ?? null,
    relation: raw[3] ?? null,
  };
}

export class Dictionary {
  readonly meta: DictionaryData['meta'];
  private readonly entries: Record<string, RawDictEntry>;
  private readonly count: number;
  private lowerIndex: Map<string, string[]> | null = null;

  constructor(data: DictionaryData) {
    this.meta = data.meta;
    this.entries = data.entries ?? {};
    this.count = Object.keys(this.entries).length;
  }

  get size(): number {
    return this.count;
  }

  /**
   * 精确优先。只有精确未命中时才做有说明的降级：
   * - 全大写短词（如 US）不降级到小写，避免把缩写与普通词合并；
   * - 首字母大写（如 Apple、Don't）可降级到小写词条，并在界面注明；
   * - 含连字符/句点的词可做唯一的大小写不敏感匹配（如 e-mail → E-MAIL）。
   */
  lookup(word: string): LookupResult | null {
    const alias = lookupAlias(word);
    const exact = this.entries[alias];
    if (exact) {
      return { word, matchedKey: alias, entry: toEntry(exact), variantNote: null };
    }
    if (isAllCaps(alias)) return null;
    const lower = alias.toLowerCase();
    if (lower !== alias && this.entries[lower]) {
      return {
        word,
        matchedKey: lower,
        entry: toEntry(this.entries[lower]),
        variantNote: `词典未单独收录“${alias}”，以下显示小写词条“${lower}”的释义。`,
      };
    }
    if (/[-.]/.test(alias)) {
      const matches = this.getLowerIndex().get(lower) ?? [];
      if (matches.length === 1 && matches[0] !== alias) {
        const key = matches[0];
        return {
          word,
          matchedKey: key,
          entry: toEntry(this.entries[key]),
          variantNote: `词典未单独收录“${alias}”，以下显示词条“${key}”的释义。`,
        };
      }
    }
    return null;
  }

  private getLowerIndex(): Map<string, string[]> {
    if (!this.lowerIndex) {
      const index = new Map<string, string[]>();
      for (const key of Object.keys(this.entries)) {
        const lower = key.toLowerCase();
        if (!/[-.]/.test(key)) continue;
        const bucket = index.get(lower);
        if (bucket) bucket.push(key);
        else index.set(lower, [key]);
      }
      this.lowerIndex = index;
    }
    return this.lowerIndex;
  }
}
