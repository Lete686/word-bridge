import type { MergeResult, Notepad } from './types';

export const OFFICIAL_MAIMEMO_BASE = 'https://open.maimemo.com/open/api/v1';
export const DEFAULT_CHAPTER_TITLE = 'Word Bridge';

export type NotepadMode = 'chapter' | 'text' | 'lemma-text';

export interface ParsedContent {
  mode: NotepadMode;
  lineEnding: '\n' | '\r\n';
  endedWithNewline: boolean;
  chapters: Array<{ title: string; start: number; end: number }>;
  lines: string[];
}

/** 按墨墨官方云词本文档解析内容模式（# 章节模式；首行 // 提取原型；其余默认分词） */
export function parseNotepadContent(content: string): ParsedContent {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const endedWithNewline = content.endsWith('\n');
  const firstNonEmpty = lines.find((line) => line.trim().length > 0) ?? '';
  const trimmedFirst = firstNonEmpty.trim();
  let mode: NotepadMode = 'text';
  if (trimmedFirst.startsWith('//')) mode = 'lemma-text';
  else if (trimmedFirst.startsWith('#')) mode = 'chapter';

  const chapters: Array<{ title: string; start: number; end: number }> = [];
  if (mode === 'chapter') {
    let current: { title: string; start: number; end: number } | null = null;
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        if (current) {
          current.end = index;
          chapters.push(current);
        }
        current = { title: trimmed.replace(/^#+/, '').trim(), start: index, end: lines.length };
      }
    });
    if (current) chapters.push(current);
  }
  return { mode, lineEnding, endedWithNewline, chapters, lines };
}

/**
 * 从正文提取已有词条（仅用于缺少服务端 list 时的保守去重）：
 * - 章节模式：一行就是一个完整词条，保留短语边界；
 * - 默认/原形模式：独占一行的单词或短语才算一个词条，不把短语内的 token 当作独立单词；
 * - 保留原始大小写，不做小写归一。
 */
export function extractExistingWords(content: string): Set<string> {
  const parsed = parseNotepadContent(content);
  const out = new Set<string>();
  for (const line of parsed.lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    if (parsed.mode === 'chapter') {
      out.add(trimmed);
      continue;
    }
    // 文本模式：整行是一个短语/句子；只有独占一行的单词/缩写才作为独立词条。
    out.add(trimmed);
  }
  return out;
}

