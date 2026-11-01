import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type WordBridgePlugin from '../main';
import { describeLlmError, resolveChatEndpoint } from '../core/llm';
import { sanitizeChapterTitle } from '../core/maimemo';
import { SECRET_LLM_KEY, SECRET_MAIMEMO_TOKEN } from '../core/store';
import { hasSecret, secretStorageAvailable, setSecret } from '../services/secrets';
import type { BriefNotepad } from '../core/types';

export class WordBridgeSettingTab extends PluginSettingTab {
  private notepads: BriefNotepad[] = [];
  private loadingNotepads = false;

  constructor(
    app: App,
    private readonly plugin: WordBridgePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('word-bridge-settings');

    containerEl.createEl('h2', { text: 'Word Bridge 设置' });
    containerEl.createEl('p', {
      cls: 'wb-settings-intro',
      text: '选中文本只显示小图标；只有点击图标后才会查词或翻译。凭证保存在 Obsidian 秘密存储，不写入插件 data.json。',
    });

    this.dictionarySection(containerEl);
    this.llmSection(containerEl);
    this.maimemoSection(containerEl);
    this.dataSection(containerEl);
  }

  private dictionarySection(parent: HTMLElement): void {
    new Setting(parent).setName('内置词典').setHeading();
    const info = this.plugin.dictionaryInfo();
    const desc = info.loaded
      ? `${info.meta?.name ?? '词典'}：${info.size.toLocaleString()} 条；许可证 ${info.meta?.license ?? '未知'}。`
      : '词典尚未加载（首次查词时自动加载）。';
    new Setting(parent)
      .setName('词典状态')
      .setDesc(desc)
      .addButton((button) =>
        button.setButtonText('重新加载').onClick(async () => {
          try {
            await this.plugin.reloadDictionary();
            new Notice('词典已重新加载。');
            this.display();
          } catch (error) {
            new Notice(`词典加载失败：${error instanceof Error ? error.message : '未知错误'}`);
          }
        }),
      );
    if (info.meta) {
      new Setting(parent)
        .setName('来源与许可')
        .setDesc(`${info.meta.source}（${info.meta.license}）`);
    }
  }

