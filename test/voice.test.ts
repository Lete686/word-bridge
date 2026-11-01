import { describe, expect, it } from 'vitest';
import { noEnglishVoiceMessage, pickEnglishVoice } from '../src/core/voice';

const voice = (name: string, lang: string) => ({ name, lang });

describe('English voice selection', () => {
  it('prefers en-US, then en-GB, then any English voice', () => {
    const us = voice('US English', 'en-US');
    const gb = voice('UK English', 'en-GB');
    const au = voice('AU English', 'en-AU');
    const zh = voice('Chinese', 'zh-CN');
    expect(pickEnglishVoice([zh, au, gb, us])).toBe(us);
    expect(pickEnglishVoice([zh, au, gb])).toBe(gb);
    expect(pickEnglishVoice([zh, au])).toBe(au);
  });

  it('returns null when only non-English voices exist', () => {
    expect(pickEnglishVoice([voice('Chinese', 'zh-CN'), voice('Japanese', 'ja-JP')])).toBeNull();
  });

  it('gives actionable guidance and lists current voices', () => {
    const message = noEnglishVoiceMessage([voice('Microsoft Huihui', 'zh-CN')]);
    expect(message).toContain('未检测到英文语音');
    expect(message).toContain('Windows 设置');
    expect(message).toContain('Microsoft Huihui');
  });
});
