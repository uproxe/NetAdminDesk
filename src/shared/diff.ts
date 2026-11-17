// Построчное сравнение конфигураций (алгоритм Майерса) и группировка в фрагменты.

export type DiffType = 'equal' | 'add' | 'del';

export interface DiffOp {
  type: DiffType;
  text: string;
  /** Номер строки в старом тексте (1..n). */
  aLine?: number;
  /** Номер строки в новом тексте (1..m). */
  bLine?: number;
}

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  /** Строки, совпадающие с этим выражением, считаются равными (например, отметки времени). */
  ignorePattern?: RegExp;
}

function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  let v: Int32Array = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  trace.push(v.slice());
  // Обратный проход
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0; d--) {
    v = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', text: '', aLine: x, bLine: y });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ type: 'add', text: '', bLine: y });
      else ops.push({ type: 'del', text: '', aLine: x });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

export function diffLines(aText: string, bText: string, opts: DiffOptions = {}): DiffOp[] {
  const a = aText.replace(/\r\n?/g, '\n').split('\n');
  const b = bText.replace(/\r\n?/g, '\n').split('\n');
  const key = (s: string) => {
    let k = opts.ignoreWhitespace ? s.replace(/\s+/g, ' ').trim() : s;
    if (opts.ignorePattern && opts.ignorePattern.test(s)) k = '\u0000ignored';
    return k;
  };
  const ops = myers(a.map(key), b.map(key));
  for (const op of ops) {
    if (op.type === 'del') op.text = a[op.aLine! - 1];
    else op.text = b[op.bLine! - 1];
  }
  return ops;
}

export interface DiffHunk {
  aStart: number;
  bStart: number;
  ops: DiffOp[];
}

export function toHunks(ops: DiffOp[], context = 3): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const changed = ops.map((o) => o.type !== 'equal');
  let i = 0;
  while (i < ops.length) {
    if (!changed[i]) {
      i++;
      continue;
    }
    const start = Math.max(0, i - context);
    let end = i;
    while (end < ops.length) {
      let next = end;
      while (next < ops.length && changed[next]) next++;
      // ищем следующий изменённый фрагмент в пределах 2*context
      let gap = next;
      while (gap < ops.length && !changed[gap] && gap - next < context * 2) gap++;
      if (gap < ops.length && changed[gap] && gap - next < context * 2) {
        end = gap;
        continue;
      }
      end = Math.min(ops.length, next + context);
      break;
    }
    const slice = ops.slice(start, end);
    const first = slice.find((o) => o.aLine || o.bLine);
    hunks.push({ aStart: first?.aLine ?? 0, bStart: first?.bLine ?? 0, ops: slice });
    i = end;
  }
  return hunks;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number; unchanged: number } {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const o of ops) {
    if (o.type === 'add') added++;
    else if (o.type === 'del') removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}

/** Строки, которые обычно меняются без изменения конфигурации (Cisco IOS и др.). */
export const VOLATILE_CONFIG_LINES = /^(! Last configuration change|! NVRAM config last updated|ntp clock-period|Current configuration :|Building configuration|! Time:)/;
