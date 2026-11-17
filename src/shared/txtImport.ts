// Разбор TXT-файлов с командами (формат рабочих заметок администратора).
// Принципы: ничего не выбрасываем, исходный текст сохраняем дословно, синтаксис не исправляем,
// сомнительное помечаем «Требует проверки», каждую непустую строку учитываем в отчёте.
import type { CommandInput, CommandSource, EntryType, LineNote, TxtParseReport, TxtReportIssue } from './types';
import { UNKNOWN_PLATFORM, getPlatform } from './platforms';
import { categorizeSwitch } from './categories';
import { classifyCommand } from './risk';
import { suggestTemplate } from './templates';

const CYR = /[А-Яа-яЁё]/;
const CYR_G = /[А-Яа-яЁё]/g;

export interface TxtImportOptions {
  /** Имя файла для отображения. */
  fileLabel: string;
  /** Префикс стабильных идентификаторов записей. */
  sourceKey: string;
  source: CommandSource;
  kind?: 'switch' | 'linux';
  defaultPlatform?: string;
  defaultVendorLabel?: string;
}

export interface ParsedLine {
  lineNo: number;
  raw: string;
  prompt?: string;
  depth: number;
  command: string;
  note?: string;
  emptyDash?: boolean;
  indented: boolean;
  flags: string[];
}

export interface ParsedEntry {
  type: EntryType;
  platform: string;
  vendorLabel: string;
  sectionHeader?: string;
  heading?: string;
  lines: ParsedLine[];
  output: { lineNo: number; text: string }[];
  noteText?: string;
  startLine: number;
  endLine: number;
  rawText: string;
  review: string[];
  assumption?: string;
  sensitive: boolean;
  sensitiveReason?: string;
}

interface Section {
  platform: string;
  vendorLabel: string;
  header?: string;
}

// ---------- Декодирование ----------

export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' };
  }
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start)), encoding: start ? 'UTF-8 (BOM)' : 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'Windows-1251' };
  }
}

// ---------- Заголовки разделов и производители ----------

export function mapVendor(text: string): Section | null {
  const t = text.toLowerCase();
  if (/sg\s?-?3\d\d/.test(t)) return { platform: 'cisco-sg300', vendorLabel: 'Cisco SG300' };
  if (/procurv|\bhp\b|aruba/.test(t)) return { platform: 'hp-procurve', vendorLabel: 'HP ProCurve' };
  if (/linksys/.test(t)) return { platform: 'linksys', vendorLabel: 'Linksys' };
  if (/at-?8000s/.test(t)) return { platform: 'at-8000s', vendorLabel: 'Allied Telesis AT-8000S' };
  if (/telesis|allied|телесис/.test(t)) return { platform: 'alliedware', vendorLabel: 'Allied Telesis' };
  if (/qtech|кутех/.test(t)) return { platform: 'qtech', vendorLabel: 'Qtech' };
  if (/osnovo|осново|основа/.test(t)) return { platform: 'osnovo', vendorLabel: 'OSNOVO' };
  if (/tp-?link/.test(t)) return { platform: 'tplink', vendorLabel: 'TP-Link' };
  if (/cisco|циско|цыско/.test(t)) return { platform: 'cisco-ios', vendorLabel: 'Cisco' };
  return null;
}

const HEADER_RE = /^\s*#{2,}\s*(.+?)\s*#{2,}\s*$/;
const VENDOR_ALONE_RE =
  /^\s*(tp-?link|cisco|hp|procurve|hp procurve|linksys|qtech|osnovo|telesis|allied telesis|d-?link|huawei|zyxel|eltex|mikrotik|juniper|aruba)\s*:?\s*$/i;
const VENDOR_NOTE_RE = /^\s*(telesis|cisco|osnovo|qtech|linksys|hp|procurve|tp-?link|allied telesis)\s*:\s+(.*)$/i;

function headerSection(text: string): Section {
  const mapped = mapVendor(text);
  if (mapped) return { ...mapped, header: text };
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { platform: `custom-${slug || 'vendor'}`, vendorLabel: text.trim(), header: text };
}

// ---------- Приглашения CLI ----------

