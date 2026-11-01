import { describe, expect, it } from 'vitest';
import {
  buildUpdatePayload,
  extractExistingWords,
  MaimemoClient,
  MaimemoError,
  mergeWordsIntoNotepad,
  parseNotepadContent,
  RateLimiter,
  remoteWordSet,
  sanitizeErrorText,
  verificationWordSet,
} from '../src/core/maimemo';
import type { HttpRequest } from '../src/core/maimemo';
import type { Notepad } from '../src/core/types';

const notepad = (content: string, list?: Notepad['list']): Notepad => ({
  id: 'abc',
  type: 'NOTEPAD',
  creator: 7,
  status: 'PUBLISHED',
  content,
  title: '我的词本',
  brief: '简介',
  tags: ['标签'],
  list,
  created_time: '2026-01-01T00:00:00.000Z',
  updated_time: '2026-01-01T00:00:00.000Z',
});

describe('notepad parsing and merging', () => {
  it('detects chapter, text and lemma modes', () => {
    expect(parseNotepadContent('# 章\napple').mode).toBe('chapter');
    expect(parseNotepadContent('//\nI saw it.').mode).toBe('lemma-text');
    expect(parseNotepadContent('apple\nbanana').mode).toBe('text');
  });

  it('appends a dedicated chapter while preserving all existing content', () => {
    const content = '# 我的章节\napple\nbanana\n# 其他\ncat\n';
    const result = mergeWordsIntoNotepad(content, ['running', 'apple', 'dog'], 'Word Bridge');
    expect(result.appended).toEqual(['running', 'dog']);
    expect(result.skipped).toEqual(['apple']);
    expect(result.content.startsWith(content)).toBe(true);
    expect(result.content).toBe(`${content}# Word Bridge\nrunning\ndog\n`);
  });

  it('appends into an existing dedicated chapter', () => {
    const content = '# Word Bridge\napple\n\n# 其他\ncat\n';
    const result = mergeWordsIntoNotepad(content, ['run'], 'Word Bridge');
    expect(result.content).toBe('# Word Bridge\napple\nrun\n\n# 其他\ncat\n');
  });

  it('preserves CRLF line endings and bytes', () => {
    const content = '# C\r\napple\r\n';
    const result = mergeWordsIntoNotepad(content, ['run'], 'C');
    expect(result.content).toBe('# C\r\napple\r\nrun\r\n');
  });

  it('appends to text mode without reordering or clearing', () => {
    const content = 'hello world\nfoo bar\n';
    const result = mergeWordsIntoNotepad(content, ['run', 'walk'], 'Word Bridge');
    expect(result.content).toBe('hello world\nfoo bar\nrun\nwalk\n');
  });

  it('warns about lemma mode and still appends', () => {
    const result = mergeWordsIntoNotepad('//\nI saw many birds.\n', ['running'], 'Word Bridge');
    expect(result.mode).toBe('lemma-text');
    expect(result.warnings.join('')).toContain('原形');
    expect(result.content).toBe('//\nI saw many birds.\nrunning\n');
  });

  it('dedupes by exact spelling and does not merge case variants', () => {
    const result = mergeWordsIntoNotepad('# C\nApple\n', ['apple', 'APPLE', 'banana'], 'WB');
    expect(result.appended).toEqual(['apple', 'APPLE', 'banana']);
    expect(result.skipped).toEqual([]);
  });

  it('appends a case-distinct spelling when only the other case exists', () => {
    const result = mergeWordsIntoNotepad('# C\nus\n', ['US'], 'WB');
    expect(result.appended).toEqual(['US']);
    expect(result.skipped).toEqual([]);
  });

  it('does not append an already present dotted abbreviation', () => {
    const result = mergeWordsIntoNotepad('# C\nU.S.\n', ['U.S.'], 'WB');
    expect(result.appended).toEqual([]);
    expect(result.skipped).toEqual(['U.S.']);
  });

  it('does not re-append a spelling already present in the raw content even if list normalized it', () => {
    const result = mergeWordsIntoNotepad('//\nrun\nrunning\n', ['running'], 'WB', new Set(['run']));
    expect(result.appended).toEqual([]);
    expect(result.skipped).toEqual(['running']);
  });

  it('does not treat a word inside a chapter phrase as an independent entry', () => {
    const chapter = mergeWordsIntoNotepad('# C\nwatching TV\n', ['watching'], 'WB');
    expect(chapter.appended).toEqual(['watching']);
    expect(chapter.skipped).toEqual([]);
    const text = mergeWordsIntoNotepad('watching TV\n', ['watching'], 'WB');
    expect(text.appended).toEqual(['watching']);
    expect(text.skipped).toEqual([]);
  });

  it('does not touch content when every word already exists', () => {
    const content = '# C\napple\nrun\n';
    const result = mergeWordsIntoNotepad(content, ['apple', 'run'], 'WB');
    expect(result.content).toBe(content);
    expect(result.appended).toHaveLength(0);
  });

  it('treats each line as a complete entry and does not tokenize phrases', () => {
    const set = extractExistingWords('I saw running birds, running fast.\nwatching TV\nrun');
    expect(set.has('I saw running birds, running fast.')).toBe(true);
    expect(set.has('watching TV')).toBe(true);
    expect(set.has('run')).toBe(true);
    expect(set.has('watching')).toBe(false);
    expect(set.has('running')).toBe(false);
  });

  it('reads remote words from parsed list with exact spelling', () => {
    const withList = notepad('ignored', [
      { type: 'WORD', data: { chapter: 'C', word: 'Running' } },
      { type: 'CHAPTER', data: { chapter: 'C' } },
    ]);
    expect(remoteWordSet(withList).has('Running')).toBe(true);
    expect(remoteWordSet(withList).has('running')).toBe(false);
    const withoutList = notepad('# C\nApple\n');
    expect(remoteWordSet(withoutList).has('Apple')).toBe(true);
    expect(remoteWordSet(withoutList).has('apple')).toBe(false);
  });

  it('requires list for verification and does not derive it from content', () => {
    const withList = notepad('ignored', [{ type: 'WORD', data: { chapter: 'C', word: 'run' } }]);
    expect(verificationWordSet(withList)?.has('run')).toBe(true);
    const missing = notepad('# C\nrun\n');
    expect(verificationWordSet(missing)).toBeNull();
    const empty = notepad('# C\nrun\n', []);
    expect(verificationWordSet(empty)?.size).toBe(0);
  });

  it('trusts server list even when it contains no word items', () => {
    const onlyChapters = notepad('# C\nrun\n', [{ type: 'CHAPTER', data: { chapter: 'C' } }]);
    expect(remoteWordSet(onlyChapters).size).toBe(0);
  });

  it('builds an update payload that preserves metadata', () => {
    const payload = buildUpdatePayload(notepad('# C\n'), '# C\nrun\n') as {
      id: string;
      notepad: Record<string, unknown>;
    };
    expect(payload.id).toBe('abc');
    expect(payload.notepad).toMatchObject({
      status: 'PUBLISHED',
      content: '# C\nrun\n',
      title: '我的词本',
      brief: '简介',
      tags: ['标签'],
    });
  });
});

