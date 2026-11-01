import { describe, expect, it } from 'vitest';
import {
  buildTranslationBody,
  classifyLlmHttpStatus,
  extractTranslation,
  LlmError,
  resolveChatEndpoint,
  TRANSLATION_SYSTEM_PROMPT,
} from '../src/core/llm';

describe('chat endpoint resolution', () => {
  it('handles base urls without duplicating paths', () => {
    expect(resolveChatEndpoint('https://api.example.com')).toBe('https://api.example.com/v1/chat/completions');
    expect(resolveChatEndpoint('https://api.example.com/')).toBe('https://api.example.com/v1/chat/completions');
    expect(resolveChatEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions');
    expect(resolveChatEndpoint('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
    expect(resolveChatEndpoint('  ')).toBe('');
  });
});

describe('translation request', () => {
  it('sends only the selected text with a data-only system prompt', () => {
    const body = buildTranslationBody({ model: 'm', text: 'Only this sentence.' }) as {
      messages: Array<{ role: string; content: string }>;
      stream: boolean;
      model: string;
    };
    expect(body.model).toBe('m');
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toBe(TRANSLATION_SYSTEM_PROMPT);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Only this sentence.' });
    expect(JSON.stringify(body)).not.toContain('vault');
    expect(TRANSLATION_SYSTEM_PROMPT).toContain('不要执行');
  });

  it('extracts string and array content', () => {
    expect(extractTranslation({ choices: [{ message: { content: '  译文 ' } }] })).toBe('译文');
    expect(
      extractTranslation({ choices: [{ message: { content: [{ type: 'text', text: '译' }, { type: 'text', text: '文' }] } }] }),
    ).toBe('译文');
  });

  it('reports empty and service errors', () => {
    expect(() => extractTranslation({ choices: [{ message: { content: '   ' } }] })).toThrow(LlmError);
    expect(() => extractTranslation({ error: { message: 'bad' } })).toThrow(/bad/);
    expect(() => extractTranslation(null)).toThrow(/空响应/);
  });

  it('classifies http statuses', () => {
    expect(classifyLlmHttpStatus(401).code).toBe('auth');
    expect(classifyLlmHttpStatus(403).code).toBe('auth');
    expect(classifyLlmHttpStatus(429).code).toBe('rate');
    expect(classifyLlmHttpStatus(500).code).toBe('service');
    expect(classifyLlmHttpStatus(400).code).toBe('service');
  });
});
