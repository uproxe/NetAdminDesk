// Менеджер паролей (по образцу KeePass): отдельный мастер-пароль, ключ scrypt, каждая запись и
// название папки зашифрованы AES-256-GCM с привязкой к идентификатору строки (AAD).
// Ключ и расшифрованные записи живут только в памяти main-процесса, пока менеджер открыт;
// при блокировке ключ затирается, а скопированный пароль убирается из буфера обмена.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { decodeText } from '../shared/txtImport';
import type { AppDatabase } from './db/database';
import { deriveKeyAsync, open, seal, type KdfParams, type Sealed } from './crypto';
import {
  PM_CSV_HEADERS,
  PM_LIMITS,
  PM_MIN_MASTER,
  duplicateKey,
  estimateStrength,
  mapCsvRows,
  parseCsv,
  toCsv,
  type PmEntryData,
  type PmEntryDetails,
  type PmEntryInput,
  type PmEntrySummary,
  type PmGroup,
  type PmImportOptions,
  type PmImportPreview,
  type PmImportResult,
  type PmImportRow,
  type PmLockReason,
  type PmStatus
} from '../shared/passwords';

const META_KEY = 'pm_master';
const CHECK_TEXT = 'netadmin-desk-password-manager';
const CHECK_AAD = 'nad-pm:check';
const entryAad = (uid: string) => `nad-pm:entry:${uid}`;
const groupAad = (uid: string) => `nad-pm:group:${uid}`;

export const PM_FILE_FORMAT = 'netadmin-desk-passwords';
export const PM_FILE_VERSION = 1;
/** scrypt N=2^17, r=8: ~128 МБ памяти и порядка секунды на вычисление ключа — как у KeePass по умолчанию. */
export const PM_KDF = { N: 1 << 17, r: 8, p: 1 };

interface MasterMeta {
  version: 1;
  kdf: KdfParams;
  check: Sealed;
  createdAt: string;
}

interface GroupData {
  name: string;
  createdAt: string;
}

interface ExportPayload {
  groups: { name: string }[];
  entries: (Omit<PmEntryData, 'groupId'> & { group: string })[];
}

