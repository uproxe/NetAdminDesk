// Упрощённая замена xterm.js только для предпросмотра интерфейса в браузере (не используется в приложении).
type Listener<T> = (v: T) => void;
export type ITheme = Record<string, string | undefined>;

function emitter<T>() {
  const ls = new Set<Listener<T>>();
  const on = (l: Listener<T>) => (ls.add(l), { dispose: () => ls.delete(l) });
  const fire = (v: T) => ls.forEach((l) => l(v));
  return { on, fire };
}

const ESC_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g;

export class Terminal {
  cols = 120;
  rows = 32;
  options: Record<string, unknown>;
  private el: HTMLPreElement | null = null;
  private text = '';
  private data = emitter<string>();
  private resize = emitter<{ cols: number; rows: number }>();
  private sel = emitter<void>();
  private keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  private parsed = emitter<void>();
  private decos = new Set<{ line: number; x: number; width: number; color: string }>();
  onWriteParsed = this.parsed.on;
  onData = this.data.on;
  onResize = this.resize.on;
  onSelectionChange = this.sel.on;
  constructor(opts: Record<string, unknown> = {}) {
    this.options = { ...opts };
  }
  loadAddon(a: { activate?: (t: Terminal) => void }) {
    a.activate?.(this);
  }
  open(host: HTMLElement) {
    const pre = document.createElement('pre');
    pre.className = 'xterm-stub';
    pre.tabIndex = 0;
    pre.addEventListener('keydown', (e) => {
      if (this.keyHandler && this.keyHandler(e) === false) return;
      let s = '';
      if (e.key === 'Enter') s = '\r';
      else if (e.key === 'Backspace') s = '\x7f';
      else if (e.key === 'Tab') s = '\t';
      else if (e.ctrlKey && e.key.length === 1) s = String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64);
      else if (e.key.length === 1) s = e.key;
      if (s) {
        e.preventDefault();
        this.data.fire(s);
      }
    });
    pre.addEventListener('mouseup', () => this.sel.fire());
    host.appendChild(pre);
    this.el = pre;
    this.render();
  }
  write(d: string) {
    for (const ch of d.replace(ESC_RE, '')) {
      if (ch === '\b') this.text = this.text.slice(0, -1);
      else if (ch !== '\r' && ch !== '\x07') this.text += ch;
    }
    if (this.text.length > 200000) this.text = this.text.slice(-150000);
    this.render();
    this.parsed.fire();
  }
  private lines() {
    return this.text.split('\n');
  }
  get buffer() {
    const lines = this.lines();
    return {
      active: {
        type: 'normal' as const,
        baseY: 0,
        cursorY: lines.length - 1,
        length: lines.length,
        getLine: (y: number) => (y < lines.length ? { translateToString: () => lines[y] } : undefined)
      }
    };
  }
  registerMarker(offset = 0) {
    const line = this.lines().length - 1 + offset;
    return { line, isDisposed: false, onDispose: () => ({ dispose() {} }), dispose() {} };
  }
  registerDecoration(o: { marker: { line: number }; x?: number; width?: number; foregroundColor?: string }) {
    const d = { line: o.marker.line, x: o.x ?? 0, width: o.width ?? 1, color: o.foregroundColor ?? '' };
    this.decos.add(d);
    queueMicrotask(() => this.render());
    return { marker: o.marker, dispose: () => this.decos.delete(d) };
  }
  private render() {
    if (!this.el) return;
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const byLine = new Map<number, { x: number; width: number; color: string }[]>();
    for (const d of this.decos) byLine.set(d.line, [...(byLine.get(d.line) ?? []), d]);
    this.el.innerHTML = this.lines()
      .map((l, i) => {
        const ds = (byLine.get(i) ?? []).sort((a, b) => a.x - b.x);
        let out = '';
        let pos = 0;
        for (const d of ds) {
          if (d.x < pos) continue;
          out += esc(l.slice(pos, d.x)) + `<span style="color:${d.color}">${esc(l.slice(d.x, d.x + d.width))}</span>`;
          pos = d.x + d.width;
        }
        return out + esc(l.slice(pos));
      })
      .join('\n');
    this.el.scrollTop = this.el.scrollHeight;
    const t = this.options.theme as ITheme | undefined;
    if (t) {
      this.el.style.background = t.background ?? '';
      this.el.style.color = t.foreground ?? '';
    }
    this.el.style.fontSize = `${this.options.fontSize ?? 14}px`;
  }
  attachCustomKeyEventHandler(h: (e: KeyboardEvent) => boolean) {
    this.keyHandler = h;
  }
  hasSelection() {
    return !!window.getSelection()?.toString();
  }
  getSelection() {
    return window.getSelection()?.toString() ?? '';
  }
  focus() {
    this.el?.focus();
  }
  clear() {
    this.text = '';
    this.decos.clear();
    this.render();
  }
  paste(s: string) {
    this.data.fire(s);
  }
  dispose() {
    this.el?.remove();
  }
  _fit(cols: number, rows: number) {
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      this.resize.fire({ cols, rows });
    }
  }
  _el() {
    return this.el;
  }
}

export class FitAddon {
  private t: Terminal | null = null;
  activate(t: Terminal) {
    this.t = t;
  }
  fit() {
    const el = this.t?._el()?.parentElement;
    if (!el || !this.t) return;
    const r = el.getBoundingClientRect();
    this.t._fit(Math.max(20, Math.floor(r.width / 8.4)), Math.max(5, Math.floor(r.height / 17)));
  }
  dispose() {}
}

export class SearchAddon {
  activate() {}
  findNext(q: string) {
    return !!q && (window as unknown as { find?: (s: string) => boolean }).find?.(q) === true;
  }
  findPrevious(q: string) {
    return !!q && (window as unknown as { find?: (s: string, c: boolean, b: boolean) => boolean }).find?.(q, false, true) === true;
  }
  clearDecorations() {}
  dispose() {}
}