describe('rate limiter', () => {
  it('waits when the 10-second window is full', async () => {
    let now = 0;
    const limiter = new RateLimiter(
      () => now,
      async (ms) => {
        now += ms;
      },
    );
    for (let i = 0; i < 20; i += 1) await limiter.acquire();
    const before = now;
    await limiter.acquire();
    expect(now - before).toBeGreaterThanOrEqual(9_000);
  });
});

describe('maimemo client', () => {
  const makeClient = (responses: Array<{ status: number; json: unknown; headers?: Record<string, string> }>, calls: Array<unknown>) => {
    let index = 0;
    const request: HttpRequest = async (options) => {
      calls.push(options);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return { status: response.status, json: response.json, headers: response.headers ?? {} };
    };
    return new MaimemoClient({ token: 'secret-token', request, sleep: async () => undefined, now: () => 0 });
  };

  it('lists notepads with bearer auth and no writes', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const client = makeClient([{ status: 200, json: { notepads: [{ id: 'a', title: 'A' }] } }], calls);
    const result = await client.listNotepads();
    expect(result).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/memo/notepads');
    expect(calls[0].headers.Authorization).toBe('Bearer secret-token');
  });

  it('does not retry 401/403', async () => {
    const calls: unknown[] = [];
    const client = makeClient([{ status: 401, json: {} }], calls);
    await expect(client.listNotepads()).rejects.toMatchObject({ code: 'auth' });
    expect(calls).toHaveLength(1);
  });

  it('retries 429 with backoff and succeeds', async () => {
    const calls: unknown[] = [];
    const client = makeClient(
      [
        { status: 429, json: {} },
        { status: 200, json: { notepads: [] } },
      ],
      calls,
    );
    await expect(client.listNotepads()).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('retries GET 5xx and succeeds', async () => {
    const calls: unknown[] = [];
    const client = makeClient(
      [
        { status: 503, json: {} },
        { status: 200, json: { notepads: [] } },
      ],
      calls,
    );
    await expect(client.listNotepads()).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('does not retry POST 5xx and marks the write uncertain', async () => {
    const calls: unknown[] = [];
    const client = makeClient([{ status: 503, json: {} }], calls);
    await expect(client.updateNotepad(notepad('# C\n'), '# C\nrun\n')).rejects.toMatchObject({
      code: 'server',
      status: 503,
      uncertain: true,
    });
    expect(calls).toHaveLength(1);
  });

  it('does not retry POST 429 and marks it as not applied', async () => {
    const calls: unknown[] = [];
    const client = makeClient([{ status: 429, json: {} }], calls);
    await expect(client.updateNotepad(notepad('# C\n'), '# C\nrun\n')).rejects.toMatchObject({
      code: 'rate',
      uncertain: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('maps request timeout to a write-unknown error', async () => {
    const request: HttpRequest = async () => {
      throw Object.assign(new Error('timeout'), { code: 'timeout' });
    };
    const client = new MaimemoClient({ token: 't', request });
    await expect(client.getNotepad('a')).rejects.toMatchObject({ code: 'timeout', uncertain: false });
    await expect(client.updateNotepad(notepad('# C\n'), '# C\nrun\n')).rejects.toMatchObject({
      code: 'timeout',
      uncertain: true,
    });
  });

  it('updates a notepad with full content and metadata', async () => {
    const calls: Array<{ method: string; body?: string; url: string }> = [];
    const updated = notepad('# C\nrun\n');
    const client = makeClient([{ status: 200, json: { notepad: updated } }], calls);
    const result = await client.updateNotepad(notepad('# C\n'), '# C\nrun\n');
    expect(result.content).toBe('# C\nrun\n');
    expect(calls[0].method).toBe('POST');
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body.id).toBe('abc');
    expect(body.notepad.content).toBe('# C\nrun\n');
    expect(body.notepad.title).toBe('我的词本');
  });

  it('throws MaimemoError for auth failures', async () => {
    const calls: unknown[] = [];
    const client = makeClient([{ status: 403, json: {} }], calls);
    await expect(client.getNotepad('a')).rejects.toBeInstanceOf(MaimemoError);
  });
});

/**
 * v0.1.3 真实墨墨连接回归。
 * 说明：以下均为**合成测试夹具**，按现场诊断记录（limit=100 → 400/common_invalid_param，
 * limit=10 → 200 带 data 包装）构造，不是完整真实响应采集。
 */
describe('v0.1.3 page size, response envelope and error detail', () => {
  const listBody = (count: number, startIndex = 0) => ({
    success: true,
    data: {
      notepads: Array.from({ length: count }, (_, i) => ({
        id: `np-${startIndex + i}`,
        type: 'NOTEPAD',
        creator: 7,
        status: 'PUBLISHED',
        title: `词本${startIndex + i}`,
        brief: '',
        tags: [],
        created_time: '2026-01-01T00:00:00.000Z',
        updated_time: '2026-01-01T00:00:00.000Z',
      })),
    },
  });

  /** 按 URL 上的 limit/offset 决定响应，模拟真实分页服务 */
  const makePagedClient = (
    handler: (limit: number, offset: number) => { status: number; json: unknown },
    calls: Array<{ url: string; method: string }>,
  ) => {
    const request: HttpRequest = async (options) => {
      calls.push({ url: options.url, method: options.method });
      const url = new URL(options.url);
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset'));
      const response = handler(limit, offset);
      return { status: response.status, json: response.json, headers: {} };
    };
    return new MaimemoClient({ token: 'secret-token', request, sleep: async () => undefined, now: () => 0 });
  };

  // 用例 1：默认列表请求必须选 limit=10，而不是被拒绝的 100
  it('requests the measured-working page size 10 by default and never sends 100', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient((limit) => {
      if (limit === 100) {
        return {
          status: 400,
          json: { success: false, errors: [{ code: 'common_invalid_param', msg: 'Invalid parameters' }] },
        };
      }
      return { status: 200, json: listBody(2) };
    }, calls);

    const result = await client.listAllNotepads();
    expect(result).toHaveLength(2);
    expect(calls.every((call) => !call.url.includes('limit=100'))).toBe(true);
    expect(calls[0].url).toContain('limit=10');
    expect(calls[0].url).toContain('offset=0');
  });

  // 用例 2：success/data 包装解出两个词本
  it('unwraps a success/data envelope into two notepads', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(() => ({ status: 200, json: listBody(2) }), calls);
    const result = await client.listNotepads();
    expect(result.map((n) => n.id)).toEqual(['np-0', 'np-1']);
  });

  // 用例 3：10/10/2 三页，offset 必须是 0/10/20，合计 22 条
  it('pages 10/10/2 across offsets 0/10/20 and returns all 22 notepads', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient((_limit, offset) => {
      if (offset === 0) return { status: 200, json: listBody(10, 0) };
      if (offset === 10) return { status: 200, json: listBody(10, 10) };
      if (offset === 20) return { status: 200, json: listBody(2, 20) };
      return { status: 200, json: listBody(0, offset) };
    }, calls);

    const result = await client.listAllNotepads();
    expect(result).toHaveLength(22);
    expect(calls.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual(['0', '10', '20']);
    expect(calls.every((c) => new URL(c.url).searchParams.get('limit') === '10')).toBe(true);
    expect(result[21].id).toBe('np-21');
  });

  it('treats an empty first page as a successful empty list', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(() => ({ status: 200, json: listBody(0) }), calls);
    await expect(client.listAllNotepads()).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('fails explicitly instead of returning a partial list when the page cap is reached', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    // 每页都是满页 10 条，说明后面很可能还有下一页；上限 2 页时不得静默返回 20 条
    const client = makePagedClient((_limit, offset) => ({ status: 200, json: listBody(10, offset) }), calls);
    await expect(client.listAllNotepads(2)).rejects.toMatchObject({ code: 'server' });
    await expect(client.listAllNotepads(2)).rejects.toThrow(/未完整读取/);
  });

  /** 按顺序返回给定响应，用于 get/update 等非分页场景 */
  const makeSequentialClient = (responses: Array<{ status: number; json: unknown }>) => {
    let index = 0;
    const request: HttpRequest = async () => {
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return { status: response.status, json: response.json, headers: {} };
    };
    return new MaimemoClient({ token: 'secret-token', request, sleep: async () => undefined, now: () => 0 });
  };

  // 用例 4：get / update 的包装解包，以及未包装响应的向后兼容
  it('unwraps get and update envelopes, and still accepts unwrapped responses', async () => {
    const updated = notepad('# C\nrun\n');
    const wrapped = makeSequentialClient([
      { status: 200, json: { success: true, data: { notepad: updated } } },
      { status: 200, json: { success: true, data: { notepad: updated } } },
    ]);
    await expect(wrapped.getNotepad('abc')).resolves.toMatchObject({ id: 'abc' });
    await expect(wrapped.updateNotepad(notepad('# C\n'), '# C\nrun\n')).resolves.toMatchObject({
      content: '# C\nrun\n',
    });

    const plain = makeSequentialClient([
      { status: 200, json: { notepad: updated } },
      { status: 200, json: { notepad: updated } },
    ]);
    await expect(plain.getNotepad('abc')).resolves.toMatchObject({ id: 'abc' });
    await expect(plain.updateNotepad(notepad('# C\n'), '# C\nrun\n')).resolves.toMatchObject({
      content: '# C\nrun\n',
    });
  });

  it('rejects an envelope whose success is true but data is null or missing', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const nullData = makePagedClient(() => ({ status: 200, json: { success: true, data: null } }), calls);
    await expect(nullData.listNotepads()).rejects.toMatchObject({ code: 'protocol' });

    const missingData = makePagedClient(() => ({ status: 200, json: { success: true } }), calls);
    await expect(missingData.listNotepads()).rejects.toMatchObject({ code: 'protocol' });
  });

  // 用例 5：400+errors[] 与 200+success:false 都是错误；msg/message 都支持；Token 不泄漏
  it('treats 400 with errors[] as an error and keeps the safe code and reason', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(
      () => ({
        status: 400,
        json: { success: false, errors: [{ code: 'common_invalid_param', msg: 'Invalid parameters' }] },
      }),
      calls,
    );
    await expect(client.listNotepads()).rejects.toMatchObject({ code: 'server', status: 400 });
    await expect(client.listNotepads()).rejects.toThrow(/400 \/ common_invalid_param \/ Invalid parameters/);
    expect(calls).toHaveLength(2); // 400 不是可重试状态
  });

  it('treats HTTP 200 with success:false as an error, not an empty list', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(
      () => ({
        status: 200,
        json: { success: false, errors: [{ code: 'some_code', message: 'something went wrong' }] },
      }),
      calls,
    );
    await expect(client.listNotepads()).rejects.toThrow(/some_code \/ something went wrong/);
  });

  it('never leaks the token into an error message', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(
      () => ({
        status: 400,
        json: {
          success: false,
          // 既有断言只覆盖了本来就不输出的 info；此处同时把 Token 放进会被回显的 msg。
          errors: [
            {
              code: 'common_invalid_param',
              msg: 'Invalid parameters for Bearer secret-token',
              info: 'Bearer secret-token',
            },
          ],
        },
      }),
      calls,
    );
    const error = await client.listNotepads().then(
      () => null,
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(MaimemoError);
    const message = error?.message ?? '';
    expect(message).not.toContain('secret-token');
    // 凭证本身必须消失；"Bearer" 这个字面词不是凭证，允许作为原因文本的一部分保留。
    expect(message).not.toContain('Bearer secret-token');
    expect(message).toContain('common_invalid_param');
  });

  // 用例 6：缺少业务字段、无效 JSON 不能显示为“成功，0 个词本”
  it('rejects a payload without notepads instead of reporting a successful empty list', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(() => ({ status: 200, json: { success: true, data: {} } }), calls);
    await expect(client.listNotepads()).rejects.toMatchObject({ code: 'protocol' });

    const wrongType = makePagedClient(
      () => ({ status: 200, json: { success: true, data: { notepads: 'oops' } } }),
      calls,
    );
    await expect(wrongType.listNotepads()).rejects.toMatchObject({ code: 'protocol' });
  });

  it('rejects an invalid JSON body instead of reporting success', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(() => ({ status: 200, json: null }), calls);
    await expect(client.listNotepads()).rejects.toBeInstanceOf(MaimemoError);
    await expect(client.listNotepads()).rejects.not.toThrow(/0 个/);
  });

  it('still accepts a legitimate empty notepads array as success', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(() => ({ status: 200, json: { success: true, data: { notepads: [] } } }), calls);
    await expect(client.listNotepads()).resolves.toEqual([]);
  });

  // 向后兼容：未包装的旧式单数 error 字段在 HTTP 200 时仍须判为错误（v0.1.2 既有行为）
  it('keeps detecting an unwrapped singular error field on HTTP 200', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = makePagedClient(() => ({ status: 200, json: { error: { message: 'boom' } } }), calls);
    await expect(client.listNotepads()).rejects.toBeInstanceOf(MaimemoError);
    await expect(client.listNotepads()).rejects.toThrow(/boom/);
  });
});

