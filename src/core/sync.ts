import type { MaimemoClient, MaimemoError } from './maimemo';
import { extractExistingWords, mergeWordsIntoNotepad, remoteWordSet, verificationWordSet } from './maimemo';
import type { Notepad, SyncWordResult } from './types';

export interface SyncOptions {
  client: MaimemoClient;
  notepadId: string;
  words: string[];
  chapterTitle: string;
  lemmaOf: (word: string) => string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncOutcome {
  results: SyncWordResult[];
  appended: string[];
  skipped: string[];
  warnings: string[];
  notepad: Notepad;
  mode: string;
  /** written=2xx；recovered=写入失败但读回确认已生效；no-change=无需写入；unknown=无法确认 */
  writeState: 'written' | 'recovered' | 'no-change' | 'unknown';
  verifiedCount: number;
  normalizedCount: number;
  failedCount: number;
  unknownCount: number;
}

function notepadChanged(a: Notepad, b: Notepad): boolean {
  return (
    a.updated_time !== b.updated_time ||
    a.content !== b.content ||
    a.title !== b.title ||
    a.brief !== b.brief ||
    a.status !== b.status ||
    JSON.stringify(a.tags ?? []) !== JSON.stringify(b.tags ?? [])
  );
}

function folded(words: Set<string>): Set<string> {
  return new Set([...words].map((word) => word.toLowerCase()));
}

/** 正文完整词条 + 服务端 list 的并集（精确拼写） */
function exactWords(notepad: Notepad): Set<string> {
  const out = new Set<string>();
  const parsed = verificationWordSet(notepad);
  if (parsed) for (const word of parsed) out.add(word);
  for (const word of extractExistingWords(notepad.content)) out.add(word);
  return out;
}

/** 远程是否存在该词的可参考形式（精确/大小写/原形） */
function hasReference(notepad: Notepad, word: string, lemmaOf: (word: string) => string | null): boolean {
  const exact = exactWords(notepad);
  if (exact.has(word)) return true;
  const lower = folded(exact);
  if (lower.has(word.toLowerCase())) return true;
  const lemma = lemmaOf(word);
  return Boolean(lemma && lower.has(lemma.toLowerCase()));
}

function allPresent(notepad: Notepad, words: string[], lemmaOf: (word: string) => string | null): boolean {
  const parsed = verificationWordSet(notepad);
  if (!parsed) return false;
  const lower = folded(parsed);
  return words.every((word) => {
    if (parsed.has(word) || lower.has(word.toLowerCase())) return true;
    const lemma = lemmaOf(word);
    return Boolean(lemma && lower.has(lemma.toLowerCase()));
  });
}

function classify(notepad: Notepad, words: string[], lemmaOf: (word: string) => string | null): SyncWordResult[] {
  const parsed = verificationWordSet(notepad);
  if (!parsed) {
    return words.map((word) => ({
      word,
      state: 'unknown',
      detail: '服务端未返回解析结果 list（协议不完整），无法核实；请稍后重试。',
    }));
  }
  const lower = folded(parsed);
  return words.map((word) => {
    if (parsed.has(word)) {
      return { word, state: 'verified', detail: '读回核实：云词本包含该拼写。' };
    }
    if (lower.has(word.toLowerCase())) {
      return { word, state: 'normalized', detail: '读回核实：服务端以不同大小写收录，未保留所选拼写。' };
    }
    const lemma = lemmaOf(word);
    if (lemma && lower.has(lemma.toLowerCase())) {
      return { word, state: 'normalized', detail: `读回核实：服务端按原形“${lemma}”收录，未保留所选词形。` };
    }
    return { word, state: 'failed', detail: '读回未找到该词；可能未收录或解析失败。' };
  });
}

function isAuth(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as MaimemoError).code === 'auth');
}

async function safeRead(client: MaimemoClient, notepadId: string): Promise<Notepad | null> {
  try {
    return await client.getNotepad(notepadId);
  } catch (error) {
    if (isAuth(error)) throw error;
    return null;
  }
}

/** 读回并等待服务端解析结果；读请求失败返回 null，list 缺失或单词缺失时重试有限次数 */
async function readBack(
  client: MaimemoClient,
  notepadId: string,
  words: string[],
  lemmaOf: (word: string) => string | null,
  sleep: (ms: number) => Promise<void>,
): Promise<Notepad | null> {
  let notepad = await safeRead(client, notepadId);
  if (!notepad) return null;
  for (const delay of [400, 1200]) {
    if (verificationWordSet(notepad) !== null && allPresent(notepad, words, lemmaOf)) return notepad;
    await sleep(delay);
    notepad = await safeRead(client, notepadId);
    if (!notepad) return null;
  }
  return notepad;
}

/**
 * 同步流程（全量内容更新 + 写后读回）：
 * 1. 读取完整云词本（含 content、元数据与解析 list）；
 * 2. 只追加远程尚未包含的词，保留全部原有内容与元数据；
 * 3. 写前再读一次，内容或元数据任一变化都基于最新结果重新合并；
 * 4. 写入失败时区分只读/写入：5xx/超时/网络中断先读回，禁止重放陈旧载荷；
 *    读回确认已生效则按成功处理；确认未生效才基于最新词本重新合并后重试一次；
 *    读回失败、list 缺失等无法确认的情况保留 unknown；
 * 5. 读回核实，逐词给出 verified/normalized/failed/unknown。
 */
