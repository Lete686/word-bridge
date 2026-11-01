import type { App } from 'obsidian';

/**
 * 秘密只存 Obsidian SecretStorage（1.11.4+）。
 * 若运行时缺少该 API，退化为会话内存，不写明文到 data.json。
 */
const sessionFallback = new Map<string, string>();

function storage(app: App): { getSecret(id: string): string | null; setSecret(id: string, value: string): void } | null {
  const candidate = (app as unknown as { secretStorage?: { getSecret?: unknown; setSecret?: unknown } }).secretStorage;
  if (candidate && typeof candidate.getSecret === 'function' && typeof candidate.setSecret === 'function') {
    return candidate as { getSecret(id: string): string | null; setSecret(id: string, value: string): void };
  }
  return null;
}

export function getSecret(app: App, id: string): string | null {
  const api = storage(app);
  if (api) {
    try {
      return api.getSecret(id) ?? null;
    } catch {
      return null;
    }
  }
  return sessionFallback.get(id) ?? null;
}

export function setSecret(app: App, id: string, value: string): void {
  const trimmed = value.trim();
  const api = storage(app);
  if (api) {
    api.setSecret(id, trimmed);
    return;
  }
  if (trimmed) sessionFallback.set(id, trimmed);
  else sessionFallback.delete(id);
}

export function hasSecret(app: App, id: string): boolean {
  return Boolean(getSecret(app, id));
}

export function secretStorageAvailable(app: App): boolean {
  return storage(app) !== null;
}
