import { Notice, Plugin, normalizePath } from 'obsidian';
import { Dictionary } from './core/dictionary';
import {
  classifyLlmHttpStatus,
  buildTranslationBody,
  describeLlmError,
  extractTranslation,
  LlmError,
  resolveChatEndpoint,
} from './core/llm';
import { MaimemoClient, MaimemoError } from './core/maimemo';
import { syncWordsToNotepad } from './core/sync';
import {
  addWord,
  emptyData,
  findWord,
  normalizeData,
  removeWords,
  SECRET_LLM_KEY,
  SECRET_MAIMEMO_TOKEN,
  setSyncStatus,
  targetKey,
} from './core/store';
import type { DictionaryData, LookupResult, PluginData } from './core/types';
import { classifySelection } from './core/text';
import { noEnglishVoiceMessage, pickEnglishVoice } from './core/voice';
import { httpRequest, HttpTimeoutError } from './services/http';
import { getSecret, hasSecret, setSecret } from './services/secrets';
import { Popup, type FavoriteResult } from './ui/popup';
import { SelectionWatcher, type SelectionSnapshot } from './ui/selectionWatcher';
import { WordListModal } from './ui/wordListModal';
import { WordBridgeSettingTab } from './ui/settingsTab';

export default class WordBridgePlugin extends Plugin {
  private data: PluginData = emptyData();
  private dictionaryInstance: Dictionary | null = null;
  private dictionaryPromise: Promise<Dictionary> | null = null;
  private popup: Popup | null = null;
  private watcher: SelectionWatcher | null = null;
  private requestSeq = 0;
  private syncChain: Promise<unknown> = Promise.resolve();
  private unloaded = false;

  get pluginSettings() {
    return this.data.settings;
  }