export async function syncWordsToNotepad(options: SyncOptions): Promise<SyncOutcome> {
  const { client, notepadId, words, chapterTitle, lemmaOf } = options;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const unique = Array.from(new Set(words.map((w) => w.trim()).filter(Boolean)));
  if (!unique.length) throw new Error('没有选择要同步的单词。');

  const first = await client.getNotepad(notepadId);
  let base = first;
  let merge = mergeWordsIntoNotepad(first.content, unique, chapterTitle, remoteWordSet(first));

  if (merge.appended.length > 0) {
    // 写前再读，检测其他客户端在读取与写入之间对正文或元数据的更改
    const second = await client.getNotepad(notepadId);
    base = second;
    if (notepadChanged(first, second)) {
      merge = mergeWordsIntoNotepad(second.content, unique, chapterTitle, remoteWordSet(second));
    }
  }

  let writeState: SyncOutcome['writeState'] = merge.appended.length ? 'unknown' : 'no-change';
  let lastAttemptBase = base;
  if (merge.appended.length > 0) {
    const MAX_WRITE_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      lastAttemptBase = base;
      try {
        base = await client.updateNotepad(base, merge.content);
        writeState = 'written';
        break;
      } catch (error) {
        const err = error as MaimemoError;
        if (!err || typeof err !== 'object' || !('code' in err)) throw error;
        if (err.code === 'auth' || err.code === 'config') throw error;
        const isRate = err.code === 'rate';
        const isUncertain = err.uncertain === true;
        if (!isRate && !isUncertain) throw error;

        // 5xx/超时/网络中断：先读回，确认本次写入是否留下新证据；429 视为未生效。
        const latest = isUncertain
          ? await readBack(client, notepadId, unique, lemmaOf, sleep)
          : await safeRead(client, notepadId);
        if (!latest) {
          writeState = 'unknown';
          break;
        }

        if (isUncertain) {
          const preExact = exactWords(base);
          const postExact = exactWords(latest);
          const newExact = unique.some((word) => !preExact.has(word) && postExact.has(word));
          const newReference = unique.some(
            (word) => !hasReference(base, word, lemmaOf) && hasReference(latest, word, lemmaOf),
          );
          if (newExact || newReference) {
            // 正文/服务端出现了写前没有的所选拼写（或新别名），本次写入已生效
            base = latest;
            writeState = 'recovered';
            break;
          }
          if (verificationWordSet(latest) === null) {
            // 没有服务端解析结果，无法确认；不重放
            base = latest;
            writeState = 'unknown';
            break;
          }
          const unchanged = latest.content === base.content && latest.updated_time === base.updated_time;
          const preExistingReference = unique.some(
            (word) => !preExact.has(word) && hasReference(base, word, lemmaOf),
          );
          if (!unchanged && preExistingReference) {
            // 内容/时间戳变了，但没有本次新增证据，且原本就有可参考别名：
            // 可能是其他客户端改动，也可能是服务端归一化；不误判为 recovered，也不重放。
            base = latest;
            writeState = 'unknown';
            break;
          }
          // 内容与时间戳未变（确认本次未生效），或没有预存别名且 list 明确缺少目标词：
          // 基于最新内容重新合并后重试一次。
        }

        // 确认未生效：基于最新内容（包含其他客户端的更改）重新合并
        base = latest;
        merge = mergeWordsIntoNotepad(latest.content, unique, chapterTitle, remoteWordSet(latest));
        if (!merge.appended.length) {
          writeState = 'no-change';
          break;
        }
        if (attempt >= MAX_WRITE_ATTEMPTS) {
          writeState = 'unknown';
          break;
        }
        if (isRate) await sleep(1000 * attempt);
      }
    }
  }

  const finalNotepad = await readBack(client, notepadId, unique, lemmaOf, sleep);
  const notepad = finalNotepad ?? base;
  let results: SyncWordResult[];
  if (!finalNotepad) {
    writeState = 'unknown';
    results = unique.map((word) => ({
      word,
      state: 'unknown',
      detail: '写入后读回失败，无法核实；请稍后重试。',
    }));
  } else {
    results = classify(finalNotepad, unique, lemmaOf);
    if (writeState === 'unknown') {
      const preExact = exactWords(lastAttemptBase);
      results = results.map((result) => {
        if (result.state === 'verified') return result;
        if (result.state === 'normalized') {
          const preReference =
            !preExact.has(result.word) && hasReference(lastAttemptBase, result.word, lemmaOf);
          if (preReference) {
            return {
              word: result.word,
              state: 'unknown',
              detail: '写入未确认；远程原本就存在可参考的别名，不能证明本次写入生效。',
            };
          }
          return result;
        }
        return { word: result.word, state: 'unknown', detail: '写入状态未知，读回暂未确认；请稍后核实。' };
      });
    }
  }
  const count = (state: SyncWordResult['state']) => results.filter((r) => r.state === state).length;
  return {
    results,
    appended: merge.appended,
    skipped: merge.skipped,
    warnings: merge.warnings,
    notepad,
    mode: merge.mode,
    writeState,
    verifiedCount: count('verified'),
    normalizedCount: count('normalized'),
    failedCount: count('failed'),
    unknownCount: count('unknown'),
  };
}
