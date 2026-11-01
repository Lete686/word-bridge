import { requestUrl } from 'obsidian';
import type { HttpResult } from '../core/maimemo';

export interface HttpOptions {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export class HttpTimeoutError extends Error {
  readonly code = 'timeout';
  constructor() {
    super('请求超时');
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 通过 Obsidian requestUrl 发起请求（绕过渲染进程 CORS）。
 * requestUrl 无法真正取消；超时只丢弃等待，服务端仍可能已处理写入。
 */
export async function httpRequest(options: HttpOptions): Promise<HttpResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HttpTimeoutError()), options.timeoutMs);
  });
  try {
    const response = await Promise.race([
      requestUrl({
        url: options.url,
        method: options.method,
        headers: options.headers,
        body: options.body,
        throw: false,
      }),
      timeout,
    ]);
    return {
      status: response.status,
      json: parseJson(response.text),
      headers: response.headers ?? {},
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