function splitPrompt(line: string): { prompt?: string; rest: string; depth: number } {
  let m = /^(SecOff|Manager|Operator|User)\s+[^>]{0,40}>\s*/i.exec(line);
  if (m) return { prompt: m[0].trim(), rest: line.slice(m[0].length), depth: 0 };
  m = /^([A-Za-z0-9_.\-]*)\(([\w\-]+)\)(#?)\s*/.exec(line);
  if (m) return { prompt: m[0].trim(), rest: line.slice(m[0].length), depth: m[2] === 'config' ? 1 : 2 };
  m = /^([A-Za-z0-9_.\-]+)([#>])\s*/.exec(line);
  if (m && /\d|[A-Z]/.test(m[1])) return { prompt: m[0].trim(), rest: line.slice(m[0].length), depth: 0 };
  m = /^#\s*/.exec(line);
  if (m) return { prompt: '#', rest: line.slice(m[0].length), depth: 0 };
  return { rest: line, depth: 0 };
}

// ---------- Разделение команды и пояснения ----------

const CAPS_PLACEHOLDERS = new Set(['ИМЯ', 'ПАРОЛЬ', 'ЛОГИН', 'ПОРТ', 'ВЛАН', 'НОМЕР', 'АДРЕС']);
const COMMAND_VERBS =
  /^(show|sh|display|dir|conf|configure|copy|write|whrite|wr|clear|reload|interface|int|vlan|no|ip|ipv6|permit|deny|object-group|host|end|exit|terminal|logging|clock|sntp|ntp|username|passwords?|enable|disable|create|add|delete|destroy|set|upload|macro|default|switchport|spanning-tree|power|security-manage|vtp|ping|traceroute|hostname|description|name|channel-group|speed|duplex|mtu|management|boot|erase|reset|restart|\d+\s+(permit|deny))\b/;
const EMBEDDED_VERBS = /\b(show|sh|display|ping|traceroute|copy|write|conf|configure|terminal|clear|reload|interface|vlan|no|ip|dir)\s+\S/g;

/** Индекс первого кириллического символа, не являющегося плейсхолдером, или -1. */
function findCommentStart(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '<') {
      const close = s.indexOf(ch === '(' ? ')' : '>', i + 1);
      const inner = close > i ? s.slice(i + 1, close) : s.slice(i + 1);
      if (close > i && close - i <= 40 && /^[А-Яа-яЁё\s]+$/.test(inner)) {
        i = close; // плейсхолдер вида (номер строки) или <название группы>
        continue;
      }
      if (CYR.test(inner)) return i; // комментарий в скобках
      continue;
    }
    if (CYR.test(ch)) {
      const word = /^[А-ЯЁ]+/.exec(s.slice(i))?.[0] ?? '';
      if (word.length >= 2 && CAPS_PLACEHOLDERS.has(word) && !/[а-яё]/.test(s[i + word.length] ?? '')) {
        i += word.length - 1;
        continue;
      }
      return i;
    }
  }
  return -1;
}

interface SplitResult {
  command: string;
  note?: string;
  emptyDash: boolean;
}

export function splitDescription(rest: string): SplitResult {
  const text = rest.replace(/\s+$/, '');
  // 1) Разделитель « - » (или «--»), за которым кириллица или конец строки
  const sepRe = /\s+-{1,2}(\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = sepRe.exec(text))) {
    const after = text.slice(m.index + m[0].length);
    if (after.trim() === '' || CYR.test(after.slice(0, 60))) {
      let command = text.slice(0, m.index).trimEnd();
      let note = after.trim();
      const cs = findCommentStart(command);
      if (cs >= 0) {
        note = `${command.slice(cs).trim()} - ${note}`.replace(/ - $/, '');
        command = command.slice(0, cs).trimEnd();
      }
      return { command, note: note || undefined, emptyDash: after.trim() === '' };
    }
  }
  // 2) Пояснение начинается с первого кириллического слова (вне плейсхолдеров)
  const cs = findCommentStart(text);
  if (cs < 0) return { command: text.trim(), emptyDash: false };
  const command = text
    .slice(0, cs)
    .replace(/[\s:–—-]+$/, '')
    .trimEnd();
  const note = text.slice(cs).trim();
  if (command) return { command, note, emptyDash: false };
  // 3) Строка начинается с русского текста, команда — в конце строки
  EMBEDDED_VERBS.lastIndex = 0;
  while ((m = EMBEDDED_VERBS.exec(text))) {
    const tail = text.slice(m.index);
    if (findCommentStart(tail) < 0) {
      return { command: tail.trim(), note: text.slice(0, m.index).trim(), emptyDash: false };
    }
  }
  return { command: '', note: text.trim(), emptyDash: false };
}

