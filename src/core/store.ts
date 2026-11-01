import type { PluginData, PluginSettings, SyncState, SyncStatus, WordRecord } from './types';
import { dedupeKey } from './text';

export const SECRET_MAIMEMO_TOKEN = 'word-bridge-maimemo-token';
export const SECRET_LLM_KEY = 'word-bridge-llm-key';
export const MAX_WORDS = 5000;
export const MAX_WORD_LENGTH = 64;

const WORD_RE = /^[A-Za-z][A-Za-z'’\-]*$/;
const ABBR_RE = /^(?:[A-Za-z]\.){2,}[A-Za-z]?$/;
const SYNC_STATES: SyncState[] = ['pending', 'verified', 'normalized', 'failed', 'unknown'];
const TARGET_KEY_RE = /^[0-9]*:[A-Za-z0-9_-]{1,128}$/;

export function defaultSettings(): PluginSettings {
  return {
    llm: {
      baseUrl: '',
      model: '',
      apiKeySecretId: SECRET_LLM_KEY,
      timeoutMs: 30_000,
    },
    maimemo: {
      tokenSecretId: SECRET_MAIMEMO_TOKEN,
      notepadId: '',
      notepadTitle: '',
      notepadCreator: null,
      chapterTitle: 'Word Bridge',
      apiBase: '',
    },
  };
}

export function emptyData(): PluginData {
  return { schemaVersion: 1, words: [], settings: defaultSettings() };
}

function asString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeSync(raw: unknown): Record<string, SyncStatus> {
  const out: Record<string, SyncStatus> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!TARGET_KEY_RE.test(key)) continue;
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const state = item.state as SyncState;
    if (!SYNC_STATES.includes(state)) continue;
    const entry: SyncStatus = { state, at: asNumber(item.at, 0) };
    if (typeof item.code === 'string' && item.code) entry.code = item.code.slice(0, 64);
    out[key] = entry;
  }
  return out;
}

/** 只保留允许的字段；旧数据里的释义、原句、路径等一律丢弃 */
export function normalizeData(raw: unknown): { data: PluginData; changed: boolean } {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return { data: base, changed: true };
  const input = raw as Record<string, unknown>;
  const settingsRaw = (input.settings ?? {}) as Record<string, unknown>;
  const llmRaw = (settingsRaw.llm ?? {}) as Record<string, unknown>;
  const mmRaw = (settingsRaw.maimemo ?? {}) as Record<string, unknown>;
  const settings: PluginSettings = {
    llm: {
      baseUrl: asString(llmRaw.baseUrl, 500),
      model: asString(llmRaw.model, 200),
      apiKeySecretId: asString(llmRaw.apiKeySecretId, 80) || SECRET_LLM_KEY,
      timeoutMs: Math.min(120_000, Math.max(3_000, asNumber(llmRaw.timeoutMs, 30_000))),
    },
    maimemo: {
      tokenSecretId: asString(mmRaw.tokenSecretId, 80) || SECRET_MAIMEMO_TOKEN,
      notepadId: asString(mmRaw.notepadId, 128),
      notepadTitle: asString(mmRaw.notepadTitle, 200),
      notepadCreator: typeof mmRaw.notepadCreator === 'number' ? mmRaw.notepadCreator : null,
      chapterTitle: asString(mmRaw.chapterTitle, 60) || 'Word Bridge',
      apiBase: asString(mmRaw.apiBase, 500),
    },
  };

  const words: WordRecord[] = [];
  const seen = new Set<string>();
  const sourceWords = Array.isArray(input.words) ? input.words : [];
  for (const item of sourceWords) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const word = asString(record.w, MAX_WORD_LENGTH).trim();
    if (!word || !(WORD_RE.test(word) || ABBR_RE.test(word))) continue;
    const key = dedupeKey(word);
    if (seen.has(key)) continue;
    seen.add(key);
    words.push({
      w: word,
      addedAt: asNumber(record.addedAt, 0),
      sync: sanitizeSync(record.sync),
    });
    if (words.length >= MAX_WORDS) break;
  }

  const data: PluginData = { schemaVersion: 1, words, settings };
  const changed = JSON.stringify(input) !== JSON.stringify(data);
  return { data, changed };
}

export function targetKey(settings: PluginSettings): string {
  const id = settings.maimemo.notepadId;
  if (!id) return '';
  return `${settings.maimemo.notepadCreator ?? ''}:${id}`;
}

export function findWord(data: PluginData, word: string): WordRecord | undefined {
  const key = dedupeKey(word);
  return data.words.find((record) => dedupeKey(record.w) === key);
}

/** 返回 true 表示新增；false 表示已存在（不改变顺序，不覆盖状态） */
export function addWord(data: PluginData, word: string, now: number): boolean {
  const trimmed = word.trim().slice(0, MAX_WORD_LENGTH);
  if (!trimmed || !(WORD_RE.test(trimmed) || ABBR_RE.test(trimmed))) return false;
  if (data.words.length >= MAX_WORDS) return false;
  if (findWord(data, trimmed)) return false;
  data.words.push({ w: trimmed, addedAt: now, sync: {} });
  return true;
}

export function removeWords(data: PluginData, words: string[]): number {
  const keys = new Set(words.map((w) => dedupeKey(w)));
  const before = data.words.length;
  data.words = data.words.filter((record) => !keys.has(dedupeKey(record.w)));
  return before - data.words.length;
}

export function setSyncStatus(data: PluginData, word: string, target: string, status: SyncStatus): void {
  const record = findWord(data, word);
  if (!record || !target) return;
  record.sync[target] = status;
}

export function pendingWords(data: PluginData, target: string): WordRecord[] {
  return data.words.filter((record) => record.sync[target]?.state !== 'verified');
}

export function statusLabel(state: SyncState | undefined): string {
  switch (state) {
    case 'verified':
      return '已核实';
    case 'normalized':
      return '服务端词形不同';
    case 'failed':
      return '失败';
    case 'unknown':
      return '状态未知';
    case 'pending':
      return '待同步';
    default:
      return '未同步';
  }
}
