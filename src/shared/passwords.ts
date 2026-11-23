// Менеджер паролей: общие типы, генератор паролей, оценка стойкости, разбор и запись CSV.
// Шифрование и хранение — в src/main/passwords.ts; здесь только код без доступа к ключу.

// ---------- Записи ----------

export interface PmHistoryItem {
  password: string;
  changedAt: string;
}

/** Расшифрованная запись (существует только в main-процессе, пока менеджер открыт). */
export interface PmEntryData {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  groupId: string | null;
  favorite: boolean;
  tags: string[];
  history: PmHistoryItem[];
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string;
}

/** Запись для списка: без пароля и заметок. */
export interface PmEntrySummary {
  id: string;
  title: string;
  username: string;
  url: string;
  groupId: string | null;
  favorite: boolean;
  tags: string[];
  hasPassword: boolean;
  hasNotes: boolean;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string;
  /** Оценка стойкости пароля в битах. */
  strength: number;
  weak: boolean;
  /** Такой же пароль есть в другой записи. */
  reused: boolean;
  historyCount: number;
}

/** Подробности записи для карточки: заметки и даты истории, но не пароли. */
export interface PmEntryDetails extends PmEntrySummary {
  notes: string;
  history: { changedAt: string }[];
}

export interface PmEntryInput {
  id?: string;
  title: string;
  username: string;
  /** undefined — оставить прежний пароль. */
  password?: string;
  url: string;
  notes: string;
  groupId: string | null;
  favorite: boolean;
  tags: string[];
}

export interface PmGroup {
  id: string;
  name: string;
  count: number;
}

export type PmLockReason = 'startup' | 'manual' | 'idle' | 'screen' | 'minimize' | 'quit' | 'reset';

export interface PmStatus {
  configured: boolean;
  unlocked: boolean;
  /** Число записей в базе (известно и без расшифровки). */
  entryCount: number;
  lockedReason: PmLockReason;
  /** Секунд до следующей попытки после нескольких неверных паролей. */
  retryAfterSec: number;
}

export interface PmSettings {
  /** Блокировать после стольких минут без действий в менеджере (0 — не блокировать). */
  autoLockMin: number;
  /** Очищать буфер обмена через столько секунд после копирования пароля (0 — не очищать). */
  clipboardClearSec: number;
  lockOnMinimize: boolean;
  lockOnScreenLock: boolean;
}

export const DEFAULT_PM: PmSettings = {
  autoLockMin: 10,
  clipboardClearSec: 20,
  lockOnMinimize: false,
  lockOnScreenLock: true
};

export function withPmDefaults(s: Partial<PmSettings> | null | undefined): PmSettings {
  const v = { ...DEFAULT_PM, ...(s ?? {}) };
  return {
    autoLockMin: clampInt(v.autoLockMin, 0, 1440, DEFAULT_PM.autoLockMin),
    clipboardClearSec: clampInt(v.clipboardClearSec, 0, 600, DEFAULT_PM.clipboardClearSec),
    lockOnMinimize: !!v.lockOnMinimize,
    lockOnScreenLock: v.lockOnScreenLock !== false
  };
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** Минимальная длина мастер-пароля и пароля зашифрованного экспорта. */
export const PM_MIN_MASTER = 8;
export const PM_LIMITS = { title: 500, username: 1000, password: 4096, url: 2000, notes: 100_000, tag: 60, tags: 30, group: 200, history: 10 };

// ---------- Импорт и экспорт ----------

export type PmExportFormat = 'nadpass' | 'csv';

export interface PmImportRow {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  group: string;
  favorite: boolean;
}

export interface PmImportPreviewRow {
  index: number;
  title: string;
  username: string;
  url: string;
  group: string;
  hasPassword: boolean;
  hasNotes: boolean;
  /** Запись с тем же названием, логином и адресом уже есть. */
  duplicate: boolean;
}

export interface PmImportPreview {
  token: string;
  file: string;
  kind: PmExportFormat;
  /** Для .nadpass — сначала нужен пароль файла. */
  needsPassword: boolean;
  /** Откуда, судя по столбцам, выгружен CSV (KeePassXC, Bitwarden…). */
  source: string;
  rows: PmImportPreviewRow[];
  groups: string[];
}

export interface PmImportOptions {
  /** Индексы выбранных строк предпросмотра. */
  indexes: number[];
  /** 'file' — папки из файла (создаются при необходимости), 'target' — всё в одну папку. */
  groupMode: 'file' | 'target';
  targetGroupId: string | null;
}

export interface PmImportResult {
  added: number;
  skipped: number;
  groupsCreated: number;
}

// ---------- Генератор паролей ----------

export interface PassGenOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** Исключить похожие символы: I l 1 O 0 o | */
  excludeAmbiguous: boolean;
}