// ---------- Классификация строк ----------

type Item =
  | { kind: 'header'; lineNo: number; raw: string; section: Section }
  | { kind: 'note'; lineNo: number; raw: string; text: string; vendor?: Section | null }
  | { kind: 'cmd'; lineNo: number; raw: string; line: ParsedLine };

const KNOWN_SINGLE = new Set(['end', 'exit', 'enable', 'disable', 'reload', 'write', 'wr', 'logout', 'quit', 'conf', 'configure']);

const KNOWN_TYPOS: [RegExp, string][] = [
  [/\bcounerts\b/i, 'возможна опечатка: «counerts» → «counters»'],
  [/\bwhrite\b/i, 'возможна опечатка: «whrite» → «write»']
];

/** Точечные замечания, в которых есть уверенность (исходник не изменяется). */
const KNOWN_REMARKS: [RegExp, string][] = [
  [
    /^\(config-if\)#?\s*ip ssh password-auth\b/i,
    'на Cisco SG300 «ip ssh password-auth» — команда глобального режима (config), включает вход по SSH с паролем; в файле указан режим (config-if), а пояснение может не соответствовать назначению команды'
  ],
  [/^\(config-if\)#?\s*passwords aging\b/i, 'на Cisco Small Business «passwords aging» — команда глобального режима (config); в файле указан режим (config-if)']
];

function classifyLine(raw: string, lineNo: number): Item | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hm = HEADER_RE.exec(trimmed);
  if (hm) return { kind: 'header', lineNo, raw, section: headerSection(hm[1]) };
  if (VENDOR_ALONE_RE.test(trimmed)) return { kind: 'header', lineNo, raw, section: headerSection(trimmed.replace(/:$/, '')) };
  const vn = VENDOR_NOTE_RE.exec(trimmed);
  if (vn && CYR.test(vn[2])) return { kind: 'note', lineNo, raw, text: trimmed, vendor: mapVendor(vn[1]) };

  const flags: string[] = [];
  let body = trimmed;
  const bang = /^!{2,}\s*/.exec(body);
  if (bang) {
    flags.push(`в исходной строке перед командой стоит «${bang[0].trim()}» — распознано как пометка`);
    body = body.slice(bang[0].length);
  }
  const { prompt, rest, depth } = splitPrompt(body);
  const split = splitDescription(rest);
  if (!split.command) return { kind: 'note', lineNo, raw, text: trimmed, vendor: mapVendor(trimmed) };

  // Одно слово латиницей + развёрнутое русское пояснение — это заметка, а не команда.
  const tokens = split.command.split(/\s+/);
  if (!prompt && tokens.length === 1 && !KNOWN_SINGLE.has(tokens[0].toLowerCase()) && (split.note?.length ?? 0) > 15 && /^[A-Za-z]+$/.test(tokens[0])) {
    return { kind: 'note', lineNo, raw, text: trimmed, vendor: mapVendor(trimmed) };
  }

  for (const [re, msg] of KNOWN_TYPOS) if (re.test(split.command)) flags.push(msg);
  for (const [re, msg] of KNOWN_REMARKS) if (re.test(`${prompt ?? ''}${split.command}`)) flags.push(msg);
  if (split.note && /из стать|из интернет|не провер/i.test(split.note)) {
    flags.push('по пометке в исходном файле команда/пример не проверены («взят из статьи»)');
  }
  if (/\.{4,}/.test(split.command)) flags.push('«....» — место для подстановки значения');

  return {
    kind: 'cmd',
    lineNo,
    raw,
    line: {
      lineNo,
      raw,
      prompt,
      depth,
      command: split.command,
      note: split.note,
      emptyDash: split.emptyDash,
      indented: /^[ \t]+\S/.test(raw),
      flags
    }
  };
}

