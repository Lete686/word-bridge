export interface VoiceLike {
  name: string;
  lang: string;
}

/** 优先 en-US，其次 en-GB，再次任意 en-*；没有英文语音返回 null */
export function pickEnglishVoice<T extends VoiceLike>(voices: T[]): T | null {
  const english = voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang));
  return (
    english.find((voice) => /^en[-_]US$/i.test(voice.lang)) ??
    english.find((voice) => /^en[-_]GB$/i.test(voice.lang)) ??
    english[0] ??
    null
  );
}

export function noEnglishVoiceMessage(voices: VoiceLike[]): string {
  const names = voices
    .map((voice) => `${voice.name}（${voice.lang}）`)
    .filter(Boolean)
    .slice(0, 3)
    .join('、');
  const current = names ? `当前系统语音：${names}。` : '当前系统没有可用语音。';
  return `未检测到英文语音，无法提供可靠的英文发音。${current}请在 Windows 设置 → 时间和语言 → 语音 中添加英文语音后重试。`;
}
