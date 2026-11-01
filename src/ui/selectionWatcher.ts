import { normalizeText } from '../core/text';

export interface SelectionSnapshot {
  text: string;
  rect: DOMRect;
}

const ICON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v16.5H5.5A1.5 1.5 0 0 0 4 21V4.5Zm2 .5v13.2c.3-.1.6-.2 1-.2H17V5H6Zm2 2h6v1.5H8V7Zm0 3h6v1.5H8V10Z"/>' +
  '</svg>';

const EXCLUDED_SELECTOR = [
  'pre',
  'code',
  '.cm-inline-code',
  '.HyperMD-codeblock',
  '.math',
  '.cm-math',
  '.cm-embed-block',
  '.internal-embed',
  '.markdown-embed',
  '.frontmatter',
  '.metadata-container',
  'input',
  'textarea',
  'select',
  '.word-bridge-popup',
  '.word-bridge-icon',
  '.modal-container',
  '.menu',
  '.suggestion-container',
].join(',');

const EDITOR_SELECTOR = '.markdown-source-view, .markdown-preview-view, .markdown-reading-view';

/**
 * 单一全局监听器：选中文本后只显示小图标，绝不主动请求。
 * 图标独立于编辑器 DOM，mousedown 阻止默认行为以保住选区。
 */
export class SelectionWatcher {
  private icon: HTMLButtonElement | null = null;
  private snapshot: SelectionSnapshot | null = null;
  private timer: number | null = null;
  private destroyed = false;

  private readonly onSelectionChange = () => this.schedule();
  private readonly onMouseUp = () => this.schedule();
  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.hide();
      return;
    }
    this.schedule();
  };
  private readonly onDocMouseDown = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (this.icon && target && this.icon.contains(target)) return;
    this.hide();
  };
  private readonly onScroll = () => this.refreshPosition();
  private readonly onResize = () => this.refreshPosition();

  constructor(private readonly onActivate: (snapshot: SelectionSnapshot) => void) {}

  start(): void {
    document.addEventListener('selectionchange', this.onSelectionChange, true);
    document.addEventListener('mouseup', this.onMouseUp, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('mousedown', this.onDocMouseDown, true);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onResize);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    document.removeEventListener('selectionchange', this.onSelectionChange, true);
    document.removeEventListener('mouseup', this.onMouseUp, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onResize);
    this.icon?.remove();
    this.icon = null;
    this.snapshot = null;
  }

  private schedule(): void {
    if (this.destroyed) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.evaluate();
    }, 90);
  }

  private evaluate(): void {
    if (this.destroyed) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      this.hide();
      return;
    }
    const text = normalizeText(selection.toString());
    if (!text || text.length > 4000) {
      this.hide();
      return;
    }
    const anchorEl = nodeElement(selection.anchorNode);
    const focusEl = nodeElement(selection.focusNode);
    if (!anchorEl || !focusEl) {
      this.hide();
      return;
    }
    if (anchorEl.closest('.word-bridge-popup') || focusEl.closest('.word-bridge-popup')) return;
    if (!anchorEl.closest(EDITOR_SELECTOR) || !focusEl.closest(EDITOR_SELECTOR)) {
      this.hide();
      return;
    }
    if (anchorEl.closest(EXCLUDED_SELECTOR) || focusEl.closest(EXCLUDED_SELECTOR)) {
      this.hide();
      return;
    }
    const range = selection.getRangeAt(selection.rangeCount - 1);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      this.hide();
      return;
    }
    this.snapshot = { text, rect };
    this.showIcon(rect);
  }

  private showIcon(rect: DOMRect): void {
    if (!this.icon) {
      const icon = document.createElement('button');
      icon.className = 'word-bridge-icon';
      icon.type = 'button';
      icon.setAttribute('aria-label', '查词 / 翻译');
      icon.title = '查词 / 翻译（仅点击后才请求）';
      icon.innerHTML = ICON_SVG;
      icon.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      icon.addEventListener('mouseup', (event) => event.stopPropagation());
      icon.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const snapshot = this.snapshot;
        if (!snapshot) return;
        this.hide();
        this.onActivate(snapshot);
      });
      document.body.appendChild(icon);
      this.icon = icon;
    }
    const size = 26;
    let left = rect.right + 6;
    if (left + size > window.innerWidth - 4) left = rect.left - size - 6;
    if (left < 4) left = 4;
    let top = rect.top - size - 4;
    if (top < 4) top = rect.bottom + 6;
    if (top + size > window.innerHeight - 4) top = window.innerHeight - size - 4;
    this.icon.style.left = `${Math.round(left)}px`;
    this.icon.style.top = `${Math.round(top)}px`;
    this.icon.style.display = 'flex';
  }

  hide(): void {
    if (this.icon) this.icon.style.display = 'none';
    this.snapshot = null;
  }

  /** 滚动/缩放时用当前 DOM 选区重新定位，避免选区自动滚动导致图标瞬间消失 */
  private refreshPosition(): void {
    if (this.destroyed || !this.icon || this.icon.style.display === 'none' || !this.snapshot) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      this.hide();
      return;
    }
    const text = normalizeText(selection.toString());
    if (text !== this.snapshot.text) {
      this.hide();
      return;
    }
    const range = selection.getRangeAt(selection.rangeCount - 1);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height) || rect.bottom < 0 || rect.top > window.innerHeight) {
      this.hide();
      return;
    }
    this.snapshot = { text, rect };
    this.showIcon(rect);
  }
}

function nodeElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}