export function sanitizeChapterTitle(title: string): string {
  const cleaned = title.replace(/[\r\n]+/g, ' ').replace(/^#+/, '').trim();
  return cleaned.slice(0, 60) || DEFAULT_CHAPTER_TITLE;
}

/** 在原始行数组的指定位置插入新行，保持已有字节不变（仅追加必要换行） */
function insertRawLines(rawLines: string[], index: number, newLines: string[], nl: string): string[] {
  if (!newLines.length) return rawLines;
  const copy = [...rawLines];
  const at = Math.max(0, Math.min(index, copy.length));
  let prefix = '';
  if (at > 0 && !copy[at - 1].endsWith('\n')) prefix = nl;
  const inserted = newLines.map((line, i) => (i === 0 ? prefix + line : line) + nl);
  copy.splice(at, 0, ...inserted);
  return copy;
}

/**
 * 合并新词并保留远程原有内容：
 * - 章节模式：写入专用章节；已有同名章节则追加到该章节末尾，否则在文件末尾新增章节。
 * - 文本模式：在文件末尾按行追加（不重排、不清空、不改写原内容）。
 * - // 原形模式：同样追加，但提示服务端可能还原词形。
 * 词条身份按完整拼写、区分大小写判断；优先使用服务端 list 的解析结果，
 * 缺少 list 时才按模式语义解析正文。不改动已有任何行。
 */
export function mergeWordsIntoNotepad(
  content: string,
  words: string[],
  chapterTitle = DEFAULT_CHAPTER_TITLE,
  remoteWords?: Set<string> | null,
): MergeResult {
  const parsed = parseNotepadContent(content);
  // 去重同时参考服务端 list 与正文完整词条：服务端可能把 running 归一成 run，
  // 但正文里已经提交过 running 时不能再次追加。
  const existing = new Set<string>();
  if (remoteWords) {
    for (const word of remoteWords) existing.add(word);
  }
  for (const word of extractExistingWords(content)) existing.add(word);
  const seen = new Set<string>();
  const appended: string[] = [];
  const skipped: string[] = [];
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    if (existing.has(word) || seen.has(word)) {
      skipped.push(word);
      continue;
    }
    seen.add(word);
    appended.push(word);
  }
  const warnings: string[] = [];
  if (parsed.mode === 'lemma-text') {
    warnings.push('目标云词本首行为 //（提取原型模式），服务端可能把所选词形还原为原形；同步后将以读回结果核实。');
  }
  if (!appended.length) {
    return { content, mode: parsed.mode, appended, skipped, warnings };
  }

  const nl = parsed.lineEnding;
  const rawLines = content === '' ? [] : content.split(/(?<=\n)/);
  if (parsed.mode === 'chapter') {
    const title = sanitizeChapterTitle(chapterTitle);
    const chapter = parsed.chapters.find((c) => c.title.toLowerCase() === title.toLowerCase());
    if (chapter) {
      let insertAt = chapter.start + 1;
      for (let i = Math.min(chapter.end, parsed.lines.length) - 1; i > chapter.start; i -= 1) {
        if (parsed.lines[i]?.trim()) {
          insertAt = i + 1;
          break;
        }
      }
      const updated = insertRawLines(rawLines, insertAt, appended, nl);
      return { content: updated.join(''), mode: parsed.mode, appended, skipped, warnings };
    }
    const updated = insertRawLines(rawLines, rawLines.length, [`# ${title}`, ...appended], nl);
    return { content: updated.join(''), mode: parsed.mode, appended, skipped, warnings };
  }

  const updated = insertRawLines(rawLines, rawLines.length, appended, nl);
  return { content: updated.join(''), mode: parsed.mode, appended, skipped, warnings };
}

/** 用于去重的远程词条集合：优先服务端 list（保留完整拼写与大小写）；缺失时才回退正文解析 */
export function remoteWordSet(notepad: Notepad): Set<string> {
  const parsed = verificationWordSet(notepad);
  if (parsed) return parsed;
  if (typeof notepad.content === 'string') return extractExistingWords(notepad.content);
  return new Set<string>();
}

/**
 * 用于“已核实”的服务端解析结果。规范要求 Notepad.list；
 * 缺失或类型不正确时返回 null，表示协议不完整、不能据此标记 verified。
 */
export function verificationWordSet(notepad: Notepad): Set<string> | null {
  if (!Array.isArray(notepad.list)) return null;
  const out = new Set<string>();
  for (const item of notepad.list) {
    if (item.type === 'WORD' && typeof item.data?.word === 'string') {
      const word = item.data.word.trim();
      if (word) out.add(word);
    }
  }
  return out;
}

export function buildUpdatePayload(notepad: Notepad, content: string): Record<string, unknown> {
  return {
    id: notepad.id,
    notepad: {
      status: notepad.status,
      content,
      title: notepad.title,
      brief: notepad.brief,
      tags: notepad.tags ?? [],
    },
  };
}

/** 官方频控：10 秒 20 次、60 秒 40 次。串行请求，超限自动等待。 */
export class RateLimiter {
  private readonly stamps: number[] = [];
  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.now();
      while (this.stamps.length && now - this.stamps[0] >= 60_000) this.stamps.shift();
      const last10 = this.stamps.filter((t) => now - t < 10_000);
      if (last10.length >= 20) {
        const wait = 10_000 - (now - last10[0]) + 50;
        await this.sleep(Math.max(50, wait));
        continue;
      }
      if (this.stamps.length >= 40) {
        const wait = 60_000 - (now - this.stamps[0]) + 50;
        await this.sleep(Math.max(50, wait));
        continue;
      }
      this.stamps.push(now);
      return;
    }
  }
}