export const DEFAULT_PASSGEN: PassGenOptions = { length: 20, lower: true, upper: true, digits: true, symbols: true, excludeAmbiguous: true };

// Без кавычек, обратной косой черты, пробела и «?»: «?» в CLI Cisco вызывает подсказку,
// а кавычки и «\» ломают конфигурационные файлы и командную строку.
const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>/~'
};
const AMBIGUOUS = /[Il1O0o|]/g;

function pools(o: PassGenOptions): string[] {
  const out: string[] = [];
  for (const k of ['lower', 'upper', 'digits', 'symbols'] as const) {
    if (!o[k]) continue;
    const s = o.excludeAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k];
    if (s) out.push(s);
  }
  return out;
}

export function normalizePassGen(o: Partial<PassGenOptions>): PassGenOptions {
  const v = { ...DEFAULT_PASSGEN, ...o };
  const r = { ...v, length: clampInt(v.length, 4, 128, DEFAULT_PASSGEN.length) };
  if (!r.lower && !r.upper && !r.digits && !r.symbols) r.lower = true;
  return r;
}

/**
 * Случайный пароль. randomInt(n) должен возвращать равномерное целое 0…n-1 из
 * криптографического генератора (crypto.getRandomValues / crypto.randomInt).
 * В пароле есть хотя бы один символ каждого выбранного набора (если длина позволяет).
 */
export function generatePassword(options: Partial<PassGenOptions>, randomInt: (n: number) => number): string {
  const o = normalizePassGen(options);
  const ps = pools(o);
  const all = ps.join('');
  for (let attempt = 0; attempt < 1000; attempt++) {
    let pw = '';
    for (let i = 0; i < o.length; i++) pw += all[randomInt(all.length)];
    if (o.length < ps.length || ps.every((p) => [...pw].some((ch) => p.includes(ch)))) return pw;
  }
  throw new Error('Не удалось сгенерировать пароль');
}

/** Энтропия сгенерированного пароля (биты): длина × log2(размер алфавита). */
export function generatorEntropy(options: Partial<PassGenOptions>): number {
  const o = normalizePassGen(options);
  return Math.round(o.length * Math.log2(pools(o).join('').length));
}

/** Равномерное случайное 0…n-1 через Web Crypto (интерфейс). */
export function webRandomInt(n: number): number {
  const c = (globalThis as unknown as { crypto: { getRandomValues(a: Uint32Array): Uint32Array } }).crypto;
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

// ---------- Оценка стойкости ----------

const COMMON = new Set([
  'password', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty', 'qwerty123', 'qwertyuiop', 'йцукен', 'пароль', 'admin', 'admin123', 'administrator',
  'root', 'toor', 'cisco', 'cisco123', 'letmein', 'welcome', 'changeme', 'default', 'secret', 'master', 'monkey', 'dragon', 'iloveyou',
  '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000', '123123', '654321', '1q2w3e', '1q2w3e4r', '1q2w3e4r5t',
  'zaq12wsx', 'asdfgh', 'abc123', 'user', 'guest', 'test', 'support', 'manager'
]);

export interface StrengthInfo {
  bits: number;
  /** 0 — очень слабый … 4 — отличный */
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
}

export const STRENGTH_LABELS = ['очень слабый', 'слабый', 'средний', 'хороший', 'отличный'];

/**
 * Приблизительная оценка: размер алфавита по найденным классам символов × «эффективная» длина
 * (повторы и последовательности вроде 123/abc считаются за половину символа), распространённые
 * пароли — очень слабые. Это оценка, а не гарантия.
 */
export function estimateStrength(pw: string): StrengthInfo {
  if (!pw) return { bits: 0, level: 0, label: STRENGTH_LABELS[0] };
  const chars = [...pw];
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9а-яёА-ЯЁ]/.test(pw)) pool += 33;
  if (/[а-яё]/.test(pw)) pool += 33;
  if (/[А-ЯЁ]/.test(pw)) pool += 33;
  let eff = 0;
  for (let i = 0; i < chars.length; i++) {
    const prev = i > 0 ? chars[i - 1].codePointAt(0)! : NaN;
    const cur = chars[i].codePointAt(0)!;
    eff += i > 0 && (cur === prev || cur === prev + 1 || cur === prev - 1) ? 0.5 : 1;
  }
  let bits = Math.round(eff * Math.log2(Math.max(pool, 2)));
  const base = pw.toLowerCase().replace(/[\d!@#$%^&*._-]+$/, '');
  if (COMMON.has(pw.toLowerCase()) || (base.length >= 4 && COMMON.has(base))) bits = Math.min(bits, 12);
  const level: StrengthInfo['level'] = bits < 28 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, level, label: STRENGTH_LABELS[level] };
}

