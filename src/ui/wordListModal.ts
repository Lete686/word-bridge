import { Modal, Notice, Setting } from 'obsidian';
import type { SyncState } from '../core/types';
import type { SyncOutcome } from '../core/sync';
import { statusLabel } from '../core/store';

export interface WordListHost {
  words(): Array<{ word: string; state: SyncState | undefined }>;
  targetLabel(): string;
  targetConfigured(): boolean;
  sync(words: string[]): Promise<SyncOutcome>;
  remove(words: string[]): Promise<void>;
  openSettings(): void;
}

export class WordListModal extends Modal {
  private query = '';
  private selected = new Set<string>();
  private listEl: HTMLDivElement | null = null;
  private summaryEl: HTMLDivElement | null = null;
  private selectAllEl: HTMLButtonElement | null = null;
  private deleteEl: HTMLButtonElement | null = null;
  private syncEl: HTMLButtonElement | null = null;
  private busy = false;
  private deleteArmed = false;
  private deleteTimer: number | null = null;

  constructor(
    app: import('obsidian').App,
    private readonly host: WordListHost,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('word-bridge-word-list');
    contentEl.createEl('h2', { text: '生词列表' });

    new Setting(contentEl)
      .setName('目标云词本')
      .setDesc(this.host.targetLabel())
      .addButton((button) =>
        button.setButtonText('设置').onClick(() => {
          this.close();
          this.host.openSettings();
        }),
      );

    const toolbar = contentEl.createDiv({ cls: 'wb-list-toolbar' });
    const search = toolbar.createEl('input', { cls: 'wb-list-search' });
    search.type = 'search';
    search.placeholder = '搜索生词…';
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this.renderList();
    });

    this.selectAllEl = toolbar.createEl('button', { text: '全选未核实' });
    this.selectAllEl.addEventListener('click', () => this.selectAllPending());
    this.deleteEl = toolbar.createEl('button', { text: '删除选中' });
    this.deleteEl.addEventListener('click', () => void this.deleteSelected());
    this.syncEl = toolbar.createEl('button', { text: '同步选中' });
    this.syncEl.addClass('mod-cta');
    this.syncEl.addEventListener('click', () => void this.syncSelected());

    this.listEl = contentEl.createDiv({ cls: 'wb-list' });
    this.summaryEl = contentEl.createDiv({ cls: 'wb-list-summary' });
    this.renderList();
  }

  onClose(): void {
    if (this.deleteTimer !== null) window.clearTimeout(this.deleteTimer);
    this.contentEl.empty();
  }

  private words() {
    return this.host.words();
  }

  private renderList(): void {
    if (!this.listEl) return;
    const all = this.words();
    const existing = new Set(all.map((item) => item.word));
    for (const word of [...this.selected]) {
      if (!existing.has(word)) this.selected.delete(word);
    }
    this.listEl.replaceChildren();
    const filtered = all.filter((item) => !this.query || item.word.toLowerCase().includes(this.query));
    if (!filtered.length) {
      this.listEl.createDiv({ cls: 'wb-list-empty', text: all.length ? '没有匹配的生词。' : '生词列表为空。选中单词后点击收藏即可加入。' });
    } else {
      for (const item of filtered) {
        const row = this.listEl.createDiv({ cls: 'wb-list-row' });
        const checkbox = row.createEl('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.selected.has(item.word);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) this.selected.add(item.word);
          else this.selected.delete(item.word);
          this.updateButtons();
        });
        const word = row.createDiv({ cls: 'wb-list-word' });
        word.textContent = item.word;
        const badge = row.createDiv({ cls: `wb-badge wb-badge-${item.state ?? 'none'}` });
        badge.textContent = statusLabel(item.state);
        const remove = row.createEl('button', { cls: 'wb-row-remove', text: '删除' });
        remove.addEventListener('click', async () => {
          await this.host.remove([item.word]);
          this.selected.delete(item.word);
          this.renderList();
          new Notice(`已从生词列表删除 ${item.word}（不会删除墨墨远程词条）。`);
        });
      }
    }
    this.updateButtons();
  }

  private selectAllPending(): void {
    const all = this.words();
    const filtered = all.filter((item) => !this.query || item.word.toLowerCase().includes(this.query));
    const pending = filtered.filter((item) => item.state !== 'verified');
    const allPendingSelected = pending.length > 0 && pending.every((item) => this.selected.has(item.word));
    if (allPendingSelected) {
      for (const item of pending) this.selected.delete(item.word);
    } else {
      for (const item of pending) this.selected.add(item.word);
    }
    this.renderList();
  }

  private updateButtons(): void {
    if (this.selectAllEl) {
      const filtered = this.words().filter((item) => !this.query || item.word.toLowerCase().includes(this.query));
      const pending = filtered.filter((item) => item.state !== 'verified');
      const allPendingSelected = pending.length > 0 && pending.every((item) => this.selected.has(item.word));
      this.selectAllEl.textContent = allPendingSelected ? '取消全选' : '全选未核实';
    }
    if (this.deleteEl) {
      this.deleteEl.textContent = this.deleteArmed ? `确认删除 ${this.selected.size} 个？` : '删除选中';
      this.deleteEl.disabled = this.busy || this.selected.size === 0;
    }
    if (this.syncEl) {
      this.syncEl.disabled = this.busy || this.selected.size === 0 || !this.host.targetConfigured();
      this.syncEl.textContent = this.busy ? '同步中…' : '同步选中';
    }
  }

  private async deleteSelected(): Promise<void> {
    if (!this.selected.size) return;
    if (!this.deleteArmed) {
      this.deleteArmed = true;
      this.updateButtons();
      this.deleteTimer = window.setTimeout(() => {
        this.deleteArmed = false;
        this.updateButtons();
      }, 3000);
      return;
    }
    this.deleteArmed = false;
    if (this.deleteTimer !== null) window.clearTimeout(this.deleteTimer);
    const words = [...this.selected];
    await this.host.remove(words);
    this.selected.clear();
    this.renderList();
    new Notice(`已删除 ${words.length} 个本地生词（不会删除墨墨远程词条）。`);
  }

  private async syncSelected(): Promise<void> {
    if (this.busy || !this.selected.size) return;
    if (!this.host.targetConfigured()) {
      new Notice('请先在插件设置里配置墨墨 Token 并选择目标云词本。');
      return;
    }
    this.busy = true;
    this.updateButtons();
    if (this.summaryEl) this.summaryEl.setText('正在读取云词本并同步…');
    try {
      const outcome = await this.host.sync([...this.selected]);
      this.showOutcome(outcome);
      this.renderList();
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败';
      if (this.summaryEl) {
        this.summaryEl.empty();
        this.summaryEl.createDiv({ cls: 'wb-summary-error', text: `同步失败：${message}` });
      }
      new Notice(`同步失败：${message}`);
    } finally {
      this.busy = false;
      this.updateButtons();
    }
  }

  private showOutcome(outcome: SyncOutcome): void {
    if (!this.summaryEl) return;
    this.summaryEl.empty();
    this.summaryEl.createDiv({
      cls: 'wb-summary-title',
      text: `同步完成：已核实 ${outcome.verifiedCount}，词形不同 ${outcome.normalizedCount}，失败 ${outcome.failedCount}，未知 ${outcome.unknownCount}。`,
    });
    this.summaryEl.createDiv({
      text: `本次追加 ${outcome.appended.length} 个，已存在跳过 ${outcome.skipped.length} 个；云词本“${outcome.notepad.title}”已读回核实。`,
    });
    for (const warning of outcome.warnings) {
      this.summaryEl.createDiv({ cls: 'wb-summary-warning', text: warning });
    }
    const notable = outcome.results.filter((result) => result.state !== 'verified');
    for (const result of notable.slice(0, 20)) {
      this.summaryEl.createDiv({ cls: 'wb-summary-detail', text: `${result.word}：${result.detail}` });
    }
    if (notable.length > 20) {
      this.summaryEl.createDiv({ text: `另有 ${notable.length - 20} 条非“已核实”结果未逐条显示。` });
    }
    this.summaryEl.createDiv({
      cls: 'wb-summary-note',
      text: '云词本同步只代表远程词本状态，不代表已加入学习计划，也不代表已经开始复习。',
    });
  }
}