export class MaimemoError extends Error {
  readonly code: 'auth' | 'rate' | 'timeout' | 'network' | 'server' | 'config' | 'verify' | 'protocol';
  readonly status?: number;
  /** 写请求失败时结果可能已在服务端生效（5xx/超时/网络中断） */
  readonly uncertain: boolean;

  constructor(code: MaimemoError['code'], message: string, status?: number, uncertain = false) {
    super(message);
    this.name = 'MaimemoError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}

/**
 * 分页页大小：实测服务端对 `limit=100` 返回 400/common_invalid_param，对 `limit=10` 成功。
 * 未验证服务端允许的最大值，此处只固定使用实测成功的 10。
 */
export const NOTEPAD_PAGE_SIZE = 10;
/** 分页页数上限；达到上限仍可能有下一页时报错，不静默返回部分列表。 */
export const NOTEPAD_MAX_PAGES = 10;
const ERROR_TEXT_MAX = 160;

/**
 * 服务端错误原因脱敏：只保留安全的短文本。
 * - 先按**字面量**替换当前实际使用的 Token（见 `literalRedact`），不依赖 Token 的形状；
 * - 再剔除 Bearer/Authorization 凭据、长敏感串、邮箱，压平空白并限制长度；
 * - 不输出完整请求/响应对象、词本正文或 errors[].info。
 */
export function sanitizeErrorText(value: unknown, max = ERROR_TEXT_MAX, secret?: string): string {
  if (typeof value !== 'string') return '';
  let text = literalRedact(value, secret);
  text = text.replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[redacted]');
  text = text.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]');
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]');
  text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (text.length > max) text = `${text.slice(0, max)}…`;
  return text;
}

/**
 * 按字面量移除当前凭证的全部出现（在通用规则与截断**之前**执行）。
 * - 用 `split/join` 而非正则：Token 可能含 `.`/`+`/`(` 等正则元字符，拼入正则会改变语义甚至抛错；
 * - 空或非字符串 Token 不参与替换（避免空串把整段文本切碎）；
 * - 调用方不得把 Token 写入日志、快照或异常对象。
 */
function literalRedact(text: string, secret?: string): string {
  if (!secret || typeof secret !== 'string') return text;
  return text.split(secret).join('[redacted]');
}

/** 脱敏上下文：携带当前实际使用的 Token，供整条错误处理链复用 */
export interface RedactionContext {
  secret?: string;
}

/** 从 errors[] / error 提取安全的 `code` 与简短原因（支持 msg 与 message） */
function extractServerError(payload: unknown, ctx?: RedactionContext): { code: string; reason: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const body = payload as { errors?: unknown; error?: unknown };
  const candidates: unknown[] = [];
  if (Array.isArray(body.errors)) candidates.push(...body.errors);
  if (body.error !== undefined) candidates.push(body.error);
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as { code?: unknown; msg?: unknown; message?: unknown };
    const code = typeof entry.code === 'string' ? sanitizeErrorText(entry.code, 60, ctx?.secret) : '';
    const raw = typeof entry.msg === 'string' ? entry.msg : entry.message;
    const reason = sanitizeErrorText(raw, ERROR_TEXT_MAX, ctx?.secret);
    if (code || reason) return { code, reason };
  }
  return null;
}

/** 组装 `状态码 / 错误码 / 原因` 形式的安全提示（缺失部分省略） */
function describeHttpError(status: number, payload: unknown, fallback: string, ctx?: RedactionContext): string {
  const detail = extractServerError(payload, ctx);
  const parts = [String(status)];
  if (detail?.code) parts.push(detail.code);
  if (detail?.reason) parts.push(detail.reason);
  if (parts.length === 1) parts.push(fallback);
  return `墨墨服务返回错误（${parts.join(' / ')}）。`;
}

