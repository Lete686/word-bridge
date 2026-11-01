export interface DictionaryMeta {
  name: string;
  source: string;
  sourceRelease?: string;
  license: string;
  sourceFile?: string;
  sourceSha256?: string;
  maxRank?: number;
  generated?: string;
}

/** [音标, 中文释义（换行分隔）, 可信原形, 原形关系] */
export type RawDictEntry = [string, string, string | null, string | null];

export interface DictionaryData {
  meta: DictionaryMeta;
  entries: Record<string, RawDictEntry>;
}

export interface DictEntry {
  phonetic: string;
  definition: string;
  lemma: string | null;
  relation: string | null;
}

export interface LookupResult {
  /** 用户选中的拼写（原样保留） */
  word: string;
  /** 命中的词典词条键 */
  matchedKey: string;
  entry: DictEntry;
  /** 非空表示命中大小写/别名降级，需要在界面说明 */
  variantNote: string | null;
}

export type SelectionKind = 'word' | 'text';

export interface SelectionClass {
  kind: SelectionKind;
  text: string;
  reason: string;
}

export type SyncState = 'pending' | 'verified' | 'normalized' | 'failed' | 'unknown';

export interface SyncStatus {
  state: SyncState;
  at: number;
  code?: string;
}

export interface WordRecord {
  w: string;
  addedAt: number;
  sync: Record<string, SyncStatus>;
}

export interface LlmSettings {
  baseUrl: string;
  model: string;
  apiKeySecretId: string;
  timeoutMs: number;
}

export interface MaimemoSettings {
  tokenSecretId: string;
  notepadId: string;
  notepadTitle: string;
  notepadCreator: number | null;
  chapterTitle: string;
  /** 仅测试/高级用途；留空使用官方地址 */
  apiBase: string;
}

export interface PluginSettings {
  llm: LlmSettings;
  maimemo: MaimemoSettings;
}

export interface PluginData {
  schemaVersion: 1;
  words: WordRecord[];
  settings: PluginSettings;
}

export interface NotepadParsedItem {
  type: 'CHAPTER' | 'WORD';
  data: { chapter: string; word?: string };
}

export interface Notepad {
  id: string;
  type: string;
  creator: number;
  status: string;
  content: string;
  title: string;
  brief: string;
  tags: string[];
  list?: NotepadParsedItem[];
  created_time: string;
  updated_time: string;
}

export interface BriefNotepad {
  id: string;
  type: string;
  creator: number;
  status: string;
  title: string;
  brief: string;
  tags: string[];
  created_time: string;
  updated_time: string;
}

export interface MergeResult {
  content: string;
  mode: 'chapter' | 'text' | 'lemma-text';
  appended: string[];
  skipped: string[];
  warnings: string[];
}

export interface SyncWordResult {
  word: string;
  state: SyncState;
  detail: string;
}