interface PmFile {
  format: typeof PM_FILE_FORMAT;
  version: number;
  appVersion: string;
  createdAt: string;
  count: number;
  kdf: KdfParams;
  cipher: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

interface PendingImport {
  file: string;
  kind: 'nadpass' | 'csv';
  source: string;
  raw?: PmFile;
  rows?: PmImportRow[];
  createdAt: number;
}

export interface PasswordStoreDeps {
  now?: () => number;
  clipboard?: { writeText(t: string): void; readText(): string };
  /** Параметры scrypt для новых мастер-паролей и файлов (в тестах — облегчённые). */
  kdf?: { N: number; r: number; p: number };
  appVersion?: string;
  onLock?: (reason: PmLockReason) => void;
}

export class PasswordLockedError extends Error {
  constructor() {
    super('Менеджер паролей заблокирован. Введите мастер-пароль.');
    this.name = 'PasswordLockedError';
  }
}

/** Самый большой файл, который принимает импорт (экспорт KeePassXC на 10 000 записей ≈ 3 МБ). */
export const PM_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

export class PasswordStore {
  private key: Buffer | null = null;
  private entries = new Map<string, PmEntryData>();
  private groups = new Map<string, GroupData>();
  private lastActivity = 0;
  private failures = 0;
  private retryAt = 0;
  private lockedReason: PmLockReason = 'startup';
  /**
   * Номер сеанса: растёт при каждой блокировке. Долгие операции (scrypt идёт в фоне)
   * запоминают его до await и после проверяют, что за это время не было блокировки —
   * иначе смена мастер-пароля упала бы на стёртом ключе, а экспорт записал бы пустой файл.
   */
  private epoch = 0;
  private imports = new Map<string, PendingImport>();
  private copied: { value: string; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private readonly now: () => number;
  private readonly kdfParams: { N: number; r: number; p: number };

  constructor(private db: AppDatabase, private deps: PasswordStoreDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.kdfParams = deps.kdf ?? PM_KDF;
  }

  // ---------- Мастер-пароль, открытие и блокировка ----------

  private meta(): MasterMeta | null {
    const raw = this.db.getMeta(META_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MasterMeta;
    } catch {
      return null;
    }
  }

  private newKdf(): KdfParams {
    return { name: 'scrypt', ...this.kdfParams, salt: randomBytes(16).toString('base64') };
  }

  status(): PmStatus {
    return {
      configured: !!this.meta(),
      unlocked: !!this.key,
      entryCount: this.key ? this.entries.size : this.db.pmCount(),
      lockedReason: this.lockedReason,
      retryAfterSec: Math.max(0, Math.ceil((this.retryAt - this.now()) / 1000))
    };
  }

  isUnlocked(): boolean {
    return !!this.key;
  }

  async setup(password: string): Promise<PmStatus> {
    if (this.meta()) throw new Error('Мастер-пароль уже создан');
    checkMaster(password);
    const kdf = this.newKdf();
    const key = await deriveKeyAsync(password, kdf);
    if (this.meta()) {
      // второй одновременный вызов (двойное нажатие «Создать»)
      key.fill(0);
      throw new Error('Мастер-пароль уже создан');
    }
    const meta: MasterMeta = { version: 1, kdf, check: seal(key, CHECK_TEXT, CHECK_AAD), createdAt: new Date(this.now()).toISOString() };
    this.db.setMeta(META_KEY, JSON.stringify(meta));
    this.key = key;
    this.entries.clear();
    this.groups.clear();
    this.touch();
    return this.status();
  }

  async unlock(password: string): Promise<PmStatus> {
    const meta = this.meta();
    if (!meta) throw new Error('Мастер-пароль ещё не создан');
    if (this.key) return this.status();
    const wait = Math.ceil((this.retryAt - this.now()) / 1000);
    if (wait > 0) throw new Error(`Слишком много неверных попыток. Подождите ${wait} с.`);
    const epoch = this.epoch;
    const key = await deriveKeyAsync(String(password ?? ''), meta.kdf);
    if (this.key) {
      // параллельный вызов уже открыл менеджер
      key.fill(0);
      return this.status();
    }
    if (epoch !== this.epoch) {
      // пока вычислялся ключ, экран заблокировали или окно свернули — не открываем
      key.fill(0);
      throw new Error('Разблокировка прервана: экран был заблокирован или окно свёрнуто. Введите мастер-пароль ещё раз.');
    }
    try {
      if (open(key, meta.check, CHECK_AAD).toString('utf8') !== CHECK_TEXT) throw new Error();
    } catch {
      key.fill(0);
      this.failures++;
      // После трёх ошибок — пауза 1, 2, 4… до 30 с (от подбора через интерфейс; от подбора
      // по копии базы защищает стоимость scrypt).
      if (this.failures >= 3) this.retryAt = this.now() + Math.min(30, 2 ** (this.failures - 3)) * 1000;
      throw new Error('Неверный мастер-пароль');
    }
    const entries = new Map<string, PmEntryData>();
    const groups = new Map<string, GroupData>();
    try {
      for (const r of this.db.pmRows('pm_groups')) groups.set(r.uid, JSON.parse(open(key, JSON.parse(r.blob), groupAad(r.uid)).toString('utf8')));
      for (const r of this.db.pmRows('pm_entries')) entries.set(r.uid, normalizeData(JSON.parse(open(key, JSON.parse(r.blob), entryAad(r.uid)).toString('utf8'))));
    } catch {
      key.fill(0);
      throw new Error('Не удалось расшифровать записи: база менеджера паролей повреждена или изменена');
    }
    this.key = key;
    this.entries = entries;
    this.groups = groups;
    this.failures = 0;
    this.retryAt = 0;
    this.touch();
    return this.status();
  }

  lock(reason: PmLockReason = 'manual'): void {
    const wasUnlocked = !!this.key;
    this.epoch++;
    if (this.key) this.key.fill(0);
    this.key = null;
    this.entries = new Map();
    this.groups = new Map();
    this.imports.clear();
    this.clearClipboardNow();
    this.lockedReason = reason;
    if (wasUnlocked) this.deps.onLock?.(reason);
  }

  async changeMaster(current: string, next: string): Promise<void> {
    const meta = this.meta();
    if (!meta) throw new Error('Мастер-пароль ещё не создан');
    this.requireKey();
    checkMaster(next);
    const epoch = this.epoch;
    const curKey = await deriveKeyAsync(String(current ?? ''), meta.kdf);
    try {
      open(curKey, meta.check, CHECK_AAD);
    } catch {
      throw new Error('Текущий мастер-пароль указан неверно');
    } finally {
      curKey.fill(0);
    }
    this.stillOpen(epoch);
    const kdf = this.newKdf();
    const key = await deriveKeyAsync(next, kdf);
    let oldKey: Buffer;
    try {
      oldKey = this.stillOpen(epoch);
    } catch (e) {
      key.fill(0);
      throw e;
    }
    const newMeta: MasterMeta = { version: 1, kdf, check: seal(key, CHECK_TEXT, CHECK_AAD), createdAt: meta.createdAt };
    this.db.tx(() => {
      for (const [uid, g] of this.groups) this.db.pmPut('pm_groups', uid, JSON.stringify(seal(key, JSON.stringify(g), groupAad(uid))));
      for (const [uid, e] of this.entries) this.db.pmPut('pm_entries', uid, JSON.stringify(seal(key, JSON.stringify(e), entryAad(uid))));
      this.db.setMeta(META_KEY, JSON.stringify(newMeta));
    });
    oldKey.fill(0);
    this.key = key;
    this.touch();
  }

  /** Удалить все записи и мастер-пароль (если мастер-пароль забыт). */
  reset(confirm: string): void {
    if (confirm !== 'УДАЛИТЬ') throw new Error('Для удаления введите слово УДАЛИТЬ');
    this.db.tx(() => this.db.pmClear());
    this.lock('reset');
  }

  touch(): void {
    this.lastActivity = this.now();
  }

  /** Вызывается по таймеру: блокирует после autoLockMin минут без действий. */
  tick(autoLockMin: number): void {
    if (this.key && autoLockMin > 0 && this.now() - this.lastActivity >= autoLockMin * 60_000) this.lock('idle');
  }

  private requireKey(): Buffer {
    if (!this.key) throw new PasswordLockedError();
    this.touch();
    return this.key;
  }

  /** После await: если менеджер успели заблокировать — прервать операцию. */
  private stillOpen(epoch: number): Buffer {
    if (epoch !== this.epoch || !this.key) throw new PasswordLockedError();
    return this.key;
  }

  // ---------- Записи ----------

  private persistEntry(uid: string, e: PmEntryData): void {
    const key = this.requireKey();
    this.db.pmPut('pm_entries', uid, JSON.stringify(seal(key, JSON.stringify(e), entryAad(uid))));
    this.entries.set(uid, e);
  }

  private persistGroup(uid: string, g: GroupData): void {
    const key = this.requireKey();
    this.db.pmPut('pm_groups', uid, JSON.stringify(seal(key, JSON.stringify(g), groupAad(uid))));
    this.groups.set(uid, g);
  }

  private summaries(): PmEntrySummary[] {
    const uses = new Map<string, number>();
    for (const e of this.entries.values()) if (e.password) uses.set(e.password, (uses.get(e.password) ?? 0) + 1);
    return [...this.entries].map(([id, e]) => summary(id, e, (uses.get(e.password) ?? 0) > 1));
  }

  list(): { groups: PmGroup[]; entries: PmEntrySummary[] } {
    this.requireKey();
    const counts = new Map<string, number>();
    for (const e of this.entries.values()) if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) ?? 0) + 1);
    const groups = [...this.groups].map(([id, g]) => ({ id, name: g.name, count: counts.get(id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const entries = this.summaries().sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    return { groups, entries };
  }

  get(id: string): PmEntryDetails {
    this.requireKey();
    const e = this.entry(id);
    const s = this.summaries().find((x) => x.id === id)!;
    return { ...s, notes: e.notes, history: e.history.map((h) => ({ changedAt: h.changedAt })) };
  }

  /** Пароль записи (или из истории — historyIndex) — только по явному действию «Показать» или для редактирования. */
  reveal(id: string, historyIndex?: number): string {
    this.requireKey();
    const e = this.entry(id);
    if (historyIndex === undefined || historyIndex === null) return e.password;
    const h = e.history[historyIndex];
    if (!h) throw new Error('Нет такой записи в истории паролей');
    return h.password;
  }

  private entry(id: string): PmEntryData {
    const e = this.entries.get(String(id));
    if (!e) throw new Error('Запись не найдена');
    return e;
  }

  save(input: PmEntryInput): PmEntrySummary {
    this.requireKey();
    const v = validateInput(input);
    if (v.groupId && !this.groups.has(v.groupId)) throw new Error('Папка не найдена');
    const ts = new Date(this.now()).toISOString();
    const id = input.id ? String(input.id) : randomUUID();
    const prev = input.id ? this.entry(id) : null;
    let password = prev?.password ?? '';
    let history = prev?.history ?? [];
    let passwordChangedAt = prev?.passwordChangedAt ?? ts;
    if (v.password !== undefined && v.password !== password) {
      if (prev && password) history = [{ password, changedAt: ts }, ...history].slice(0, PM_LIMITS.history);
      password = v.password;
      passwordChangedAt = ts;
    }
    const data: PmEntryData = {
      title: v.title,
      username: v.username,
      password,
      url: v.url,
      notes: v.notes,
      groupId: v.groupId,
      favorite: v.favorite,
      tags: v.tags,
      history,
      createdAt: prev?.createdAt ?? ts,
      updatedAt: ts,
      passwordChangedAt
    };
    this.persistEntry(id, data);
    return this.summaries().find((x) => x.id === id)!;
  }

  remove(id: string): void {
    this.requireKey();
    this.entry(id);
    this.db.pmDelete('pm_entries', String(id));
    this.entries.delete(String(id));
  }

  saveGroup(g: { id?: string; name: string }): PmGroup {
    this.requireKey();
    const name = String(g.name ?? '').trim().slice(0, PM_LIMITS.group);
    if (!name) throw new Error('Укажите название папки');
    const id = g.id ? String(g.id) : randomUUID();
    const prev = g.id ? this.groups.get(id) : undefined;
    if (g.id && !prev) throw new Error('Папка не найдена');
    const dup = [...this.groups].find(([gid, x]) => gid !== id && x.name.toLowerCase() === name.toLowerCase());
    if (dup) throw new Error(`Папка «${dup[1].name}» уже есть`);
    this.persistGroup(id, { name, createdAt: prev?.createdAt ?? new Date(this.now()).toISOString() });
    return { id, name, count: [...this.entries.values()].filter((e) => e.groupId === id).length };
  }

  /** Удаляет папку; записи из неё остаются без папки. */
  removeGroup(id: string): void {
    this.requireKey();
    if (!this.groups.has(String(id))) throw new Error('Папка не найдена');
    this.db.tx(() => {
      for (const [uid, e] of this.entries) if (e.groupId === id) this.persistEntry(uid, { ...e, groupId: null });
      this.db.pmDelete('pm_groups', String(id));
    });
    this.groups.delete(String(id));
  }

  // ---------- Буфер обмена ----------

  /** Копирует поле записи; пароль удаляется из буфера через clearSec секунд, если его не заменили. */
  copy(id: string, field: 'password' | 'username' | 'url', clearSec: number, historyIndex?: number): { clearAfterSec: number } {
    this.requireKey();
    const e = this.entry(id);
    const value = field === 'password' ? this.reveal(id, historyIndex) : field === 'username' ? e.username : e.url;
    return this.copyValue(value, field === 'password' ? clearSec : 0);
  }

  copyValue(value: string, clearSec: number): { clearAfterSec: number } {
    const cb = this.deps.clipboard;
    if (!cb) throw new Error('Буфер обмена недоступен');
    this.clearClipboardTimer();
    cb.writeText(String(value ?? ''));
    if (clearSec > 0 && value) {
      const timer = setTimeout(() => this.clearClipboardNow(), clearSec * 1000);
      (timer as { unref?: () => void }).unref?.();
      this.copied = { value, timer };
      return { clearAfterSec: clearSec };
    }
    return { clearAfterSec: 0 };
  }

  private clearClipboardTimer(): void {
    if (this.copied?.timer) clearTimeout(this.copied.timer);
    this.copied = null;
  }

  /** Убирает из буфера скопированный пароль (если в буфере всё ещё он). */
  clearClipboardNow(): void {
    const c = this.copied;
    this.clearClipboardTimer();
    if (!c || !this.deps.clipboard) return;
    try {
      if (this.deps.clipboard.readText() === c.value) this.deps.clipboard.writeText('');
    } catch {
      /* буфер недоступен */
    }
  }

  // ---------- Экспорт ----------

  private exportPayload(): ExportPayload {
    const names = new Map([...this.groups].map(([id, g]) => [id, g.name]));
    return {
      groups: [...this.groups.values()].map((g) => ({ name: g.name })),
      entries: [...this.entries.values()].map(({ groupId, ...e }) => ({ ...e, group: groupId ? names.get(groupId) ?? '' : '' }))
    };
  }

  /** Зашифрованный файл .nadpass (пароль файла задаётся отдельно, не короче 8 символов). */
  async exportNadpass(password: string): Promise<{ content: string; count: number }> {
    this.requireKey();
    if (!password || password.length < PM_MIN_MASTER) throw new Error(`Пароль файла должен быть не короче ${PM_MIN_MASTER} символов`);
    const epoch = this.epoch;
    const kdf = this.newKdf();
    const key = await deriveKeyAsync(password, kdf);
    try {
      this.stillOpen(epoch);
    } catch (e) {
      key.fill(0);
      throw e;
    }
    const payload = this.exportPayload();
    const sealed = seal(key, JSON.stringify(payload), PM_FILE_FORMAT);
    key.fill(0);
    const file: PmFile = {
      format: PM_FILE_FORMAT,
      version: PM_FILE_VERSION,
      appVersion: this.deps.appVersion ?? '',
      createdAt: new Date(this.now()).toISOString(),
      count: payload.entries.length,
      kdf,
      cipher: 'aes-256-gcm',
      ...sealed
    };
    return { content: JSON.stringify(file, null, 1), count: payload.entries.length };
  }

  /** CSV без шифрования — только после повторного ввода мастер-пароля. */
  async exportCsv(masterPassword: string): Promise<{ content: string; count: number }> {
    this.requireKey();
    const epoch = this.epoch;
    await this.verifyMaster(masterPassword);
    this.stillOpen(epoch);
    const p = this.exportPayload();
    const rows = [PM_CSV_HEADERS, ...p.entries.map((e) => [e.group, e.title, e.username, e.password, e.url, e.notes, e.updatedAt, e.createdAt])];
    return { content: '﻿' + toCsv(rows), count: p.entries.length };
  }

  private async verifyMaster(password: string): Promise<void> {
    const meta = this.meta();
    if (!meta) throw new Error('Мастер-пароль ещё не создан');
    const key = await deriveKeyAsync(String(password ?? ''), meta.kdf);
    try {
      open(key, meta.check, CHECK_AAD);
    } catch {
      throw new Error('Мастер-пароль указан неверно');
    } finally {
      key.fill(0);
    }
  }

  // ---------- Импорт ----------

  /** Читает файл и готовит предпросмотр. Для .nadpass записи появятся после ввода пароля файла. */
  importOpen(path: string): PmImportPreview {
    this.requireKey();
    if (statSync(path).size > PM_IMPORT_MAX_BYTES) throw new Error(`Файл больше ${PM_IMPORT_MAX_BYTES / 1024 / 1024} МБ — это не похоже на выгрузку паролей`);
    // Excel в русской Windows сохраняет CSV в Windows-1251, KeePass и браузеры — в UTF-8
    const { text } = decodeText(readFileSync(path));
    const file = path.split(/[\\/]/).pop() ?? path;
    const token = randomUUID();
    let parsed: unknown = null;
    if (/^\s*\{/.test(text)) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (parsed && (parsed as PmFile).format === PM_FILE_FORMAT) {
      const raw = parsed as PmFile;
      if (raw.version > PM_FILE_VERSION) throw new Error(`Файл создан более новой версией программы (формат ${raw.version})`);
      this.imports.set(token, { file, kind: 'nadpass', source: 'NetAdmin Desk', raw, createdAt: this.now() });
      return { token, file, kind: 'nadpass', needsPassword: true, source: 'NetAdmin Desk', rows: [], groups: [] };
    }
    if (parsed) throw new Error('Это JSON, но не файл менеджера паролей NetAdmin Desk (.nadpass). Поддерживаются .nadpass и CSV.');
    const { rows, source } = mapCsvRows(parseCsv(text));
    if (!rows.length) throw new Error('В файле нет записей');
    this.imports.set(token, { file, kind: 'csv', source, rows, createdAt: this.now() });
    return this.preview(token);
  }

  async importDecrypt(token: string, password: string): Promise<PmImportPreview> {
    this.requireKey();
    const p = this.imports.get(token);
    if (!p || !p.raw) throw new Error('Импорт не найден — откройте файл заново');
    let payload: ExportPayload;
    const epoch = this.epoch;
    const key = await deriveKeyAsync(String(password ?? ''), p.raw.kdf);
    try {
      this.stillOpen(epoch);
    } catch (e) {
      key.fill(0);
      throw e;
    }
    try {
      payload = JSON.parse(open(key, p.raw, PM_FILE_FORMAT).toString('utf8'));
    } catch {
      throw new Error('Неверный пароль файла или файл повреждён');
    } finally {
      key.fill(0);
    }
    p.rows = (payload.entries ?? []).map((e) => ({
      title: String(e.title ?? ''),
      username: String(e.username ?? ''),
      password: String(e.password ?? ''),
      url: String(e.url ?? ''),
      notes: String(e.notes ?? ''),
      group: String(e.group ?? ''),
      favorite: !!e.favorite
    }));
    return this.preview(token);
  }

  private preview(token: string): PmImportPreview {
    const p = this.imports.get(token)!;
    const existing = new Set([...this.entries.values()].map(duplicateKey));
    const rows = (p.rows ?? []).map((r, index) => ({
      index,
      title: r.title,
      username: r.username,
      url: r.url,
      group: r.group,
      hasPassword: !!r.password,
      hasNotes: !!r.notes,
      duplicate: existing.has(duplicateKey(r))
    }));
    const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    return { token, file: p.file, kind: p.kind, needsPassword: false, source: p.source, rows, groups };
  }

  importCommit(token: string, o: PmImportOptions): PmImportResult {
    this.requireKey();
    const p = this.imports.get(token);
    if (!p?.rows) throw new Error('Импорт не найден — откройте файл заново');
    if (o.groupMode === 'target' && o.targetGroupId && !this.groups.has(o.targetGroupId)) throw new Error('Папка не найдена');
    const chosen = new Set((o.indexes ?? []).map(Number));
    let added = 0;
    let groupsCreated = 0;
    const byName = new Map([...this.groups].map(([id, g]) => [g.name.toLowerCase(), id]));
    const ts = new Date(this.now()).toISOString();
    this.db.tx(() => {
      p.rows!.forEach((r, i) => {
        if (!chosen.has(i)) return;
        let groupId: string | null = null;
        if (o.groupMode === 'target') groupId = o.targetGroupId ?? null;
        else if (r.group) {
          const name = r.group.slice(0, PM_LIMITS.group);
          groupId = byName.get(name.toLowerCase()) ?? null;
          if (!groupId) {
            groupId = randomUUID();
            this.persistGroup(groupId, { name, createdAt: ts });
            byName.set(name.toLowerCase(), groupId);
            groupsCreated++;
          }
        }
        const v = validateInput({ title: r.title, username: r.username, password: r.password, url: r.url, notes: r.notes, groupId, favorite: r.favorite, tags: [] });
        this.persistEntry(randomUUID(), {
          title: v.title,
          username: v.username,
          password: v.password ?? '',
          url: v.url,
          notes: v.notes,
          groupId,
          favorite: v.favorite,
          tags: [],
          history: [],
          createdAt: ts,
          updatedAt: ts,
          passwordChangedAt: ts
        });
        added++;
      });
    });
    this.imports.delete(token);
    return { added, skipped: p.rows.length - added, groupsCreated };
  }

  importCancel(token: string): void {
    this.imports.delete(token);
  }
}

// ---------- Вспомогательное ----------

function checkMaster(password: string): void {
  if (typeof password !== 'string' || password.length < PM_MIN_MASTER) throw new Error(`Мастер-пароль должен быть не короче ${PM_MIN_MASTER} символов`);
  if (password.length > 1024) throw new Error('Мастер-пароль слишком длинный');
}

function str(v: unknown, max: number, label: string): string {
  const s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  if (s.length > max) throw new Error(`${label}: слишком длинное значение (больше ${max} символов)`);
  return s;
}

function validateInput(input: PmEntryInput): Omit<PmEntryInput, 'id'> {
  const title = str(input.title, PM_LIMITS.title, 'Название').trim();
  if (!title) throw new Error('Укажите название записи');
  return {
    title,
    username: str(input.username, PM_LIMITS.username, 'Логин'),
    password: input.password === undefined ? undefined : str(input.password, PM_LIMITS.password, 'Пароль'),
    url: str(input.url, PM_LIMITS.url, 'Адрес').trim(),
    notes: str(input.notes, PM_LIMITS.notes, 'Заметки'),
    groupId: input.groupId ? String(input.groupId) : null,
    favorite: !!input.favorite,
    tags: [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => String(t).trim().slice(0, PM_LIMITS.tag)).filter(Boolean))].slice(0, PM_LIMITS.tags)
  };
}

function normalizeData(d: Partial<PmEntryData>): PmEntryData {
  const ts = d.updatedAt ?? new Date().toISOString();
  return {
    title: String(d.title ?? ''),
    username: String(d.username ?? ''),
    password: String(d.password ?? ''),
    url: String(d.url ?? ''),
    notes: String(d.notes ?? ''),
    groupId: d.groupId ?? null,
    favorite: !!d.favorite,
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    history: Array.isArray(d.history) ? d.history.map((h) => ({ password: String(h.password ?? ''), changedAt: String(h.changedAt ?? ts) })) : [],
    createdAt: d.createdAt ?? ts,
    updatedAt: ts,
    passwordChangedAt: d.passwordChangedAt ?? d.createdAt ?? ts
  };
}

function summary(id: string, e: PmEntryData, reused: boolean): PmEntrySummary {
  const st = estimateStrength(e.password);
  return {
    id,
    title: e.title,
    username: e.username,
    url: e.url,
    groupId: e.groupId,
    favorite: e.favorite,
    tags: e.tags,
    hasPassword: !!e.password,
    hasNotes: !!e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    passwordChangedAt: e.passwordChangedAt,
    strength: st.bits,
    weak: !!e.password && st.level <= 1,
    reused: !!e.password && reused,
    historyCount: e.history.length
  };
}