/** 响应是否带 success/data/errors 包装格式 */
function isEnvelope(json: unknown): json is { success?: unknown; data?: unknown; errors?: unknown; error?: unknown } {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  const body = json as Record<string, unknown>;
  return 'success' in body || 'data' in body || 'errors' in body;
}

/**
 * 公共解包：list/get/update 共用。
 * - 未包装的业务响应（既有 mock 与适配器）原样返回，保持兼容；
 * - 包装响应中 `success:false`、非空 errors、`data` 为 null/缺失/非对象，一律报协议错误，
 *   不使用 `body.data ?? body` 掩盖问题；
 * - 已识别的包装成功响应返回其 `data`，由各方法校验具体业务字段。
 */
function unwrapEnvelope(json: unknown, ctx?: RedactionContext): unknown {
  if (!isEnvelope(json)) {
    // 未包装响应：保留对旧式单数 `error` 字段的识别（HTTP 200 也可能是业务错误）。
    if (json && typeof json === 'object' && !Array.isArray(json) && 'error' in json) {
      const detail = extractServerError(json, ctx);
      const parts: string[] = [];
      if (detail?.code) parts.push(detail.code);
      if (detail?.reason) parts.push(detail.reason);
      throw new MaimemoError('server', `墨墨服务返回错误（${parts.length ? parts.join(' / ') : '未知错误'}）。`);
    }
    return json;
  }
  const body = json as { success?: unknown; data?: unknown; errors?: unknown; error?: unknown };
  const hasErrors = Array.isArray(body.errors) ? body.errors.length > 0 : body.errors != null;
  if (hasErrors || body.success === false) {
    const detail = extractServerError(body, ctx);
    const parts = detail?.code ? [detail.code] : [];
    if (detail?.reason) parts.push(detail.reason);
    throw new MaimemoError(
      'server',
      `墨墨服务返回错误（${parts.length ? parts.join(' / ') : 'success=false'}）。`,
    );
  }
  if (body.success !== true) {
    // 既没有明确 success:true，也没有错误内容：无法确认成功，不能当作成功。
    throw new MaimemoError('protocol', '墨墨响应格式无法识别（缺少 success 标记）。');
  }
  if (body.data === null || body.data === undefined || typeof body.data !== 'object') {
    throw new MaimemoError('protocol', '墨墨响应缺少业务数据 data，无法解析。');
  }
  return body.data;
}

export type HttpResult = { status: number; json: unknown; headers: Record<string, string> };
export type HttpRequest = (options: {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}) => Promise<HttpResult>;

export interface MaimemoClientOptions {
  token: string;
  baseUrl?: string;
  request: HttpRequest;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class MaimemoClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly request: HttpRequest;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: RateLimiter;
  private readonly timeoutMs: number;

