// Форматирование значений для интерфейса.
import type { CommandRecord, CommandSource } from '../../shared/types';

export function fmtDate(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined
  });
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'никогда';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} дн назад`;
  return fmtDate(iso);
}

export function fmtSize(b: number): string {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} МБ`;
  return `${(b / 1024 ** 3).toFixed(2)} ГБ`;
}

export const SOURCE_LABELS: Record<CommandSource | 'verified', string> = {
  user_txt: 'Из моего TXT-файла',
  builtin: 'Встроенный справочник',
  user: 'Добавлено пользователем',
  imported: 'Импортировано из файла',
  verified: 'Проверено пользователем'
};

export const SOURCE_SHORT: Record<CommandSource, string> = {
  user_txt: 'Мой TXT',
  builtin: 'Встроенный',
  user: 'Мой',
  imported: 'Импорт'
};

export function sourceLabel(c: Pick<CommandRecord, 'source' | 'originFile'>): string {
  if (c.source === 'imported' && c.originFile) return `${SOURCE_LABELS.imported}: ${c.originFile}`;
  return SOURCE_LABELS[c.source];
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
