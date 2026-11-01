import type { SelectionClass } from './types';

const WORD_RE = /^[A-Za-z][A-Za-z'’\-]*$/;
const ABBR_RE = /^(?:[A-Za-z]\.){2,}[A-Za-z]?$/;
const WRAP_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['(', ')'],
  ['[', ']'],
  ['<', '>'],
  ['《', '》'],
  ['「', '」'],
  ['『', '』'],
];

/** Unicode NFC + 统一空白 + 去首尾空白 */
export function normalizeText(raw: string): string {
  return raw.normalize('NFC').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** 去掉成对包裹的引号/括号，便于选中 “running” 时仍按单词处理 */
export function stripWrappers(text: string): string {
  let out = text;
  for (let guard = 0; guard < 4; guard += 1) {
    const first = out[0];
    const last = out[out.length - 1];
    const pair = WRAP_PAIRS.find(([open, close]) => open === first && close === last);
    if (!pair || out.length < 2) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}

/**
 * 判断选区是单词还是句子/段落。规则可解释：
 * - 单个英文词：字母开头，只含字母、直/弯撇号、连字符；或 U.S. 这类缩写。
 * - 其余（含空格、中文、标点句）进入翻译路径。
 * 不把连字符词、撇号词误判成句子。
 */
export function classifySelection(raw: string): SelectionClass {
  const normalized = normalizeText(raw);
  const text = stripWrappers(normalized);
  if (!text) return { kind: 'text', text: '', reason: '选区为空' };
  if (text.length > 4000) return { kind: 'text', text, reason: '选区较长，按段落翻译' };
  if (WORD_RE.test(text) || ABBR_RE.test(text)) {
    return { kind: 'word', text, reason: '单个英文单词或缩写' };
  }
  return { kind: 'text', text, reason: '包含空格、标点或非英文字符，按句子/段落翻译' };
}

/** 生词去重键：仅做确定的 Unicode/空白规范化，保留大小写（US 与 us 不合并） */
export function dedupeKey(word: string): string {
  return normalizeText(word);
}

/** 词典查询别名：把弯撇号规范为直撇号（仅用于查询，不改变收藏拼写） */
export function lookupAlias(word: string): string {
  return word.replace(/’/g, "'");
}

export function isAllCaps(word: string): boolean {
  return /[A-Z]/.test(word) && word === word.toUpperCase();
}