  constructor(options: MaimemoClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl?.trim() || OFFICIAL_MAIMEMO_BASE).replace(/\/+$/, '');
    this.request = options.request;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new RateLimiter(options.now ?? Date.now, this.sleep);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    const readOnly = method === 'GET';
    // 当前实际使用的 Token：整条错误链的字面量脱敏都基于它，不依赖 Token 形状。
    const ctx: RedactionContext = { secret: this.token };
    const maxAttempts = readOnly ? 3 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.limiter.acquire();
      let result: HttpResult;
      try {
        result = await this.request({
          url: `${this.baseUrl}${path}`,
          method,
          headers: this.headers(),
          body: body === undefined ? undefined : JSON.stringify(body),
          timeoutMs: this.timeoutMs,
        });
      } catch (error) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'timeout') {
          throw new MaimemoError(
            'timeout',
            readOnly ? '墨墨请求超时。' : '墨墨写入超时，结果未知；请先读回确认。',
            undefined,
            !readOnly,
          );
        }
        throw new MaimemoError('network', '无法连接墨墨服务，请检查网络。', undefined, !readOnly);
      }
      if (result.status === 401 || result.status === 403) {
        throw new MaimemoError('auth', '墨墨鉴权失败（401/403），请检查 Token 是否有效。', result.status);
      }
      if (result.status === 429) {
        if (readOnly && attempt < maxAttempts - 1) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new MaimemoError(
          'rate',
          describeHttpError(result.status, result.json, '请求过于频繁，请稍后重试', ctx),
          result.status,
        );
      }
      if (result.status >= 500) {
        if (readOnly && attempt < maxAttempts - 1) {
          await this.sleep(500 * 2 ** attempt);
          continue;
        }
        // 写请求的 5xx 可能已在服务端生效：标记 uncertain，由同步流程先读回，禁止盲目重放。
        throw new MaimemoError(
          'server',
          describeHttpError(result.status, result.json, '服务端错误', ctx),
          result.status,
          !readOnly,
        );
      }
      if (result.status < 200 || result.status >= 300) {
        throw new MaimemoError(
          'server',
          describeHttpError(result.status, result.json, '请求被拒绝', ctx),
          result.status,
        );
      }
      return unwrapEnvelope(result.json, ctx);
    }
    throw new MaimemoError('server', '墨墨请求失败。');
  }

  async listNotepads(limit = NOTEPAD_PAGE_SIZE, offset = 0): Promise<import('./types').BriefNotepad[]> {
    const json = (await this.call(`/memo/notepads?limit=${limit}&offset=${offset}`, 'GET')) as {
      notepads?: import('./types').BriefNotepad[];
    };
    // 缺少 notepads 或其类型错误属于协议问题，不能用 [] 掩盖解析失败。
    if (!json || typeof json !== 'object' || Array.isArray(json) || !('notepads' in json)) {
      throw new MaimemoError('protocol', '墨墨返回的云词本列表结构不完整（缺少 notepads）。');
    }
    const notepads = (json as { notepads?: unknown }).notepads;
    if (!Array.isArray(notepads)) {
      throw new MaimemoError('protocol', '墨墨返回的云词本列表结构不正确（notepads 不是数组）。');
    }
    return notepads as import('./types').BriefNotepad[];
  }

  /**
   * 有界分页：按 limit=10&offset=0/10/20… 逐页读取，短页或空页终止。
   * 达到页数上限却仍可能还有下一页时明确报错，不静默返回部分列表并声称完整成功。
   */
  async listAllNotepads(maxPages = NOTEPAD_MAX_PAGES): Promise<import('./types').BriefNotepad[]> {
    const all: import('./types').BriefNotepad[] = [];
    for (let page = 0; page < maxPages; page += 1) {
      const batch = await this.listNotepads(NOTEPAD_PAGE_SIZE, page * NOTEPAD_PAGE_SIZE);
      all.push(...batch);
      if (batch.length < NOTEPAD_PAGE_SIZE) return all;
    }
    throw new MaimemoError(
      'server',
      `墨墨云词本数量超过单次读取上限（${maxPages} 页 × ${NOTEPAD_PAGE_SIZE} 条），结果未完整读取；请缩小范围后重试。`,
    );
  }

  async getNotepad(id: string): Promise<Notepad> {
    const json = (await this.call(`/memo/notepads/${encodeURIComponent(id)}`, 'GET')) as { notepad?: Notepad };
    if (!json || typeof json !== 'object' || !json.notepad || typeof json.notepad !== 'object') {
      throw new MaimemoError('protocol', '墨墨返回的云词本为空或结构不完整。');
    }
    return json.notepad;
  }

  async updateNotepad(notepad: Notepad, content: string): Promise<Notepad> {
    const json = (await this.call(`/memo/notepads/${encodeURIComponent(notepad.id)}`, 'POST', buildUpdatePayload(notepad, content))) as {
      notepad?: Notepad;
    };
    if (!json || typeof json !== 'object' || !json.notepad || typeof json.notepad !== 'object') {
      throw new MaimemoError('protocol', '墨墨未返回更新后的云词本或结构不完整。');
    }
    return json.notepad;
  }
}
