// Реестр терминалов xterm.js: по одному экземпляру на SSH-сессию, живёт независимо от переключения вкладок.
import { Terminal, type IDecoration, type ITheme } from '@xterm/xterm';
import { HIGHLIGHT_COLORS, highlightRanges } from '../../shared/termHighlight';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import type { Settings } from '../../shared/types';

export interface TermHandlers {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onCopy: (text: string) => void;
  onPasteRequest: () => void;
  onSearch: () => void;
  passCtrlK: () => boolean;
  copyOnSelect: () => boolean;
  isMac: boolean;
}

interface TermEntry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  opened: boolean;
  hl: Highlighter;
}

/**
 * Подсветка ключевых слов декорациями xterm.js: сам вывод не меняется (копирование, поиск и журнал
 * получают исходный текст), строки сканируются после отрисовки. Полноэкранные программы (top, nano,
 * mc) не подсвечиваются.
 */
class Highlighter {
  enabled = true;
  theme: 'dark' | 'light' = 'dark';
  private scanned = 0;
  private decos = new Map<number, IDecoration[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private term: Terminal) {
    term.onWriteParsed(() => this.schedule());
  }

  schedule(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, 60);
  }

  private scan(): void {
    const b = this.term.buffer.active;
    if (b.type === 'alternate') return;
    const cursorAbs = b.baseY + b.cursorY;
    if (this.scanned > cursorAbs + 1) this.scanned = Math.max(0, cursorAbs - this.term.rows);
    const start = Math.max(this.scanned, cursorAbs - 3000);
    const colors = HIGHLIGHT_COLORS[this.theme];
    for (let y = start; y <= cursorAbs; y++) {
      this.clearLine(y);
      const line = b.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      const ranges = highlightRanges(text);
      if (!ranges.length) continue;
      const marker = this.term.registerMarker(y - cursorAbs);
      if (!marker) continue;
      const list: IDecoration[] = [];
      for (const r of ranges) {
        const d = this.term.registerDecoration({ marker, x: r.start, width: r.len, foregroundColor: colors[r.kind], layer: 'top' });
        if (d) list.push(d);
      }
      this.decos.set(y, list);
      marker.onDispose(() => this.decos.delete(y));
    }
    // Строка с курсором ещё может дописываться — её проверим снова в следующий раз.
    this.scanned = cursorAbs;
  }

  private clearLine(y: number): void {
    const list = this.decos.get(y);
    if (!list) return;
    for (const d of list) d.dispose();
    this.decos.delete(y);
  }

  reset(): void {
    for (const y of [...this.decos.keys()]) this.clearLine(y);
    const b = this.term.buffer.active;
    this.scanned = Math.max(0, b.baseY + b.cursorY - this.term.rows * 3);
  }

  configure(enabled: boolean, theme: 'dark' | 'light'): void {
    const changed = enabled !== this.enabled || theme !== this.theme;
    this.enabled = enabled;
    this.theme = theme;
    if (!changed) return;
    this.reset();
    if (enabled) this.schedule();
  }
}

const terms = new Map<string, TermEntry>();
const pending = new Map<string, string>();

const DARK: ITheme = {
  background: '#0a0e13',
  foreground: '#d6dde6',
  cursor: '#4f8cff',
  cursorAccent: '#0a0e13',
  selectionBackground: '#2b4a7a',
  black: '#1b2028',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d6a32e',
  blue: '#4f8cff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#c9d1d9',
  brightBlack: '#6e7681',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79a6ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
};

const LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#2563eb',
  cursorAccent: '#ffffff',
  selectionBackground: '#b6d3ff',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#7d4e00',
  blue: '#0550ae',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f'
};

const DEFAULT_MONO = "'JetBrains Mono', 'Cascadia Mono', Consolas, 'SF Mono', Menlo, 'DejaVu Sans Mono', 'Liberation Mono', monospace";

