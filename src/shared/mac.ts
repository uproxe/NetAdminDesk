// Работа с MAC-адресами в форматах разных производителей.
import type { MacFormat } from './platforms';

const HEX = '[0-9a-fA-F]';
const RE_CISCO = new RegExp(`\\b${HEX}{4}\\.${HEX}{4}\\.${HEX}{4}\\b`, 'g');
const RE_SEP = new RegExp(`\\b${HEX}{2}([-:])${HEX}{2}(?:\\1${HEX}{2}){4}\\b`, 'g');
const RE_HP = new RegExp(`\\b${HEX}{6}-${HEX}{6}\\b`, 'g');

/** Возвращает 12 hex-символов в нижнем регистре или null. */
export function parseMac(input: string): string | null {
  const s = input.trim();
  if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s)) return s.replace(/\./g, '').toLowerCase();
  if (/^[0-9a-f]{2}([-:])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i.test(s)) return s.replace(/[-:]/g, '').toLowerCase();
  if (/^[0-9a-f]{6}-[0-9a-f]{6}$/i.test(s)) return s.replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{12}$/i.test(s)) return s.toLowerCase();
  return null;
}

export function formatMac(hex12: string, fmt: MacFormat): string {
  const h = hex12.toLowerCase();
  const pairs = h.match(/.{2}/g) ?? [];
  switch (fmt) {
    case 'cisco':
      return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8, 12)}`;
    case 'dash':
      return pairs.join('-');
    case 'colon':
      return pairs.join(':');
    case 'hp':
      return `${h.slice(0, 6)}-${h.slice(6, 12)}`;
    default:
      return h;
  }
}

export const MAC_FORMAT_LABELS: Record<MacFormat, string> = {
  cisco: 'xxxx.xxxx.xxxx',
  dash: 'xx-xx-xx-xx-xx-xx',
  colon: 'xx:xx:xx:xx:xx:xx',
  hp: 'xxxxxx-xxxxxx',
  plain: 'xxxxxxxxxxxx'
};

export interface FoundMac {
  raw: string;
  hex: string;
  index: number;
}

/** Находит MAC-адреса любых распространённых форматов в тексте. */
export function findMacsInText(text: string): FoundMac[] {
  const out: FoundMac[] = [];
  for (const re of [RE_CISCO, RE_SEP, RE_HP]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const hex = parseMac(m[0]);
      if (hex) out.push({ raw: m[0], hex, index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Строки текста, содержащие указанный MAC (в любом формате). */
export function linesWithMac(text: string, hex12: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => findMacsInText(line).some((m) => m.hex === hex12));
}
