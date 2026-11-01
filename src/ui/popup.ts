import type { LookupResult } from '../core/types';

export type FavoriteResult = 'added' | 'exists' | 'invalid';

export interface PopupCallbacks {
  onFavorite: (word: string) => Promise<FavoriteResult>;
  /** 返回实际使用的英文语音名称；不可用时抛出可直接展示的中文错误 */
  onSpeak: (word: string) => Promise<string>;
  onCopy: (text: string) => Promise<boolean>;
  onClosed: () => void;
}

/**
 * 选区旁的浮动结果窗。只用 textContent 写入动态内容，避免把选区/释义当 HTML。
 * 关闭时清空内容，不在 DOM 里留下查词文本。
 */
export class Popup {
  private root: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private titleEl: HTMLSpanElement | null = null;
  private anchor: DOMRect | null = null;
  private destroyed = false;
  private readonly onDocMouseDown = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (this.root && target && this.root.contains(target)) return;
    if (this.isOpen()) this.close();
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      this.close();
    }
  };
  private readonly onResize = () => {
    if (this.anchor) this.place(this.anchor);
  };
  private readonly onScroll = (event: Event) => {
    const target = event.target as Node | null;
    if (this.root && target && this.root.contains(target)) return;
    if (this.isOpen()) this.close();
  };

  constructor(private readonly callbacks: PopupCallbacks) {}

  isOpen(): boolean {
    return Boolean(this.root && this.root.style.display !== 'none');
  }

  show(anchor: DOMRect, title: string): void {
    if (this.destroyed) return;
    this.ensure();
    this.anchor = anchor;
    if (this.root) this.root.style.display = 'block';
    if (this.titleEl) this.titleEl.textContent = title;
    if (this.body) {
      this.body.replaceChildren();
      this.body.appendChild(loadingNode('正在请求…'));
    }
    this.place(anchor);
  }

  setLoading(label: string): void {
    if (!this.body) return;
    this.body.replaceChildren(loadingNode(label));
    if (this.anchor) this.place(this.anchor);
  }

  setTitle(title: string): void {
    if (this.titleEl) this.titleEl.textContent = title;
  }

  renderWord(result: LookupResult): void {
    if (!this.body) return;
    const callbacks = this.callbacks;
    const body = this.body;
    body.replaceChildren();

    const head = el('div', 'wb-word-head');
    const wordEl = el('div', 'wb-word');
    wordEl.textContent = result.word;
    head.appendChild(wordEl);
    body.appendChild(head);

    const phoneticRow = el('div', 'wb-phonetic-row');
    if (result.entry.phonetic) {
      const phonetic = el('span', 'wb-phonetic');
      phonetic.textContent = result.entry.phonetic;
      phoneticRow.appendChild(phonetic);
    } else {
      const missing = el('span', 'wb-phonetic wb-phonetic-missing');
      missing.textContent = '该词条没有音标信息。';
      phoneticRow.appendChild(missing);
    }
    const speak = el('button', 'wb-icon-button') as HTMLButtonElement;
    speak.type = 'button';
    speak.textContent = '发音';
    speak.title = '使用系统英文语音（TTS）朗读';
    speak.addEventListener('click', async () => {
      setFooter(body, '正在使用系统英文语音（TTS）播放…');
      try {
        const voiceName = await callbacks.onSpeak(result.word);
        setFooter(body, `播放完成（英文语音：${voiceName}）。`);
      } catch (error) {
        setFooter(body, error instanceof Error ? error.message : '当前环境不支持发音，或播放失败。');
      }
    });
    phoneticRow.appendChild(speak);
    body.appendChild(phoneticRow);

    if (result.variantNote) {
      body.appendChild(noteNode(result.variantNote));
    }

    const definitions = result.entry.definition.split('\n').filter((line) => line.trim());
    if (definitions.length) {
      const list = el('div', 'wb-definitions');
      for (const line of definitions) {
        const item = el('div', 'wb-definition');
        item.textContent = line;
        list.appendChild(item);
      }
      body.appendChild(list);
    } else {
      body.appendChild(noteNode('词典条目没有可用释义。'));
    }

    const lemma = result.entry.lemma;
    const hasLemma = Boolean(lemma && lemma.toLowerCase() !== result.word.toLowerCase());
    if (hasLemma && lemma) {
      body.appendChild(
        noteNode(`词典提供可信原形：${lemma}${result.entry.relation ? `（${result.entry.relation}）` : ''}。请选择要收藏的词形。`),
      );
    } else {
      body.appendChild(noteNode('词典未提供可信原形；仅可收藏原词，不会用截后缀方式猜测原形。'));
    }

    const actions = el('div', 'wb-actions');
    const status = el('span', 'wb-favorite-status');
    const original = actionButton(`收藏 ${result.word}`);
    original.addEventListener('click', async () => {
      original.disabled = true;
      const outcome = await callbacks.onFavorite(result.word);
      original.disabled = false;
      status.textContent =
        outcome === 'added' ? '已加入生词列表。' : outcome === 'exists' ? '该词已在生词列表中。' : '该拼写不是可收藏的英文单词。';
    });
    actions.appendChild(original);
    if (hasLemma && lemma) {
      const base = actionButton(`收藏原形 ${lemma}`);
      base.addEventListener('click', async () => {
        base.disabled = true;
        const outcome = await callbacks.onFavorite(lemma);
        base.disabled = false;
        status.textContent =
          outcome === 'added' ? '已加入生词列表。' : outcome === 'exists' ? '该词已在生词列表中。' : '该拼写不是可收藏的英文单词。';
      });
      actions.appendChild(base);
    }
    body.appendChild(actions);
    body.appendChild(status);
    if (this.anchor) this.place(this.anchor);
  }

  renderNotFound(word: string): void {
    if (!this.body) return;
    const body = this.body;
    body.replaceChildren();
    const title = el('div', 'wb-state-title');
    title.textContent = '词典未收录该词';
    body.appendChild(title);
    body.appendChild(noteNode(`“${word}” 不在内置词典中。未收录不等于查词失败，也不会改用大模型伪造释义。`));
    const actions = el('div', 'wb-actions');
    const status = el('span', 'wb-favorite-status');
    const fav = actionButton(`仍收藏 ${word}`);
    fav.addEventListener('click', async () => {
      fav.disabled = true;
      const outcome = await this.callbacks.onFavorite(word);
      fav.disabled = false;
      status.textContent =
        outcome === 'added' ? '已加入生词列表。' : outcome === 'exists' ? '该词已在生词列表中。' : '该拼写不是可收藏的英文单词。';
    });
    actions.appendChild(fav);
    body.appendChild(actions);
    body.appendChild(status);
    if (this.anchor) this.place(this.anchor);
  }

  renderTranslation(translation: string): void {
    if (!this.body) return;
    const body = this.body;
    body.replaceChildren();
    const label = el('div', 'wb-state-title');
    label.textContent = '译文';
    body.appendChild(label);
    const result = el('div', 'wb-translation');
    result.textContent = translation;
    body.appendChild(result);
    const actions = el('div', 'wb-actions');
    const copy = actionButton('复制译文');
    copy.addEventListener('click', async () => {
      const ok = await this.callbacks.onCopy(translation);
      copy.textContent = ok ? '已复制' : '复制失败';
      window.setTimeout(() => {
        copy.textContent = '复制译文';
      }, 1500);
    });
    actions.appendChild(copy);
    body.appendChild(actions);
    body.appendChild(noteNode('仅发送所选文本；结果只供查看和复制，不会写入笔记。'));
    if (this.anchor) this.place(this.anchor);
  }

  renderError(title: string, detail: string, onRetry?: () => void): void {
    if (!this.body) return;
    const body = this.body;
    body.replaceChildren();
    const titleEl = el('div', 'wb-state-title wb-error');
    titleEl.textContent = title;
    body.appendChild(titleEl);
    body.appendChild(noteNode(detail));
    if (onRetry) {
      const actions = el('div', 'wb-actions');
      const retry = actionButton('重试');
      retry.addEventListener('click', () => onRetry());
      actions.appendChild(retry);
      body.appendChild(actions);
    }
    if (this.anchor) this.place(this.anchor);
  }

  close(): void {
    if (!this.root) return;
    this.root.style.display = 'none';
    this.body?.replaceChildren();
    this.anchor = null;
    this.callbacks.onClosed();
  }

  destroy(): void {
    this.destroyed = true;
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('scroll', this.onScroll, true);
    this.root?.remove();
    this.root = null;
    this.body = null;
    this.titleEl = null;
  }

  private ensure(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.className = 'word-bridge-popup';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '查词与翻译结果');
    root.style.display = 'none';
    root.setAttribute('data-word-bridge', 'popup');

    const header = document.createElement('div');
    header.className = 'wb-header';
    const title = document.createElement('span');
    title.className = 'wb-header-title';
    header.appendChild(title);
    const close = document.createElement('button');
    close.className = 'wb-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => this.close());
    header.appendChild(close);
    root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'wb-body';
    root.appendChild(body);

    document.body.appendChild(root);
    this.root = root;
    this.body = body;
    this.titleEl = title;

    document.addEventListener('mousedown', this.onDocMouseDown, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('scroll', this.onScroll, true);
  }

  private place(anchor: DOMRect): void {
    if (!this.root) return;
    const margin = 8;
    const width = this.root.offsetWidth || 340;
    const height = this.root.offsetHeight || 160;
    let left = Math.min(Math.max(anchor.left, margin), window.innerWidth - width - margin);
    if (!Number.isFinite(left)) left = margin;
    let top = anchor.bottom + 8;
    if (top + height > window.innerHeight - margin) top = anchor.top - height - 8;
    if (top < margin) top = margin;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - height - margin);
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function actionButton(label: string): HTMLButtonElement {
  const button = el('button', 'wb-action');
  button.type = 'button';
  button.textContent = label;
  return button;
}

function noteNode(text: string): HTMLDivElement {
  const node = el('div', 'wb-note');
  node.textContent = text;
  return node;
}

function loadingNode(label: string): HTMLDivElement {
  const node = el('div', 'wb-loading');
  node.textContent = label;
  return node;
}

function setFooter(body: HTMLElement, text: string): void {
  const existing = body.querySelector('.wb-footer-status');
  if (existing) {
    existing.textContent = text;
    return;
  }
  const footer = el('div', 'wb-footer-status');
  footer.textContent = text;
  body.appendChild(footer);
}
