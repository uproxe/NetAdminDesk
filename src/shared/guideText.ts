// Разбор упрощённой разметки руководств (общий для интерфейса и тестов).

/** Строка таблицы «| a | b |» → ячейки; «|» внутри `кода` не разделяет ячейки. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let code = false;
  for (const ch of line.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (ch === '`') code = !code;
    if (ch === '|' && !code) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
