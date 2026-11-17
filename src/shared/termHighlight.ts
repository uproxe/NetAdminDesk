// Подсветка ключевых слов в выводе терминала (как Keyword highlighting в SecureCRT):
// плохое — красным, предупреждения — жёлтым, хорошее — зелёным, адреса — голубым, интерфейсы — фиолетовым.
// Здесь только поиск совпадений по строке; раскраска делается в терминале декорациями xterm.js.

export type HighlightKind = 'bad' | 'warn' | 'good' | 'addr' | 'iface';

export interface HighlightRange {
  start: number;
  len: number;
  kind: HighlightKind;
}

const RULES: { kind: HighlightKind; re: RegExp }[] = [
  // Порт выключен администратором — это не авария, а настройка (shutdown)
  { kind: 'warn', re: /\badministratively down\b/gi },
  // Ненулевые счётчики ошибок: «12 input errors», «3 CRC», «5 output drops»
  { kind: 'bad', re: /\b[1-9][\d,]*\s+(?:input errors?|output errors?|errors?|CRC|runts|giants|collisions|late collisions?|discards?|drops?|overruns?|FCS-Err|Align-Err)\b/gi },
  { kind: 'bad', re: /\b(?:err-?disabled|errdisabled?|down|failed|failure|fail|denied|refused|unreachable|timed out|critical|emerg(?:ency)?|alert|blocked|dead|lost|crash(?:ed)?)\b/gi },
  { kind: 'bad', re: /%\s?(?:Invalid input|Incomplete command|Ambiguous command|Unknown command|Unrecognized command)[^\r\n]*/gi },
  { kind: 'bad', re: /(?:ошибка|ошибки|не удалось|отказано|недоступен|сбой)/gi },
  { kind: 'warn', re: /\b(?:administratively down|notconnect(?:ed)?|not connected|not-?present|disabled|inactive|warning|warn|blocking|BLK|listening|learning|standby|degraded|unknown|half(?:-duplex)?|deprecated)\b/gi },
  { kind: 'warn', re: /(?:предупреждение|внимание)/gi },
  { kind: 'good', re: /\b(?:up|connected|forwarding|FWD|active|running|enabled|established|online|OK|success(?:ful)?|healthy|full(?:-duplex)?|listen|passed)\b/gi },
  { kind: 'addr', re: /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g },
  { kind: 'addr', re: /\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b/gi },
  { kind: 'addr', re: /\b[0-9a-f]{2}([:-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}\b/gi },
  { kind: 'iface', re: /\b(?:GigabitEthernet|FastEthernet|TenGigabitEthernet|TwentyFiveGigE|HundredGigE|Ethernet|Port-channel|Gi|Fa|Te|Tw|Hu|Eth|Po|ge|xe)\d+(?:\/\d+){1,3}(?:\.\d+)?\b|\b(?:eth|ens|enp\d+s|eno|wlan|bond|vlan|br)\d+\b/gi }
];

/** Совпадения в строке без пересечений (выигрывает правило, стоящее раньше). Не более 40 на строку. */
export function highlightRanges(line: string): HighlightRange[] {
  if (!line.trim() || line.length > 2000) return [];
  const taken: boolean[] = new Array(line.length).fill(false);
  const out: HighlightRange[] = [];
  for (const { kind, re } of RULES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const len = m[0].length;
      let free = true;
      for (let i = start; i < start + len; i++) if (taken[i]) free = false;
      if (!free) continue;
      for (let i = start; i < start + len; i++) taken[i] = true;
      out.push({ start, len, kind });
      if (out.length >= 40) return out.sort((a, b) => a.start - b.start);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export const HIGHLIGHT_COLORS: Record<'dark' | 'light', Record<HighlightKind, string>> = {
  dark: { bad: '#ff7b72', warn: '#e3b341', good: '#56d364', addr: '#56d4dd', iface: '#d2a8ff' },
  light: { bad: '#cf222e', warn: '#9a6700', good: '#1a7f37', addr: '#0969da', iface: '#8250df' }
};