  async onload(): Promise<void> {
    const raw = await this.loadData();
    await this.migrateLegacySecrets(raw);
    const { data, changed } = normalizeData(raw);
    this.data = data;
    if (changed) await this.saveData(this.data);

    this.popup = new Popup({
      onFavorite: (word) => this.favorite(word),
      onSpeak: (word) => this.speak(word),
      onCopy: (text) => this.copyText(text),
      onClosed: () => {
        this.requestSeq += 1;
      },
    });
    this.watcher = new SelectionWatcher((snapshot) => this.onSelectionActivated(snapshot));
    this.watcher.start();
    this.addSettingTab(new WordBridgeSettingTab(this.app, this));

    this.addRibbonIcon('book-open', '打开生词列表', () => this.openWordList());
    this.addCommand({ id: 'open-word-list', name: '打开生词列表', callback: () => this.openWordList() });
    this.addCommand({
      id: 'reload-dictionary',
      name: '重新加载内置词典',
      callback: async () => {
        try {
          await this.reloadDictionary();
          new Notice(`词典已加载：${this.dictionaryInstance?.size.toLocaleString() ?? 0} 条。`);
        } catch (error) {
          new Notice(`词典加载失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
      },
    });

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.watcher?.hide();
        this.popup?.close();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.watcher?.hide();
        this.popup?.close();
      }),
    );
  }

  onunload(): void {
    this.unloaded = true;
    this.requestSeq += 1;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* 某些环境没有 speechSynthesis，忽略 */
    }
    this.watcher?.destroy();
    this.popup?.destroy();
    this.watcher = null;
    this.popup = null;
  }

  // ---------- 选区与查词 ----------

  private onSelectionActivated(snapshot: SelectionSnapshot): void {
    if (this.unloaded || !this.popup) return;
    const classified = classifySelection(snapshot.text);
    if (!classified.text) return;
    const seq = ++this.requestSeq;
    const isWord = classified.kind === 'word';
    this.popup.show(snapshot.rect, isWord ? '查词' : '翻译');
    if (isWord) void this.lookupWord(seq, classified.text);
    else void this.translateSelection(seq, classified.text);
  }

  private async lookupWord(seq: number, word: string): Promise<void> {
    let dictionary: Dictionary;
    try {
      dictionary = await this.loadDictionary();
    } catch (error) {
      if (seq !== this.requestSeq || !this.popup) return;
      this.popup.renderError('词典加载失败', error instanceof Error ? error.message : '未知错误');
      return;
    }
    if (seq !== this.requestSeq || !this.popup) return;
    const result = dictionary.lookup(word);
    if (result) this.popup.renderWord(result);
    else this.popup.renderNotFound(word);
  }

  private async translateSelection(seq: number, text: string): Promise<void> {
    try {
      const translation = await this.requestTranslation(text);
      if (seq !== this.requestSeq || !this.popup) return;
      this.popup.renderTranslation(translation);
    } catch (error) {
      if (seq !== this.requestSeq || !this.popup) return;
      if (error instanceof LlmError) {
        this.popup.renderError('翻译失败', error.message, () => {
          const next = ++this.requestSeq;
          this.popup?.setLoading('正在重试…');
          void this.translateSelection(next, text);
        });
        return;
      }
      this.popup.renderError('翻译失败', describeLlmError(error));
    }
  }

  private async requestTranslation(text: string): Promise<string> {
    const llm = this.pluginSettings.llm;
    const endpoint = resolveChatEndpoint(llm.baseUrl);
    if (!endpoint) throw new LlmError('config', '尚未配置大模型服务地址。');
    if (!llm.model.trim()) throw new LlmError('config', '尚未配置大模型名称。');
    const key = getSecret(this.app, llm.apiKeySecretId || SECRET_LLM_KEY);
    if (!key) throw new LlmError('config', '尚未配置大模型 API Key。');

    let result;
    try {
      result = await httpRequest({
        url: endpoint,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(buildTranslationBody({ model: llm.model, text })),
        timeoutMs: llm.timeoutMs,
      });
    } catch (error) {
      if (error instanceof HttpTimeoutError) throw new LlmError('timeout', '请求超时，请检查网络或服务地址。');
      throw new LlmError('network', '无法连接大模型服务，请检查网络或服务地址。');
    }
    if (result.status < 200 || result.status >= 300) {
      throw classifyLlmHttpStatus(result.status);
    }
    return extractTranslation(result.json);
  }

  // ---------- 收藏 ----------

  private async favorite(word: string): Promise<FavoriteResult> {
    if (addWord(this.data, word, Date.now())) {
      await this.saveData(this.data);
      return 'added';
    }
    return findWord(this.data, word) ? 'exists' : 'invalid';
  }

  private async speak(word: string): Promise<string> {
    if (
      typeof window === 'undefined' ||
      typeof window.speechSynthesis === 'undefined' ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      throw new Error('当前环境不支持系统语音。');
    }
    const voices = await this.getVoices();
    const voice = pickEnglishVoice(voices);
    if (!voice) throw new Error(noEnglishVoiceMessage(voices));
    await new Promise<void>((resolve, reject) => {
      try {
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = 0.9;
        utterance.onend = () => resolve();
        utterance.onerror = () => reject(new Error('英文语音播放失败。'));
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('英文语音播放失败。'));
      }
    });
    return voice.name;
  }

  /** 部分环境下语音列表异步加载；空列表时等待 voiceschanged 最多 1.5 秒 */
  private async getVoices(): Promise<SpeechSynthesisVoice[]> {
    const synth = window.speechSynthesis;
    const immediate = synth.getVoices();
    if (immediate.length) return immediate;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        synth.removeEventListener('voiceschanged', finish);
        resolve(synth.getVoices());
      };
      synth.addEventListener('voiceschanged', finish);
      window.setTimeout(finish, 1500);
    });
  }

  private async copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
      return ok;
    }
  }

  // ---------- 词典 ----------

  async loadDictionary(): Promise<Dictionary> {
    if (this.dictionaryInstance) return this.dictionaryInstance;
    if (!this.dictionaryPromise) {
      this.dictionaryPromise = this.readDictionary();
    }
    try {
      const dictionary = await this.dictionaryPromise;
      this.dictionaryInstance = dictionary;
      return dictionary;
    } catch (error) {
      this.dictionaryPromise = null;
      throw error;
    }
  }

  private async readDictionary(): Promise<Dictionary> {
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const path = normalizePath(`${dir}/dictionary.json`);
    const text = await this.app.vault.adapter.read(path);
    let parsed: DictionaryData;
    try {
      parsed = JSON.parse(text) as DictionaryData;
    } catch {
      throw new Error('dictionary.json 不是有效 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
      throw new Error('dictionary.json 结构无效');
    }
    return new Dictionary(parsed);
  }

  async reloadDictionary(): Promise<void> {
    this.dictionaryInstance = null;
    this.dictionaryPromise = null;
    await this.loadDictionary();
  }

  dictionaryInfo(): { loaded: boolean; size: number; meta?: Dictionary['meta'] } {
    if (!this.dictionaryInstance) return { loaded: false, size: 0 };
    return { loaded: true, size: this.dictionaryInstance.size, meta: this.dictionaryInstance.meta };
  }

  // ---------- 设置 ----------

  async saveSettings(): Promise<void> {
    await this.saveData(this.data);
  }

  wordCount(): number {
    return this.data.words.length;
  }

  targetStatusSummary(): string {
    const key = targetKey(this.pluginSettings);
    if (!key) return '';
    const verified = this.data.words.filter((record) => record.sync[key]?.state === 'verified').length;
    return `已核实 ${verified} / 共 ${this.data.words.length} 个生词`;
  }

  openWordList(): void {
    const modal = new WordListModal(this.app, {
      words: () => {
        const key = targetKey(this.pluginSettings);
        return this.data.words.map((record) => ({ word: record.w, state: key ? record.sync[key]?.state : undefined }));
      },
      targetLabel: () => {
        const mm = this.pluginSettings.maimemo;
        if (!mm.notepadId) return '尚未选择目标云词本。请在插件设置中配置墨墨 Token 并读取词本列表。';
        return `${mm.notepadTitle || mm.notepadId}（ID ${mm.notepadId}）`;
      },
      targetConfigured: () =>
        Boolean(this.pluginSettings.maimemo.notepadId && hasSecret(this.app, this.pluginSettings.maimemo.tokenSecretId)),
      sync: (words) => this.syncWords(words),
      remove: async (words) => {
        removeWords(this.data, words);
        await this.saveData(this.data);
      },
      openSettings: () => this.openSettings(),
    });
    modal.open();
  }

  async clearWords(): Promise<void> {
    this.data.words = [];
    await this.saveData(this.data);
  }

  private openSettings(): void {
    try {
      const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
      setting?.open();
      setting?.openTabById(this.manifest.id);
    } catch {
      new Notice('请从 Obsidian 设置 → 第三方插件中打开 Word Bridge 设置。');
    }
  }

  // ---------- 墨墨 ----------

  async listNotepads() {
    const token = getSecret(this.app, this.pluginSettings.maimemo.tokenSecretId || SECRET_MAIMEMO_TOKEN);
    if (!token) throw new MaimemoError('config', '尚未配置墨墨 Token。');
    return this.createMaimemoClient(token).listAllNotepads();
  }

  async testLlm(): Promise<string> {
    return this.requestTranslation('Hello');
  }

  async syncWords(words: string[]): Promise<import('./core/sync').SyncOutcome> {
    const mm = this.pluginSettings.maimemo;
    if (!mm.notepadId) throw new MaimemoError('config', '尚未选择目标云词本。');
    const token = getSecret(this.app, mm.tokenSecretId || SECRET_MAIMEMO_TOKEN);
    if (!token) throw new MaimemoError('config', '尚未配置墨墨 Token。');
    const dictionary = await this.loadDictionary();
    const lemmaOf = (word: string): string | null => {
      const result: LookupResult | null = dictionary.lookup(word);
      return result?.entry.lemma ?? null;
    };
    const client = this.createMaimemoClient(token);
    const key = targetKey(this.pluginSettings);
    const chapterTitle = mm.chapterTitle;
    const notepadId = mm.notepadId;

    const run = async () => {
      const outcome = await syncWordsToNotepad({ client, notepadId, words, chapterTitle, lemmaOf });
      for (const result of outcome.results) {
        setSyncStatus(this.data, result.word, key, {
          state: result.state,
          at: Date.now(),
          code: result.state === 'verified' ? undefined : result.state,
        });
      }
      await this.saveData(this.data);
      return outcome;
    };
    const task = this.syncChain.then(run, run);
    this.syncChain = task.catch(() => undefined);
    return task;
  }

  private createMaimemoClient(token: string): MaimemoClient {
    return new MaimemoClient({
      token,
      baseUrl: this.pluginSettings.maimemo.apiBase || undefined,
      request: httpRequest,
    });
  }

  // ---------- 旧数据迁移 ----------

  private async migrateLegacySecrets(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const settings = (raw as { settings?: Record<string, unknown> }).settings;
    if (!settings || typeof settings !== 'object') return;
    const llm = settings.llm as Record<string, unknown> | undefined;
    const mm = settings.maimemo as Record<string, unknown> | undefined;
    const legacyLlm = typeof llm?.apiKey === 'string' ? llm.apiKey : '';
    const legacyToken =
      typeof mm?.token === 'string' ? mm.token : typeof mm?.accessToken === 'string' ? mm.accessToken : '';
    if (legacyLlm.trim()) setSecret(this.app, SECRET_LLM_KEY, legacyLlm);
    if (legacyToken.trim()) setSecret(this.app, SECRET_MAIMEMO_TOKEN, legacyToken);
    if (legacyLlm.trim() || legacyToken.trim()) {
      new Notice('检测到旧版明文密钥，已迁移到 Obsidian 秘密存储并从 data.json 移除。');
    }
  }
}