function isModeEntering(cmd: string): boolean {
  const c = cmd.trim().toLowerCase();
  return (
    /^(conf|conf t|configure|configure terminal)$/.test(c) ||
    /^(interface|int)\s+\S/.test(c) ||
    /^(ip\s+)?access-list\s+(extended|standard)\s+\S+$/.test(c) ||
    /^object-group\s+\S+/.test(c) ||
    /^vlan database$/.test(c) ||
    /^vlan\s+\d+$/.test(c) ||
    /^(router|line|policy-map|class-map)\b/.test(c)
  );
}

function isConfT(cmd: string): boolean {
  return /^(conf|conf t|configure|configure terminal)$/i.test(cmd.trim());
}

function isShowLike(cmd: string): boolean {
  return /^(show|sh|display|dir)\b/i.test(cmd.trim());
}

// ---------- Чувствительные данные ----------

function detectSensitive(text: string, command: string): string | undefined {
  const cmd = command.toLowerCase();
  const cred = /\b(username\s+\S+\s+(password|secret)|enable\s+(secret|password)|password|snmp-server community|key-string)\s+(\d\s+)?(\S+)/i.exec(command);
  if (cred) {
    const value = cred[5] ?? '';
    if (!/^(ИМЯ|ПАРОЛЬ|<.*>|\{\{.*\}\}|\*+|privilege|level)$/i.test(value) && !/^passwords?\s+aging/.test(cmd)) {
      return 'команда содержит значение пароля/секрета';
    }
  }
  if (/(парол\w*|password|passwd|логин|login)/i.test(text) && /(:\s*[A-Za-z0-9]|—\s*[A-Za-z0-9]|по умолчанию)/i.test(text)) {
    return 'текст содержит учётные данные (логины/пароли)';
  }
  return undefined;
}

// ---------- Разбор ----------

interface Block {
  items: Item[];
  startLine: number;
  endLine: number;
}

function emptyReport(opts: TxtImportOptions, totalLines: number, nonEmpty: number, sha256 = '', encoding = 'UTF-8'): TxtParseReport {
  return {
    file: opts.fileLabel,
    sha256,
    encoding,
    totalLines,
    nonEmptyLines: nonEmpty,
    headers: [],
    entries: 0,
    byType: { command: 0, sequence: 0, note: 0 },
    byPlatform: {},
    commandLines: 0,
    outputLines: 0,
    headingLines: 0,
    noteLines: 0,
    needsReview: [],
    vendorUnknown: 0,
    sensitive: [],
    noDescription: 0,
    skipped: [],
    errors: [],
    unaccounted: []
  };
}