/**
 * v0.1.4 补修：对**当前实际使用的 Token** 做字面量脱敏。
 * 以下凭证全部为虚构值，不涉及任何真实用户 Token，也不访问真实服务。
 * 关键点：Token 出现在会被回显的 `msg`/`message` 中（而不是本来就不输出的 `info`）。
 */
describe('v0.1.4 literal redaction of the current token', () => {
  /** 用给定的（虚构）Token 构造客户端，返回最终错误文案 */
  const errorMessageFor = async (token: string, status: number, json: unknown): Promise<string> => {
    const request: HttpRequest = async () => ({ status, json, headers: {} });
    const client = new MaimemoClient({ token, request, sleep: async () => undefined, now: () => 0 });
    const error = await client.listNotepads().then(
      () => null,
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(MaimemoError);
    return error?.message ?? '';
  };

  it('redacts a short token echoed verbatim in errors[].msg (HTTP 400)', async () => {
    const token = 'mock-secret-123';
    const message = await errorMessageFor(token, 400, {
      success: false,
      errors: [{ code: 'common_invalid_param', msg: `Rejected credential: ${token}` }],
    });
    expect(message).not.toContain(token);
    // 有用的错误码与原因仍保留
    expect(message).toContain('400');
    expect(message).toContain('common_invalid_param');
    expect(message).toContain('Rejected credential');
    expect(message).toContain('[redacted]');
  });

  it('redacts a dotted token echoed in errors[].message (HTTP 400)', async () => {
    const token = 'testpart01.testpart02.testpart03.testpart04';
    const message = await errorMessageFor(token, 400, {
      success: false,
      errors: [{ code: 'x', message: `bad ${token}` }],
    });
    expect(message).not.toContain(token);
    expect(message).toContain('bad');
  });

  it('redacts a token containing regex metacharacters without throwing', async () => {
    const token = 'a+b.c(d)[e]{f}^$|\\';
    const message = await errorMessageFor(token, 400, {
      success: false,
      errors: [{ code: 'y', message: `got ${token} here` }],
    });
    expect(message).not.toContain(token);
    expect(message).toContain('got');
    expect(message).toContain('here');
  });

  it('redacts a short token in HTTP 200 + success:false msg', async () => {
    const token = 'abc123';
    const message = await errorMessageFor(token, 200, {
      success: false,
      errors: [{ msg: `token ${token} invalid` }],
    });
    expect(message).not.toContain(token);
    expect(message).toContain('invalid');
  });

  it('redacts a token echoed in the legacy singular error.message branch', async () => {
    const token = 'mock-secret-123';
    const message = await errorMessageFor(token, 200, { error: { message: `nope ${token}` } });
    expect(message).not.toContain(token);
    expect(message).toContain('nope');
  });

  it('redacts every repeated occurrence, not just the first', async () => {
    const token = 'short-tok';
    const message = await errorMessageFor(token, 400, {
      success: false,
      errors: [{ msg: `${token} and ${token} again and ${token}` }],
    });
    expect(message).not.toContain(token);
    expect(message).toContain('again');
    expect((message.match(/\[redacted\]/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('redacts before truncation so a long token cannot survive at the cut', async () => {
    // 长 Token 出现在截断边界附近：若先截断再脱敏，会留下 Token 的前缀残片
    const token = 'z'.repeat(200);
    const message = await errorMessageFor(token, 400, {
      success: false,
      errors: [{ code: 'long', msg: `${token} tail-marker` }],
    });
    expect(message).not.toContain(token);
    expect(message).not.toContain('z'.repeat(24));
    expect(message).toContain('[redacted]');
  });

  it('does not use an empty token for replacement (no text shredding)', async () => {
    const request: HttpRequest = async () => ({
      status: 400,
      json: { success: false, errors: [{ code: 'c1', msg: 'normal reason text' }] },
      headers: {},
    });
    const client = new MaimemoClient({ token: '', request, sleep: async () => undefined, now: () => 0 });
    const message = await client.listNotepads().then(
      () => '',
      (e: Error) => e.message,
    );
    // 空 Token 不参与替换：原因文本保持完整可读
    expect(message).toContain('normal reason text');
  });

  it('keeps the token out of the error object itself, not just its message', async () => {
    const token = 'mock-secret-123';
    const request: HttpRequest = async () => ({
      status: 400,
      json: { success: false, errors: [{ code: 'c', msg: `leak ${token}` }] },
      headers: {},
    });
    const client = new MaimemoClient({ token, request, sleep: async () => undefined, now: () => 0 });
    const error = await client.listNotepads().then(
      () => null,
      (e: Error) => e,
    );
    // 异常对象整体序列化后也不得含 Token（不含堆栈中的闭包变量）
    expect(JSON.stringify({ name: error?.name, message: error?.message })).not.toContain(token);
    expect(String(error?.stack ?? '')).not.toContain(token);
  });

  it('still masks a Bearer-prefixed or long alphanumeric token by shape', async () => {
    const bearer = await errorMessageFor('short', 400, {
      success: false,
      errors: [{ msg: 'Authorization: Bearer abcdefgh12345678' }],
    });
    expect(bearer).not.toContain('abcdefgh12345678');
    const long = await errorMessageFor('unused', 400, {
      success: false,
      errors: [{ msg: 'code ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 end' }],
    });
    expect(long).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
  });

  it('does not emit the token when the sanitizer is called directly', () => {
    const token = 'mock-secret-123';
    const out = sanitizeErrorText(`x ${token} y`, 160, token);
    expect(out).not.toContain(token);
    expect(out).toContain('[redacted]');
  });
});