export function createTerminal(id: string, settings: Settings, h: TermHandlers): TermEntry {
  const existing = terms.get(id);
  if (existing) return existing;
  const term = new Terminal({
    fontFamily: settings.monoFont || DEFAULT_MONO,
    fontSize: settings.terminalFontSize,
    scrollback: settings.terminalScrollback,
    cursorBlink: settings.terminalCursorBlink,
    allowProposedApi: true,
    convertEol: false,
    macOptionIsMeta: true,
    rightClickSelectsWord: false,
    theme: settings.theme === 'light' ? LIGHT : DARK
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.onData((d) => h.onInput(d));
  term.onResize(({ cols, rows }) => h.onResize(cols, rows));
  term.onSelectionChange(() => {
    if (h.copyOnSelect() && term.hasSelection()) h.onCopy(term.getSelection());
  });
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const mod = h.isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    // Ctrl+K — быстрый поиск приложения (если не передаётся в терминал)
    if (mod && !e.shiftKey && (key === 'k' || e.code === 'KeyK') && !h.passCtrlK()) return false;
    if (mod && e.shiftKey && (key === 'k' || e.code === 'KeyK')) return false;
    if (!h.isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
      if (term.hasSelection()) h.onCopy(term.getSelection());
      e.preventDefault();
      return false;
    }
    if (!h.isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
      h.onPasteRequest();
      e.preventDefault();
      return false;
    }
    if (h.isMac && e.metaKey && e.code === 'KeyV') {
      h.onPasteRequest();
      e.preventDefault();
      return false;
    }
    if (mod && e.shiftKey && e.code === 'KeyF') {
      h.onSearch();
      return false;
    }
    // Горячие клавиши приложения не передаём в терминал
    if (mod && e.shiftKey && (e.code === 'KeyW' || e.code === 'KeyT')) return false;
    if (e.ctrlKey && e.code === 'Tab') return false;
    if (e.altKey && /^Digit[1-9]$/.test(e.code)) return false;
    if (mod && (e.code === 'KeyB' || e.code === 'Backslash' || e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0') && !e.shiftKey && !e.altKey && h.isMac) return false;
    return true;
  });
  const host = document.createElement('div');
  host.style.width = '100%';
  host.style.height = '100%';
  const hl = new Highlighter(term);
  hl.configure(settings.terminalHighlight ?? true, settings.theme === 'light' ? 'light' : 'dark');
  const entry: TermEntry = { term, fit, search, host, opened: false, hl };
  terms.set(id, entry);
  const buffered = pending.get(id);
  if (buffered) {
    pending.delete(id);
    term.write(buffered);
  }
  return entry;
}

export function attachTerminal(id: string, container: HTMLElement): void {
  const e = terms.get(id);
  if (!e) return;
  if (e.host.parentElement !== container) container.appendChild(e.host);
  if (!e.opened) {
    e.term.open(e.host);
    e.opened = true;
  }
  fitTerminal(id);
}

export function fitTerminal(id: string): { cols: number; rows: number } | null {
  const e = terms.get(id);
  if (!e || !e.opened || !e.host.isConnected || e.host.clientWidth < 20) return null;
  try {
    e.fit.fit();
  } catch {
    return null;
  }
  return { cols: e.term.cols, rows: e.term.rows };
}

export function writeTerminal(id: string, data: string): void {
  const e = terms.get(id);
  if (e) e.term.write(data);
  else pending.set(id, (pending.get(id) ?? '') + data);
}

export function writeInfo(id: string, text: string): void {
  writeTerminal(id, `\r\n\x1b[90m${text.replace(/\r?\n/g, '\r\n')}\x1b[0m\r\n`);
}

export function focusTerminal(id: string): void {
  terms.get(id)?.term.focus();
}

export function clearTerminal(id: string): void {
  const e = terms.get(id);
  if (!e) return;
  e.term.clear();
  e.hl.reset();
}

export function terminalSelection(id: string): string {
  return terms.get(id)?.term.getSelection() ?? '';
}

export function searchTerminal(id: string, query: string, dir: 'next' | 'prev'): boolean {
  const e = terms.get(id);
  if (!e || !query) return false;
  const opts = { caseSensitive: false, decorations: { matchOverviewRuler: '#d6a32e', activeMatchColorOverviewRuler: '#4f8cff', matchBackground: '#5a4a10', activeMatchBackground: '#2b4a7a' } };
  return dir === 'next' ? e.search.findNext(query, opts) : e.search.findPrevious(query, opts);
}

export function clearSearch(id: string): void {
  terms.get(id)?.search.clearDecorations();
}

export function pasteToTerminal(id: string, text: string): void {
  terms.get(id)?.term.paste(text);
}

export function disposeTerminal(id: string): void {
  const e = terms.get(id);
  if (!e) return;
  e.term.dispose();
  e.host.remove();
  terms.delete(id);
  pending.delete(id);
}

export function terminalSize(id: string): { cols: number; rows: number } {
  const e = terms.get(id);
  return e ? { cols: e.term.cols, rows: e.term.rows } : { cols: 120, rows: 32 };
}

/** Переименование временного идентификатора (до подключения) в идентификатор сессии. */
export function renameTerminal(from: string, to: string): void {
  const e = terms.get(from);
  if (!e) return;
  terms.delete(from);
  terms.set(to, e);
  const buffered = pending.get(to);
  if (buffered) {
    pending.delete(to);
    e.term.write(buffered);
  }
}

export function applyTerminalSettings(s: Settings): void {
  for (const [, e] of terms) {
    e.term.options.fontSize = s.terminalFontSize;
    e.term.options.fontFamily = s.monoFont || DEFAULT_MONO;
    e.term.options.cursorBlink = s.terminalCursorBlink;
    e.term.options.scrollback = s.terminalScrollback;
    e.term.options.theme = s.theme === 'light' ? LIGHT : DARK;
    e.hl.configure(s.terminalHighlight ?? true, s.theme === 'light' ? 'light' : 'dark');
  }
}
