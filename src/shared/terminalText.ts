// Обработка вывода терминала: очистка ANSI, постраничный вывод, приглашения CLI.

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78DEHMNOZc]|\x1b\[\?[0-9;]*[hl]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** Применяет \b (забой) и \r (возврат каретки) так, как это сделал бы терминал. */
export function renderLines(text: string): string {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    let line: string[] = [];
    let col = 0;
    for (const ch of rawLine) {
      if (ch === '\r') {
        col = 0;
      } else if (ch === '\b') {
        col = Math.max(0, col - 1);
      } else if (ch === '\x07' || ch === '\x00') {
        // звуковой сигнал и нулевые байты пропускаем
      } else {
        line[col] = ch;
        col++;
      }
    }
    // Хвостовые пробелы после затирания (например, «--More--» затёрт пробелами)
    out.push(line.join('').replace(/\s+$/, ''));
    line = [];
  }
  return out.join('\n');
}

export const PAGER_PATTERNS: RegExp[] = [
  /-+\s*More\s*-+/i,
  /<---\s*More\s*--->/i,
  /--\s*MORE\s*--/,
  /More:\s*<space>/i,
  /Press any key to continue/i,
  /\(q\)uit/i,
  /---- More ----/i,
  /\[More\]/i,
  /Press <SPACE>|Press SPACE/i,
  /--Next--/i
];

export function lastLine(s: string): string {
  const parts = s.split(/\r?\n|\r/);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].trim()) return parts[i];
  }
  return '';
}

export function isPagerPrompt(tail: string): boolean {
  const l = renderLines(stripAnsi(tail)).split('\n').pop() ?? '';
  const ll = l.trim() ? l : lastLine(renderLines(stripAnsi(tail)));
  return PAGER_PATTERNS.some((re) => re.test(ll));
}

/** Строка похожа на приглашение CLI (коммутатор или оболочка Linux). */
export const PROMPT_RE = /^[^\s].{0,120}?[#>$%\]]\s?$/;

export function endsWithPrompt(tail: string): boolean {
  const text = renderLines(stripAnsi(tail));
  if (/\n\s*$/.test(text) && !/[#>$%\]]\s?$/.test(text)) return false;
  const l = text.split('\n').pop() ?? '';
  if (!l.trim()) return false;
  if (PAGER_PATTERNS.some((re) => re.test(l))) return false;
  return PROMPT_RE.test(l.replace(/^\s+/, ''));
}

export function isPasswordPrompt(tail: string): boolean {
  const l = lastLine(renderLines(stripAnsi(tail)));
  return /(pass(word|phrase|code)?|secret|пароль|PIN)[^\n:]{0,40}[:>]\s*$/i.test(l);
}

/** Очистка захваченного вывода команды: ANSI, эхо команды, приглашение, остатки --More--. */
export function cleanCaptured(raw: string, command: string): string {
  let text = renderLines(stripAnsi(raw));
  let lines = text.split('\n');
  // убрать строки-приглашения постраничного вывода
  lines = lines.map((l) => {
    let x = l;
    for (const re of PAGER_PATTERNS) x = x.replace(re, '');
    return x.replace(/\s+$/, '');
  });
  // эхо команды в первой непустой строке
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx >= 0 && command && lines[firstIdx].trim().endsWith(command.trim())) lines.splice(0, firstIdx + 1);
  // завершающее приглашение
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length && PROMPT_RE.test(lines[lines.length - 1].trim()) && lines[lines.length - 1].trim().length < 80) lines.pop();
  text = lines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return text;
}