// ---------- CSV ----------

/** Разделитель по первой строке (вне кавычек): запятая, точка с запятой или табуляция. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of text.replace(/^﻿/, '')) {
    if (ch === '"') q = !q;
    else if (!q && (ch === '\n' || ch === '\r')) break;
    else if (!q && ch in counts) counts[ch as keyof typeof counts]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/** Разбор CSV по RFC 4180: кавычки, удвоенные кавычки, переводы строк внутри полей, CRLF. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(s);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function toCsv(rows: string[][], delimiter = ','): string {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(esc).join(delimiter)).join('\r\n') + '\r\n';
}

/** Столбцы экспорта CSV — как у KeePassXC (его импорт CSV их понимает). */
export const PM_CSV_HEADERS = ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes', 'Last Modified', 'Created'];

const COLUMN_NAMES: Record<keyof Omit<PmImportRow, 'favorite'> | 'favorite' | 'type', string[]> = {
  title: ['title', 'name', 'account', 'entry', 'название', 'имя записи', 'заголовок', 'запись'],
  username: ['username', 'user name', 'login name', 'login', 'login_username', 'user', 'логин', 'пользователь', 'имя пользователя'],
  password: ['password', 'login_password', 'pass', 'пароль'],
  url: ['url', 'web site', 'website', 'login_uri', 'uri', 'адрес', 'сайт', 'ссылка'],
  notes: ['notes', 'note', 'comments', 'comment', 'extra', 'заметки', 'заметка', 'примечание', 'комментарий'],
  group: ['group', 'folder', 'grouping', 'path', 'папка', 'группа'],
  favorite: ['favorite', 'fav', 'избранное'],
  type: ['type']
};

function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(url.trim());
  return m ? m[1] : '';
}

/**
 * Сопоставляет столбцы CSV полям записи по заголовку. Понимает выгрузки KeePass, KeePassXC,
 * Bitwarden, Chrome/Edge, Firefox, LastPass и NetAdmin Desk. Без столбца пароля — ошибка.
 */
export function mapCsvRows(table: string[][]): { rows: PmImportRow[]; source: string } {
  if (table.length === 0) throw new Error('Файл пуст');
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (k: keyof typeof COLUMN_NAMES) => {
    for (const name of COLUMN_NAMES[k]) {
      const i = header.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const idx = { title: col('title'), username: col('username'), password: col('password'), url: col('url'), notes: col('notes'), group: col('group'), favorite: col('favorite'), type: col('type') };
  if (idx.password < 0) throw new Error('В первой строке CSV не найден столбец с паролем (Password, login_password, Пароль…). Проверьте, что файл выгружен с заголовками.');
  const has = (h: string) => header.includes(h);
  const source = has('login_uri')
    ? 'Bitwarden'
    : has('httprealm')
      ? 'Firefox'
      : has('grouping') && has('extra')
        ? 'LastPass'
        : has('account') && has('login name')
          ? 'KeePass'
          : has('totp') && has('group') && has('title')
            ? 'KeePassXC'
            : has('group') && has('title') && has('last modified')
              ? 'NetAdmin Desk / KeePassXC'
              : has('name') && has('url') && has('username') && !has('group')
                ? 'Chrome / Edge'
                : 'CSV';
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const rows: PmImportRow[] = [];
  for (const r of table.slice(1)) {
    const password = idx.password >= 0 ? r[idx.password] ?? '' : '';
    const url = get(r, idx.url);
    const username = get(r, idx.username);
    let group = get(r, idx.group).replace(/\\/g, '/');
    group = group.replace(/^root(\/|$)/i, '').replace(/^\/+|\/+$/g, '');
    const fav = get(r, idx.favorite).toLowerCase();
    const row: PmImportRow = {
      title: get(r, idx.title) || hostOf(url) || username || 'Без названия',
      username,
      password,
      url,
      notes: idx.notes >= 0 ? (r[idx.notes] ?? '').trim() : '',
      group,
      favorite: fav === '1' || fav === 'true' || fav === 'да'
    };
    if (!row.password && !row.username && !row.url && !row.notes && row.title === 'Без названия') continue;
    rows.push(row);
  }
  return { rows, source };
}

/** Ключ для поиска дубликатов при импорте. */
export function duplicateKey(e: { title: string; username: string; url: string }): string {
  return [e.title, e.username, e.url].map((s) => s.trim().toLowerCase()).join('\u0001');
}