  private llmSection(parent: HTMLElement): void {
    new Setting(parent).setName('句子翻译（OpenAI 兼容接口）').setHeading();
    const llm = this.plugin.pluginSettings.llm;

    new Setting(parent)
      .setName('服务地址')
      .setDesc('例如 https://api.example.com/v1 或完整 .../v1/chat/completions。留空则翻译不可用。')
      .addText((text) =>
        text
          .setPlaceholder('https://api.example.com/v1')
          .setValue(llm.baseUrl)
          .onChange(async (value) => {
            llm.baseUrl = value.trim();
            await this.plugin.saveSettings();
            this.updateEndpointPreview();
          }),
      );

    const preview = new Setting(parent)
      .setName('实际请求地址')
      .setDesc(resolveChatEndpoint(llm.baseUrl) || '尚未填写服务地址')
      .setClass('wb-endpoint-preview');
    preview.settingEl.setAttribute('data-wb-endpoint', '');

    new Setting(parent)
      .setName('模型')
      .setDesc('填写服务商要求的模型名称，例如 gpt-4o-mini。')
      .addText((text) => text.setPlaceholder('model-name').setValue(llm.model).onChange(async (value) => {
        llm.model = value.trim();
        await this.plugin.saveSettings();
      }));

    const keySetting = new Setting(parent).setName('API Key');
    let keyInput: import('obsidian').TextComponent | null = null;
    keySetting.addText((text) => {
      keyInput = text;
      text.inputEl.type = 'password';
      text.inputEl.autocomplete = 'off';
      text.inputEl.spellcheck = false;
      text.setPlaceholder(hasSecret(this.app, SECRET_LLM_KEY) ? '已配置；输入新值可替换' : '粘贴 API Key 后点击保存');
    });
    keySetting.addButton((button) =>
      button.setButtonText('保存').onClick(() => {
        const value = keyInput?.inputEl.value ?? '';
        if (!value.trim()) {
          new Notice('输入为空，未修改。');
          return;
        }
        setSecret(this.app, SECRET_LLM_KEY, value);
        if (keyInput) keyInput.inputEl.value = '';
        new Notice('API Key 已保存到 Obsidian 秘密存储。');
        this.display();
      }),
    );
    keySetting.addButton((button) =>
      button.setButtonText('清除').setWarning().onClick(() => {
        setSecret(this.app, SECRET_LLM_KEY, '');
        new Notice('已清除 API Key。');
        this.display();
      }),
    );
    keySetting.setDesc(hasSecret(this.app, SECRET_LLM_KEY) ? '状态：已配置（值不在界面显示）' : '状态：未配置');

    new Setting(parent)
      .setName('超时（毫秒）')
      .setDesc('3,000 – 120,000。超时会丢弃等待，不把旧结果写回界面。')
      .addText((text) =>
        text.setValue(String(llm.timeoutMs)).onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) return;
          llm.timeoutMs = Math.min(120_000, Math.max(3_000, Math.round(parsed)));
          await this.plugin.saveSettings();
        }),
      );

    new Setting(parent)
      .setName('测试翻译')
      .setDesc('会向配置的服务发送一段测试文本 “Hello”，用于验证地址、模型与密钥。')
      .addButton((button) =>
        button.setButtonText('测试').onClick(async () => {
          button.setDisabled(true);
          try {
            const result = await this.plugin.testLlm();
            new Notice(`翻译测试成功：${result.slice(0, 60)}`);
          } catch (error) {
            new Notice(`翻译测试失败：${describeLlmError(error)}`);
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    if (!secretStorageAvailable(this.app)) {
      new Setting(parent)
        .setName('秘密存储不可用')
        .setDesc('当前 Obsidian 未暴露 SecretStorage，密钥只会保存在本次会话内存中，不会明文写入 data.json。');
    }
  }

  private maimemoSection(parent: HTMLElement): void {
    new Setting(parent).setName('墨墨背单词云词本同步').setHeading();
    const mm = this.plugin.pluginSettings.maimemo;

    const tokenSetting = new Setting(parent).setName('访问 Token');
    let tokenInput: import('obsidian').TextComponent | null = null;
    tokenSetting.addText((text) => {
      tokenInput = text;
      text.inputEl.type = 'password';
      text.inputEl.autocomplete = 'off';
      text.inputEl.spellcheck = false;
      text.setPlaceholder(hasSecret(this.app, SECRET_MAIMEMO_TOKEN) ? '已配置；输入新值可替换' : '粘贴墨墨开放 API Token');
    });
    tokenSetting.addButton((button) =>
      button.setButtonText('保存').onClick(() => {
        const value = tokenInput?.inputEl.value ?? '';
        if (!value.trim()) {
          new Notice('输入为空，未修改。');
          return;
        }
        setSecret(this.app, SECRET_MAIMEMO_TOKEN, value);
        if (tokenInput) tokenInput.inputEl.value = '';
        new Notice('Token 已保存到 Obsidian 秘密存储。');
        this.display();
      }),
    );
    tokenSetting.addButton((button) =>
      button.setButtonText('清除').setWarning().onClick(() => {
        setSecret(this.app, SECRET_MAIMEMO_TOKEN, '');
        new Notice('已清除 Token。');
        this.display();
      }),
    );
    tokenSetting.setDesc(hasSecret(this.app, SECRET_MAIMEMO_TOKEN) ? '状态：已配置（值不在界面显示）' : '状态：未配置');

    new Setting(parent)
      .setName('连接测试（只读）')
      .setDesc('只读取云词本列表，不写入、不修改、不创建学习计划。')
      .addButton((button) =>
        button.setButtonText('读取词本列表').onClick(async () => {
          if (!hasSecret(this.app, SECRET_MAIMEMO_TOKEN)) {
            new Notice('请先保存 Token。');
            return;
          }
          button.setDisabled(true);
          try {
            await this.refreshNotepads();
            new Notice(`连接成功，读取到 ${this.notepads.length} 个云词本。`);
            this.display();
          } catch (error) {
            new Notice(`连接失败：${error instanceof Error ? error.message : '未知错误'}`);
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    const dropdownSetting = new Setting(parent).setName('目标云词本').setDesc(this.targetDescription());
    dropdownSetting.addDropdown((dropdown) => {
      dropdown.addOption('', '（未选择）');
      const seen = new Set(this.notepads.map((item) => item.id));
      for (const notepad of this.notepads) {
        dropdown.addOption(notepad.id, `${notepad.title}${notepad.status === 'PUBLISHED' ? '' : `（${notepad.status}）`}`);
      }
      if (mm.notepadId && !seen.has(mm.notepadId)) {
        dropdown.addOption(mm.notepadId, `${mm.notepadTitle || mm.notepadId}（未在本次列表）`);
      }
      dropdown.setValue(mm.notepadId);
      dropdown.onChange(async (value) => {
        const found = this.notepads.find((item) => item.id === value);
        mm.notepadId = value;
        mm.notepadTitle = found?.title ?? (value ? mm.notepadTitle : '');
        mm.notepadCreator = found?.creator ?? (value ? mm.notepadCreator : null);
        await this.plugin.saveSettings();
        new Notice(value ? '目标云词本已更新；旧目标的同步状态不会沿用到新目标。' : '已取消目标云词本。');
        this.display();
      });
    });
    dropdownSetting.addButton((button) =>
      button.setButtonText(this.loadingNotepads ? '读取中…' : '刷新列表').onClick(async () => {
        if (!hasSecret(this.app, SECRET_MAIMEMO_TOKEN)) {
          new Notice('请先保存 Token。');
          return;
        }
        this.loadingNotepads = true;
        button.setDisabled(true);
        try {
          await this.refreshNotepads();
          new Notice(`读取到 ${this.notepads.length} 个云词本。`);
        } catch (error) {
          new Notice(`读取失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
          this.loadingNotepads = false;
          this.display();
        }
      }),
    );

    new Setting(parent)
      .setName('专用章节名')
      .setDesc('目标云词本是章节模式时，新词写入该章节；不存在则在末尾新建。不会重排或清空原有章节。')
      .addText((text) =>
        text
          .setValue(mm.chapterTitle)
          .setPlaceholder('Word Bridge')
          .onChange(async (value) => {
            mm.chapterTitle = sanitizeChapterTitle(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(parent)
      .setName('API 地址（高级）')
      .setDesc('留空使用官方 https://open.maimemo.com/open/api/v1。仅用于本地 mock 测试，正式使用请留空。')
      .addText((text) =>
        text
          .setValue(mm.apiBase)
          .setPlaceholder('https://open.maimemo.com/open/api/v1')
          .onChange(async (value) => {
            mm.apiBase = value.trim().replace(/\/+$/, '');
            await this.plugin.saveSettings();
          }),
      );

    parent.createEl('p', {
      cls: 'wb-settings-note',
      text: '同步只代表云词本内容已读回核实，不代表加入学习计划、已学习或已开始复习。墨墨开放 API 的云词本更新是全量内容替换，本插件在写前重读并合并，但跨客户端并发仍无法获得原子性保证。',
    });
  }

  private dataSection(parent: HTMLElement): void {
    new Setting(parent).setName('数据与隐私').setHeading();
    new Setting(parent)
      .setName('本地生词')
      .setDesc(`当前 ${this.plugin.wordCount()} 个。只保存英文拼写和必要的同步状态；不保存释义、原句、来源路径或笔记链接。`)
      .addButton((button) => button.setButtonText('打开生词列表').onClick(() => this.plugin.openWordList()))
      .addButton((button) =>
        button.setButtonText('清空生词').setWarning().onClick(async () => {
          if (this.plugin.wordCount() === 0) {
            new Notice('生词列表已为空。');
            return;
          }
          if (!window.confirm('清空本地生词列表？不会删除墨墨远程词条。此操作不可撤销。')) return;
          await this.plugin.clearWords();
          new Notice('已清空本地生词列表。');
          this.display();
        }),
      );
    parent.createEl('p', {
      cls: 'wb-settings-note',
      text: '选区文本、上下文、查词/翻译响应只在内存中处理，不写入日志或报告。凭证只保存在 Obsidian 秘密存储。',
    });
  }

  private updateEndpointPreview(): void {
    const node = this.containerEl.querySelector('[data-wb-endpoint] .setting-item-description');
    if (node) {
      node.textContent = resolveChatEndpoint(this.plugin.pluginSettings.llm.baseUrl) || '尚未填写服务地址';
    }
  }

  private targetDescription(): string {
    const mm = this.plugin.pluginSettings.maimemo;
    if (!mm.notepadId) return '尚未选择。请先读取词本列表。';
    const state = this.plugin.targetStatusSummary();
    return `${mm.notepadTitle || mm.notepadId}（ID ${mm.notepadId}）${state ? `；${state}` : ''}`;
  }

  private async refreshNotepads(): Promise<void> {
    this.notepads = await this.plugin.listNotepads();
    const mm = this.plugin.pluginSettings.maimemo;
    const found = this.notepads.find((item) => item.id === mm.notepadId);
    if (found) {
      mm.notepadTitle = found.title;
      mm.notepadCreator = found.creator;
      await this.plugin.saveSettings();
    }
  }
}