export function parseTxt(
  text: string,
  opts: TxtImportOptions,
  meta: { sha256?: string; encoding?: string } = {}
): { entries: ParsedEntry[]; report: TxtParseReport } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nonEmpty = lines.filter((l) => l.trim()).length;
  const report = emptyReport(opts, lines.length, nonEmpty, meta.sha256, meta.encoding);
  const role = new Map<number, string>();
  const entries: ParsedEntry[] = [];
  const defaultSection: Section = {
    platform: opts.defaultPlatform ?? (opts.kind === 'linux' ? 'linux' : UNKNOWN_PLATFORM),
    vendorLabel: opts.defaultVendorLabel ?? (opts.kind === 'linux' ? 'Linux' : 'Производитель не указан')
  };
  let section: Section = defaultSection;

  // 1) Блоки, разделённые пустыми строками
  const blocks: Block[] = [];
  let cur: Block | null = null;
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    let item: Item | null = null;
    try {
      item = classifyLine(raw, lineNo);
    } catch (e) {
      report.errors.push({ line: lineNo, text: raw, reason: `ошибка разбора: ${(e as Error).message}` });
      role.set(lineNo, 'error');
      return;
    }
    if (!item) {
      cur = null;
      return;
    }
    if (!cur) {
      cur = { items: [], startLine: lineNo, endLine: lineNo };
      blocks.push(cur);
    }
    cur.items.push(item);
    cur.endLine = lineNo;
  });

  const rawSlice = (from: number, to: number) => lines.slice(from - 1, to).join('\n');

  const makeEntry = (type: EntryType, sec: Section, parsed: ParsedLine[], extra: Partial<ParsedEntry> = {}): ParsedEntry => {
    const all = [...parsed.map((p) => p.lineNo), ...(extra.output ?? []).map((o) => o.lineNo)];
    const start = Math.min(...all, extra.startLine ?? Infinity);
    const end = Math.max(...all, extra.endLine ?? -Infinity);
    return {
      type,
      platform: sec.platform,
      vendorLabel: sec.vendorLabel,
      sectionHeader: sec.header,
      lines: parsed,
      output: [],
      startLine: start,
      endLine: end,
      rawText: '',
      review: [],
      sensitive: false,
      ...extra
    };
  };

  let pendingNotes: { lineNo: number; text: string }[] | null = null;

  // Заметка посреди блока, после которой идут команды, начинает новый подблок со своим заголовком.
  const segmented: Block[] = [];
  for (const block of blocks) {
    let seg: Block = { items: [], startLine: block.startLine, endLine: block.startLine };
    const pushSeg = () => {
      if (seg.items.length) segmented.push(seg);
    };
    block.items.forEach((it, idx) => {
      const prev = seg.items[seg.items.length - 1];
      const hasCmdAfter = block.items.slice(idx + 1).some((x) => x.kind === 'cmd');
      if (it.kind === 'note' && prev && prev.kind === 'cmd' && hasCmdAfter) {
        pushSeg();
        seg = { items: [], startLine: it.lineNo, endLine: it.lineNo };
      }
      if (!seg.items.length) seg.startLine = it.lineNo;
      seg.items.push(it);
      seg.endLine = it.lineNo;
    });
    pushSeg();
  }
  blocks.length = 0;
  blocks.push(...segmented);

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const items: Item[] = [];
    for (const it of block.items) {
      if (it.kind === 'header') {
        section = it.section;
        role.set(it.lineNo, 'header');
        report.headers.push({ line: it.lineNo, text: it.raw.trim(), platform: it.section.platform, vendorLabel: it.section.vendorLabel });
      } else items.push(it);
    }
    if (!items.length) continue;

    // Блок только из заметок
    if (items.every((i) => i.kind === 'note')) {
      const notes = items as Extract<Item, { kind: 'note' }>[];
      const next = blocks[bi + 1];
      const nextFirst = next?.items.find((i) => i.kind !== 'header');
      const nextIsUntitledProc = nextFirst?.kind === 'cmd' && !nextFirst.line.note && next.startLine - block.endLine <= 2;
      if (nextIsUntitledProc && !pendingNotes) {
        pendingNotes = notes.map((n) => ({ lineNo: n.lineNo, text: n.text }));
        continue;
      }
      const vendor = notes.find((n) => n.vendor)?.vendor;
      const sec = vendor ? { ...vendor, header: section.header } : section;
      const noteText = notes.map((n) => n.text).join('\n');
      const e = makeEntry('note', sec, [], { noteText, startLine: block.startLine, endLine: block.endLine });
      notes.forEach((n) => role.set(n.lineNo, 'note'));
      entries.push(e);
      continue;
    }

    // Ведущие заметки — заголовок блока
    const heading: Extract<Item, { kind: 'note' }>[] = [];
    let k = 0;
    while (k < items.length && items[k].kind === 'note') heading.push(items[k++] as Extract<Item, { kind: 'note' }>);
    const rest = items.slice(k);

    // Определение производителя по тексту заголовка (если файл без разделов)
    let sec = section;
    const headingVendor = heading.map((h) => h.vendor).find(Boolean);
    if (headingVendor && section.platform === defaultSection.platform) sec = { ...headingVendor, header: section.header };

    const blockEntries: ParsedEntry[] = [];

    if (heading.length) {
      heading.forEach((h) => role.set(h.lineNo, 'heading'));
      const headingText = heading.map((h) => h.text).join(' ');
      const parsed: ParsedLine[] = [];
      const output: { lineNo: number; text: string }[] = [];
      let outputMode: 'none' | 'show' | 'all' = 'none';
      for (const it of rest) {
        if (it.kind === 'note') {
          // заметка посреди блока — пояснение к предыдущей строке
          if (parsed.length) {
            const last = parsed[parsed.length - 1];
            last.note = last.note ? `${last.note}; ${it.text}` : it.text;
          } else parsed.push({ lineNo: it.lineNo, raw: it.raw, depth: 0, command: '', note: it.text, indented: false, flags: [] });
          role.set(it.lineNo, 'note');
          continue;
        }
        if (it.kind !== 'cmd') continue;
        const l = it.line;
        if (outputMode === 'all' || (outputMode === 'show' && !l.note && !l.prompt && !COMMAND_VERBS.test(l.command) )) {
          output.push({ lineNo: l.lineNo, text: l.raw });
          role.set(l.lineNo, 'output');
          continue;
        }
        outputMode = 'none';
        parsed.push(l);
        role.set(l.lineNo, 'command');
        if (l.emptyDash) outputMode = 'all';
        else if (isShowLike(l.command)) outputMode = 'show';
      }
      const cmdLines = parsed.filter((p) => p.command);
      const type: EntryType = cmdLines.length === 1 ? 'command' : 'sequence';
      blockEntries.push(
        makeEntry(type, sec, parsed, { heading: headingText.replace(/[:\s]+$/, ''), output, startLine: block.startLine, endLine: block.endLine })
      );
    } else {
      // Группировка строк без заголовка
      let curE: (ParsedEntry & { absorbAll?: boolean; outputMode?: 'none' | 'show' | 'all' }) | null = null;
      const flush = () => {
        if (curE) blockEntries.push(curE);
        curE = null;
      };
      for (const it of rest) {
        if (it.kind === 'note') {
          if (curE) {
            const lastLine = curE.lines[curE.lines.length - 1];
            lastLine.note = lastLine.note ? `${lastLine.note}; ${it.text}` : it.text;
            curE.endLine = it.lineNo;
          } else {
            blockEntries.push(makeEntry('note', sec, [], { noteText: it.text, startLine: it.lineNo, endLine: it.lineNo }));
          }
          role.set(it.lineNo, 'note');
          continue;
        }
        if (it.kind !== 'cmd') continue;
        const l = it.line;
        if (!curE) {
          curE = makeEntry('command', sec, [l]);
          curE.absorbAll = isConfT(l.command) && !l.note;
          curE.outputMode = l.emptyDash ? 'all' : isShowLike(l.command) ? 'show' : 'none';
          role.set(l.lineNo, 'command');
          continue;
        }
        const e: ParsedEntry & { absorbAll?: boolean; outputMode?: 'none' | 'show' | 'all' } = curE;
        // Пример вывода
        if (e.outputMode === 'all' || (e.outputMode === 'show' && !l.note && !l.prompt && (l.indented || !COMMAND_VERBS.test(l.command)))) {
          e.output.push({ lineNo: l.lineNo, text: l.raw });
          e.endLine = l.lineNo;
          role.set(l.lineNo, 'output');
          continue;
        }
        const last = e.lines[e.lines.length - 1];
        const hasMode = e.lines.some((p) => isModeEntering(p.command));
        const inConfig = e.lines.some((p) => p.depth >= 1 || isModeEntering(p.command));
        const hasDesc = e.lines.some((p) => p.note);
        const join =
          !!e.absorbAll ||
          l.indented ||
          (l.depth >= 2 && hasMode) ||
          (!last.note && l.depth > last.depth && isModeEntering(last.command)) ||
          (inConfig && !hasDesc && l.depth >= 1) ||
          (!l.note && !l.prompt && isModeEntering(last.command) && !isShowLike(l.command));
        if (join) {
          e.lines.push(l);
          e.endLine = l.lineNo;
          e.outputMode = l.emptyDash ? 'all' : isShowLike(l.command) ? 'show' : 'none';
          role.set(l.lineNo, 'command');
        } else {
          flush();
          curE = makeEntry('command', sec, [l]);
          curE.absorbAll = isConfT(l.command) && !l.note;
          curE.outputMode = l.emptyDash ? 'all' : isShowLike(l.command) ? 'show' : 'none';
          role.set(l.lineNo, 'command');
        }
      }
      flush();
      for (const be of blockEntries) {
        if (be.type === 'command' && be.lines.filter((p) => p.command).length > 1) be.type = 'sequence';
      }
    }

    // Заметки из предыдущего блока становятся заголовком первой записи
    if (pendingNotes && blockEntries.length) {
      const first = blockEntries[0];
      first.heading = pendingNotes[pendingNotes.length - 1].text.replace(/[:\s]+$/, '');
      first.noteText = pendingNotes.map((p) => p.text).join('\n');
      first.startLine = Math.min(first.startLine, pendingNotes[0].lineNo);
      pendingNotes.forEach((p) => role.set(p.lineNo, 'heading'));
      pendingNotes = null;
    } else if (pendingNotes) {
      for (const p of pendingNotes) {
        entries.push(makeEntry('note', section, [], { noteText: p.text, startLine: p.lineNo, endLine: p.lineNo }));
        role.set(p.lineNo, 'note');
      }
      pendingNotes = null;
    }
    entries.push(...blockEntries);
  }
  if (pendingNotes) {
    for (const p of pendingNotes) {
      entries.push(makeEntry('note', section, [], { noteText: p.text, startLine: p.lineNo, endLine: p.lineNo }));
      role.set(p.lineNo, 'note');
    }
  }

  // 2) Пост-обработка: исходный текст, пометки, отчёт
  for (const e of entries) {
    e.rawText = rawSlice(e.startLine, e.endLine);
    for (const l of e.lines) for (const f of l.flags) if (!e.review.includes(f)) e.review.push(f);
    const command = e.lines.map((l) => l.command).filter(Boolean).join('\n');
    const allText = `${e.heading ?? ''}\n${e.noteText ?? ''}\n${e.lines.map((l) => `${l.command} ${l.note ?? ''}`).join('\n')}`;
    const sens = detectSensitive(allText, command);
    if (sens) {
      e.sensitive = true;
      e.sensitiveReason = sens;
      report.sensitive.push({ line: e.startLine, text: firstLine(e.rawText), reason: sens });
    }
    if (e.platform === UNKNOWN_PLATFORM && e.type !== 'note' && /\bethernet\s+[eg]\d/.test(command)) {
      e.assumption = 'Синтаксис «ethernet gN / eN» встречается у Linksys и Allied Telesis AT-8000S. Производитель в файле не указан — это предположение.';
    }
    report.entries++;
    report.byType[e.type]++;
    report.byPlatform[e.vendorLabel] = (report.byPlatform[e.vendorLabel] ?? 0) + 1;
    if (e.platform === UNKNOWN_PLATFORM && e.type !== 'note') report.vendorUnknown++;
    if (e.type !== 'note' && !e.heading && !e.noteText && !e.lines.some((l) => l.note) && !e.output.length) report.noDescription++;
    for (const r of e.review) report.needsReview.push({ line: e.startLine, text: firstLine(e.rawText), reason: r });
  }
  lines.forEach((raw, idx) => {
    const n = idx + 1;
    if (!raw.trim()) return;
    const r = role.get(n);
    if (!r) report.unaccounted.push(n);
    else if (r === 'command') report.commandLines++;
    else if (r === 'output') report.outputLines++;
    else if (r === 'heading') report.headingLines++;
    else if (r === 'note') report.noteLines++;
  });
  for (const n of report.unaccounted) {
    report.skipped.push({ line: n, text: lines[n - 1], reason: 'строка не распознана' });
  }
  return { entries, report };
}

function firstLine(s: string): string {
  const l = s.split('\n').find((x) => x.trim()) ?? '';
  return l.length > 140 ? `${l.slice(0, 137)}…` : l;
}

// ---------- Преобразование в записи справочника ----------

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function shorten(s: string, n = 90): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
}

export function entryTitle(e: ParsedEntry): string {
  if (e.type === 'note') return shorten(capitalize(e.noteText?.split('\n')[0] ?? 'Заметка'));
  if (e.heading) return shorten(capitalize(e.heading));
  const cmds = e.lines.filter((l) => l.command);
  const notes = e.lines.map((l) => l.note?.replace(/[.\s]+$/, '')).filter((n): n is string => !!n);
  const firstCmd = cmds[0]?.command ?? '';
  if (!notes.length) return cmds.length > 1 ? `${shorten(firstCmd, 70)} …` : shorten(firstCmd);
  if (cmds.length > 1 && notes.length > 1) return shorten(capitalize(notes.join(' → ')));
  const note = notes[0];
  // Слишком короткое пояснение («БП», «для удаления») дополняем самой командой.
  if (note.split(/\s+/).length < 3) return shorten(`${firstCmd} — ${note}`);
  return shorten(capitalize(note));
}

export function entryToRecord(e: ParsedEntry, opts: TxtImportOptions): CommandInput {
  const kind = opts.kind ?? 'switch';
  const cmdLines = e.lines.filter((l) => l.command);
  const command = cmdLines.map((l) => l.command).join('\n');
  const lineNotes: LineNote[] = [];
  cmdLines.forEach((l, index) => {
    if (l.note || l.prompt) lineNotes.push({ index, note: l.note ?? '', prompt: l.prompt });
  });
  const descParts: string[] = [];
  if (e.noteText) descParts.push(e.noteText);
  else if (e.heading) descParts.push(e.heading);
  if (cmdLines.length === 1 && cmdLines[0].note && !descParts.includes(cmdLines[0].note)) descParts.push(cmdLines[0].note);
  else if (cmdLines.length > 1) {
    for (const l of cmdLines) if (l.note) descParts.push(`${l.command} — ${l.note}`);
  }
  const description = descParts.join('\n');
  const risk = e.type === 'note' ? { level: 'info' as const } : classifyCommand(command, kind);
  const mode = cmdLines.some((l) => l.depth >= 1 || isConfT(l.command)) ? 'config' : kind === 'linux' ? 'shell' : 'exec';
  const category = kind === 'switch' ? categorizeSwitch(command || e.noteText || '', description) : 'other';
  const review = [...e.review];
  const tags: string[] = [];
  if (e.sectionHeader) tags.push(e.sectionHeader.replace(/^#+|#+$/g, '').trim());
  if (e.type === 'sequence') tags.push('последовательность');
  if (e.output.length) tags.push('пример вывода');
  const platformInfo = getPlatform(e.platform);
  return {
    uid: `${opts.sourceKey}:L${e.startLine}`,
    kind,
    entryType: e.type,
    platform: e.platform,
    vendorLabel: e.vendorLabel || platformInfo.name,
    category,
    title: entryTitle(e),
    command,
    description,
    details: {
      lineNotes: lineNotes.length ? lineNotes : undefined,
      exampleOutput: e.output.length ? e.output.map((o) => o.text).join('\n') : undefined,
      sectionHeader: e.sectionHeader,
      assumption: e.assumption
    },
    rawText: e.rawText,
    template: e.type === 'note' ? null : suggestTemplate(command, kind),
    risk: risk.level,
    riskManual: false,
    mode,
    source: opts.source,
    verified: false,
    needsReview: review.length > 0,
    reviewNote: review.length ? review.join('; ') : undefined,
    vendorUnknown: e.platform === UNKNOWN_PLATFORM,
    sensitive: e.sensitive,
    favorite: false,
    userModified: false,
    tags,
    originFile: opts.fileLabel,
    originLine: e.startLine
  };
}

/** Удобная функция: текст → записи + отчёт. */
export function importTxt(text: string, opts: TxtImportOptions, meta: { sha256?: string; encoding?: string } = {}) {
  const { entries, report } = parseTxt(text, opts, meta);
  const records = entries.map((e) => entryToRecord(e, opts));
  return { entries, records, report };
}

export function countCyrillic(s: string): number {
  return (s.match(CYR_G) ?? []).length;
}

export type { TxtReportIssue };
