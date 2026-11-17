// Импорт и экспорт: TXT, JSON, CSV (устройства), ~/.ssh/config, зашифрованный перенос всех данных.
// Принципы: существующие записи автоматически не удаляются; конфликты показываются пользователю;
// секреты из CSV/SSH config без явного согласия не импортируются.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppDatabase } from './db/database';
import type { Vault, SecretKind } from './vault';
import type { CommandInput, CommandKind, CommandRecord, Device, DeviceInput, Scenario } from '../shared/types';
import type { DevicesExportOptions, DevicesFilePreview, DevicesPreview, EncryptedPreview, JsonPreview } from '../shared/ipc';
import { DEVICE_TYPES, getPlatform } from '../shared/platforms';
import { SCHEMA_VERSION } from './db/schema';
import { decryptBundle, encryptBundle, type EncryptedBundle } from './crypto';
import { atomicWrite } from './db/driver';
import { decodeText } from '../shared/txtImport';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export const JSON_FORMAT = 'netadmin-desk-json';

// ---------- TXT ----------

export function exportTxt(db: AppDatabase, path: string, opts: { kinds: CommandKind[]; sources?: string[] }): number {
  const cmds = db
    .listCommands()
    .filter((c) => opts.kinds.includes(c.kind) && (!opts.sources?.length || opts.sources.includes(c.source)) && !c.sensitive);
  const byVendor = new Map<string, CommandRecord[]>();
  for (const c of cmds) {
    const key = c.vendorLabel || getPlatform(c.platform).name;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(c);
  }
  const out: string[] = [`# Экспорт NetAdmin Desk ${APP_VERSION}, ${new Date().toISOString()}`, '# Записи с пометкой «чувствительные данные» не экспортируются.', ''];
  for (const [vendor, list] of byVendor) {
    out.push(`###${vendor}###`, '');
    for (const c of list) {
      if (c.rawText) {
        out.push(c.rawText.replace(/\r\n?/g, '\n'), '');
        continue;
      }
      const lines = c.command.split('\n');
      if (c.entryType === 'note') out.push(c.description || c.title, '');
      else if (lines.length === 1) out.push(c.description ? `${lines[0]} - ${c.description.replace(/\n/g, ' ')}` : lines[0], '');
      else out.push(c.title, ...lines, '');
    }
  }
  atomicWrite(path, out.join('\r\n'));
  return cmds.length;
}

// ---------- JSON ----------

interface JsonPayload {
  format: string;
  version: number;
  /** 'devices' — файл переноса устройств (раздел «Устройства → Экспорт»); иначе — экспорт данных или полная копия. */
  content?: 'devices' | 'data' | 'full';
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  commands: CommandRecord[];
  scenarios: Scenario[];
  notes: { title: string; body: string; tags: string[] }[];
  groups: { id: number; name: string; parentId: number | null; kind: 'group' | 'folder'; sort: number }[];
  devices: Device[];
  profiles: ReturnType<AppDatabase['listProfileOverrides']>;
  templateParams: ReturnType<AppDatabase['listTemplateParams']>;
  customPlatforms: ReturnType<AppDatabase['listCustomPlatforms']>;
  knownHosts?: ReturnType<AppDatabase['listKnownHosts']>;
  settings?: ReturnType<AppDatabase['getSettings']>;
  history?: ReturnType<AppDatabase['listHistory']>;
  secrets?: { deviceId: number; kind: SecretKind; value: string }[];
}

export function buildPayload(db: AppDatabase, full: boolean, opts: { includeHistory?: boolean; vault?: Vault } = {}): JsonPayload {
  const commands = db.listCommands().filter((c) => full || c.source !== 'builtin' || c.userModified || c.favorite || c.verified);
  const scenarios = db.listScenarios().filter((s) => full || !s.builtin);
  const p: JsonPayload = {
    format: JSON_FORMAT,
    version: 1,
    content: full ? 'full' : 'data',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    commands,
    scenarios,
    notes: db.listNotes().map((n) => ({ title: n.title, body: n.body, tags: n.tags })),
    groups: db.listGroups(),
    devices: db.listDevices(),
    profiles: db.listProfileOverrides(),
    templateParams: db.listTemplateParams(),
    customPlatforms: db.listCustomPlatforms()
  };
  if (full) {
    p.knownHosts = db.listKnownHosts();
    p.settings = db.getSettings();
    if (opts.includeHistory) p.history = db.listHistory({ limit: 100000 });
    if (opts.vault) p.secrets = opts.vault.readAll();
  }
  return p;
}

export function exportJson(db: AppDatabase, path: string): number {
  const p = buildPayload(db, false);
  atomicWrite(path, JSON.stringify(p, null, 2));
  return p.commands.length + p.scenarios.length + p.devices.length + p.notes.length;
}

function readJson(path: string): JsonPayload {
  const { text } = decodeText(readFileSync(path));
  let data: JsonPayload;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON');
  }
  if (data.format !== JSON_FORMAT) throw new Error('Это не файл экспорта NetAdmin Desk');
  if (data.schemaVersion > SCHEMA_VERSION) throw new Error(`Файл создан более новой версией программы (схема ${data.schemaVersion})`);
  return data;
}

function toInput(c: CommandRecord): CommandInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = c;
  return rest;
}

function deviceKey(d: { host: string; port: number; username: string }): string {
  return `${d.host.toLowerCase()}:${d.port}:${d.username.toLowerCase()}`;
}

export function previewPayload(db: AppDatabase, p: JsonPayload): JsonPreview {
  const existing = new Map(db.listCommands(true).map((c) => [c.uid, c]));
  const conflicts: { uid: string; title: string }[] = [];
  let newC = 0;
  let same = 0;
  for (const c of p.commands ?? []) {
    const e = existing.get(c.uid);
    if (!e) newC++;
    else if (e.command === c.command && e.title === c.title && e.description === c.description && e.risk === c.risk) same++;
    else conflicts.push({ uid: c.uid, title: c.title });
  }
  const scen = new Map(db.listScenarios().map((s) => [s.uid, s]));
  let newS = 0;
  let confS = 0;
  for (const s of p.scenarios ?? []) {
    const e = scen.get(s.uid);
    if (!e) newS++;
    else if (JSON.stringify(e.steps) !== JSON.stringify(s.steps) || e.name !== s.name) confS++;
  }
  const devKeys = new Set(db.listDevices().map(deviceKey));
  const devNew = (p.devices ?? []).filter((d) => !devKeys.has(deviceKey(d))).length;
  return {
    commands: { total: p.commands?.length ?? 0, new: newC, same, conflicts },
    scenarios: { total: p.scenarios?.length ?? 0, new: newS, conflicts: confS },
    devices: { total: p.devices?.length ?? 0, new: devNew, existing: (p.devices?.length ?? 0) - devNew },
    notes: p.notes?.length ?? 0
  };
}

export function previewJson(db: AppDatabase, path: string): JsonPreview {
  return previewPayload(db, readJson(path));
}

/** Слияние данных. Возвращает соответствие старых id устройств новым. */
export function mergePayload(db: AppDatabase, p: JsonPayload, opts: { overwriteConflicts: boolean }): { counts: Record<string, number>; deviceMap: Map<number, number> } {
  const counts: Record<string, number> = { commands: 0, commandConflicts: 0, scenarios: 0, devices: 0, devicesExisting: 0, groups: 0, notes: 0 };
  const deviceMap = new Map<number, number>();
  db.tx(() => {
    const existing = new Map(db.listCommands(true).map((c) => [c.uid, c]));
    for (const c of p.commands ?? []) {
      const e = existing.get(c.uid);
      if (!e) {
        db.insertCommand(toInput(c));
        counts.commands++;
      } else if (e.command !== c.command || e.title !== c.title || e.description !== c.description || e.risk !== c.risk) {
        if (opts.overwriteConflicts) {
          db.updateCommand(e.id, toInput(c));
          counts.commands++;
        } else counts.commandConflicts++;
      } else if (c.favorite || c.verified) {
        db.setCommandFlags(e.id, { favorite: e.favorite || c.favorite, verified: e.verified || c.verified });
      }
    }
    const scen = new Map(db.listScenarios().map((s) => [s.uid, s]));
    for (const s of p.scenarios ?? []) {
      const e = scen.get(s.uid);
      if (!e) {
        db.saveScenario({ ...s, id: undefined, builtin: false });
        counts.scenarios++;
      } else if (opts.overwriteConflicts && !e.builtin) {
        db.saveScenario({ ...s, id: e.id });
        counts.scenarios++;
      }
    }
    // группы — по имени
    const groupMap = new Map<number, number>();
    const byName = new Map(db.listGroups().map((g) => [g.name.toLowerCase(), g]));
    for (const g of p.groups ?? []) {
      const e = byName.get(g.name.toLowerCase());
      if (e) groupMap.set(g.id, e.id);
      else {
        const created = db.saveGroup({ name: g.name, parentId: null, kind: g.kind, sort: g.sort });
        groupMap.set(g.id, created.id);
        counts.groups++;
      }
    }
    for (const g of p.groups ?? []) {
      if (g.parentId && groupMap.get(g.parentId) && groupMap.get(g.id)) {
        const cur = db.listGroups().find((x) => x.id === groupMap.get(g.id));
        if (cur && !cur.parentId) db.saveGroup({ ...cur, parentId: groupMap.get(g.parentId)! });
      }
    }
    // устройства — по host:port:username
    const devByKey = new Map(db.listDevices().map((d) => [deviceKey(d), d]));
    for (const d of p.devices ?? []) {
      const e = devByKey.get(deviceKey(d));
      const input: DeviceInput = { ...d, id: undefined, groupId: d.groupId ? groupMap.get(d.groupId) ?? null : null, jumpDeviceId: null };
      if (e) {
        deviceMap.set(d.id, e.id);
        counts.devicesExisting++;
        if (opts.overwriteConflicts) db.saveDevice({ ...input, id: e.id });
      } else {
        const created = db.saveDevice(input);
        deviceMap.set(d.id, created.id);
        counts.devices++;
      }
    }
    for (const d of p.devices ?? []) {
      if (d.jumpDeviceId && deviceMap.get(d.jumpDeviceId) && deviceMap.get(d.id)) {
        const cur = db.getDevice(deviceMap.get(d.id)!);
        if (cur && !cur.jumpDeviceId) db.saveDevice({ ...cur, jumpDeviceId: deviceMap.get(d.jumpDeviceId)! });
      }
    }
    const notes = new Set(db.listNotes().map((n) => `${n.title}\n${n.body}`));
    for (const n of p.notes ?? []) {
      if (!notes.has(`${n.title}\n${n.body}`)) {
        db.saveNote(n);
        counts.notes++;
      }
    }
    for (const pr of p.profiles ?? []) db.saveProfile(pr);
    for (const tp of p.templateParams ?? []) db.saveTemplateParam(tp);
    for (const cp of p.customPlatforms ?? []) db.saveCustomPlatform(cp.id, cp.name, cp.vendor);
  });
  return { counts, deviceMap };
}

export function importJson(db: AppDatabase, path: string, opts: { overwriteConflicts: boolean }): JsonPreview {
  const p = readJson(path);
  const preview = previewPayload(db, p);
  mergePayload(db, p, opts);
  return preview;
}

// ---------- Зашифрованный перенос ----------

export function exportEncrypted(db: AppDatabase, vault: Vault, path: string, password: string, opts: { includeHistory: boolean }): Record<string, number> {
  const p = buildPayload(db, true, { includeHistory: opts.includeHistory, vault });
  const bundle = encryptBundle(p, password, { schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION });
  atomicWrite(path, JSON.stringify(bundle, null, 1));
  return {
    commands: p.commands.length,
    devices: p.devices.length,
    secrets: p.secrets?.length ?? 0,
    scenarios: p.scenarios.length,
    notes: p.notes.length,
    knownHosts: p.knownHosts?.length ?? 0,
    history: p.history?.length ?? 0
  };
}

function readBundle(path: string, password: string): JsonPayload & { __bundle: EncryptedBundle } {
  let bundle: EncryptedBundle;
  try {
    bundle = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Файл не является зашифрованной копией NetAdmin Desk');
  }
  const payload = decryptBundle<JsonPayload>(bundle, password);
  return { ...payload, __bundle: bundle };
}

export function previewEncrypted(path: string, password: string): EncryptedPreview {
  const p = readBundle(path, password);
  return {
    createdAt: p.__bundle.createdAt,
    appVersion: p.__bundle.appVersion,
    schemaVersion: p.__bundle.schemaVersion,
    counts: {
      commands: p.commands?.length ?? 0,
      devices: p.devices?.length ?? 0,
      secrets: p.secrets?.length ?? 0,
      scenarios: p.scenarios?.length ?? 0,
      notes: p.notes?.length ?? 0,
      knownHosts: p.knownHosts?.length ?? 0,
      history: p.history?.length ?? 0
    }
  };
}

export function importEncrypted(
  db: AppDatabase,
  vault: Vault,
  path: string,
  password: string,
  opts: { overwriteConflicts: boolean; importSettings: boolean }
): Record<string, number> {
  const p = readBundle(path, password);
  if (p.schemaVersion > SCHEMA_VERSION) throw new Error(`Копия создана более новой версией программы (схема ${p.schemaVersion})`);
  const { counts, deviceMap } = mergePayload(db, p, opts);
  Object.assign(counts, mergeSecrets(db, vault, p.secrets ?? [], deviceMap, opts.overwriteConflicts), mergeKnownHosts(db, p.knownHosts ?? []));
  if (opts.importSettings && p.settings) {
    const { vaultMode: _vm, ...rest } = p.settings;
    db.setSettings(rest);
  }
  if (p.history?.length) {
    db.tx(() => {
      for (const h of p.history!) db.addHistory({ ...h, deviceId: h.deviceId ? deviceMap.get(h.deviceId) ?? null : null });
    });
    counts.history = p.history.length;
  }
  return counts;
}

/** Пароли из файла — в хранилище (только если пользователь согласился). Без хранилища — пропускаются. */
function mergeSecrets(db: AppDatabase, vault: Vault, secrets: NonNullable<JsonPayload['secrets']>, deviceMap: Map<number, number>, overwrite: boolean) {
  const r = { secrets: 0, secretsSkipped: 0 };
  for (const s of secrets) {
    const id = deviceMap.get(s.deviceId);
    if (!id) continue;
    if (!overwrite && db.getSecret(id, s.kind)) continue;
    try {
      if (!vault.canStore()) throw new Error('хранилище недоступно');
      vault.store(id, s.kind, s.value);
      r.secrets++;
    } catch {
      r.secretsSkipped++;
    }
  }
  return r;
}

/** Ключи хостов: добавляются только новые. Если ключ уже известен и отличается — не заменяется (это может быть подмена). */
function mergeKnownHosts(db: AppDatabase, list: NonNullable<JsonPayload['knownHosts']>) {
  const r = { knownHosts: 0, knownHostConflicts: 0 };
  for (const k of list) {
    const e = db.getKnownHost(k.host, k.port);
    if (!e) {
      db.saveKnownHost(k.host, k.port, k.keyType, k.fingerprint, k.keyB64);
      r.knownHosts++;
    } else if (e.fingerprint !== k.fingerprint) r.knownHostConflicts++;
  }
  return r;
}

// ---------- Перенос устройств на другой компьютер ----------

export const DEVICES_FILE_EXT = 'nadevices';

/** Набор устройств для переноса: выбранные + их узлы-посредники, нужные группы (с родителями), ключи хостов, пароли. */
export function buildDevicesPayload(db: AppDatabase, opts: DevicesExportOptions & { vault?: Vault }): { payload: JsonPayload; jumpAdded: number } {
  const all = db.listDevices();
  const byId = new Map(all.map((d) => [d.id, d]));
  const chosen = new Set(opts.deviceIds?.length ? opts.deviceIds.filter((id) => byId.has(id)) : all.map((d) => d.id));
  const initial = chosen.size;
  for (const id of [...chosen]) {
    let j = byId.get(id)?.jumpDeviceId ?? null;
    const seen = new Set<number>();
    while (j && byId.has(j) && !seen.has(j)) {
      seen.add(j);
      chosen.add(j);
      j = byId.get(j)!.jumpDeviceId;
    }
  }
  const devices = all.filter((d) => chosen.has(d.id));
  const groupsAll = db.listGroups();
  const gById = new Map(groupsAll.map((g) => [g.id, g]));
  const gIds = new Set<number>();
  for (const d of devices) {
    let g = d.groupId;
    while (g && gById.has(g) && !gIds.has(g)) {
      gIds.add(g);
      g = gById.get(g)!.parentId;
    }
  }
  const hostKeys = new Set(devices.map((d) => `${d.host.toLowerCase()}:${d.port}`));
  const usedPlatforms = new Set(devices.map((d) => d.platform));
  const payload: JsonPayload = {
    format: JSON_FORMAT,
    version: 1,
    content: 'devices',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    commands: [],
    scenarios: [],
    notes: [],
    groups: groupsAll.filter((g) => gIds.has(g.id)),
    devices,
    profiles: [],
    templateParams: [],
    customPlatforms: db.listCustomPlatforms().filter((c) => usedPlatforms.has(c.id))
  };
  if (opts.knownHosts) payload.knownHosts = db.listKnownHosts().filter((k) => hostKeys.has(`${k.host.toLowerCase()}:${k.port}`));
  if (opts.secrets && opts.vault) payload.secrets = opts.vault.readAll().filter((x) => chosen.has(x.deviceId));
  return { payload, jumpAdded: chosen.size - initial };
}

export function exportDevices(db: AppDatabase, vault: Vault, path: string, opts: DevicesExportOptions): Record<string, number> {
  if (opts.secrets && !opts.password) throw new Error('Чтобы перенести пароли, задайте пароль для файла: без него пароли в файл не записываются');
  const { payload, jumpAdded } = buildDevicesPayload(db, { ...opts, vault: opts.secrets ? vault : undefined });
  const text = opts.secrets
    ? JSON.stringify(encryptBundle(payload, opts.password!, { schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION }), null, 1)
    : JSON.stringify(payload, null, 2);
  atomicWrite(path, text);
  return { devices: payload.devices.length, groups: payload.groups.length, knownHosts: payload.knownHosts?.length ?? 0, secrets: payload.secrets?.length ?? 0, jumpAdded, encrypted: opts.secrets ? 1 : 0 };
}

const csvCell = (v: string) => (/[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV для Excel и других программ: без паролей. Тот же формат читает «Устройства → Импорт → CSV». */
export function exportDevicesCsv(db: AppDatabase, path: string, deviceIds?: number[]): number {
  const ids = deviceIds?.length ? new Set(deviceIds) : null;
  const groups = new Map(db.listGroups().map((g) => [g.id, g.name]));
  const devices = db.listDevices().filter((d) => !ids || ids.has(d.id));
  const head = ['name', 'host', 'port', 'protocol', 'username', 'type', 'model', 'group', 'location', 'description', 'tags', 'auth', 'key', 'baud'];
  const rows = devices.map((d) => [d.name, d.host, String(d.port), d.protocol, d.username, d.deviceType, d.model, d.groupId ? groups.get(d.groupId) ?? '' : '', d.location, d.description, d.tags.join(', '), d.authMethod, d.keyPath, d.protocol === 'serial' ? String(d.serialBaud) : '']);
  // BOM — чтобы Excel в Windows открыл русские буквы правильно
  atomicWrite(path, '\ufeff' + [head, ...rows].map((r) => r.map((c) => csvCell(c ?? '')).join(',')).join('\r\n') + '\r\n');
  return devices.length;
}

function readDevicesFile(path: string, password?: string): { payload: JsonPayload | null; bundle?: EncryptedBundle } {
  const { text } = decodeText(readFileSync(path));
  let data: { format?: string; kdf?: unknown } & Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл не является файлом переноса NetAdmin Desk (повреждён или другой формат)');
  }
  if (data.format === JSON_FORMAT) {
    const p = data as unknown as JsonPayload;
    if (p.schemaVersion > SCHEMA_VERSION) throw new Error(`Файл создан более новой версией программы (схема ${p.schemaVersion}). Обновите программу на этом компьютере.`);
    return { payload: p };
  }
  if (data.kdf && data.format) {
    const bundle = data as unknown as EncryptedBundle;
    if (!password) return { payload: null, bundle };
    const p = decryptBundle<JsonPayload>(bundle, password);
    if (p.schemaVersion > SCHEMA_VERSION) throw new Error(`Файл создан более новой версией программы (схема ${p.schemaVersion}). Обновите программу на этом компьютере.`);
    return { payload: p, bundle };
  }
  throw new Error('Это не файл NetAdmin Desk. Для таблиц выберите «Импорт → Таблица CSV», для настроек SSH — «Импорт → ~/.ssh/config».');
}

export function previewDevicesFile(db: AppDatabase, path: string, password?: string): DevicesFilePreview {
  const { payload: p, bundle } = readDevicesFile(path, password);
  const base = { encrypted: !!bundle, createdAt: bundle?.createdAt ?? p?.exportedAt, appVersion: bundle?.appVersion ?? p?.appVersion };
  if (!p) return { ...base, needsPassword: true, content: 'devices', devices: [], groups: 0, knownHosts: 0, knownHostConflicts: 0, secrets: 0 };
  const existing = new Map(db.listDevices().map((d) => [deviceKey(d), d.name]));
  const gName = new Map((p.groups ?? []).map((g) => [g.id, g.name]));
  const withSecret = new Set((p.secrets ?? []).map((x) => x.deviceId));
  let conflicts = 0;
  for (const k of p.knownHosts ?? []) {
    const e = db.getKnownHost(k.host, k.port);
    if (e && e.fingerprint !== k.fingerprint) conflicts++;
  }
  return {
    ...base,
    needsPassword: false,
    content: p.content ?? (p.settings ? 'full' : 'data'),
    devices: (p.devices ?? []).map((d) => {
      const warnings: string[] = [];
      if (d.authMethod === 'key' && d.keyPath) warnings.push(`вход по ключу: файл ${d.keyPath} нужно скопировать отдельно и при необходимости указать новый путь`);
      if (d.protocol === 'serial') warnings.push(`COM-порт ${d.host}: на другом компьютере номер порта может отличаться`);
      if (d.protocol === 'telnet') warnings.push('Telnet: логин и пароль передаются по сети без шифрования');
      return { name: d.name, host: d.host, port: d.port, protocol: d.protocol, username: d.username, group: d.groupId ? gName.get(d.groupId) ?? '' : '', duplicateOf: existing.get(deviceKey(d)), hasSecret: withSecret.has(d.id), warnings };
    }),
    groups: p.groups?.length ?? 0,
    knownHosts: p.knownHosts?.length ?? 0,
    knownHostConflicts: conflicts,
    secrets: p.secrets?.length ?? 0
  };
}

/**
 * Импорт устройств из файла переноса (или из любого экспорта NetAdmin Desk — тогда берутся только устройства).
 * Команды, сценарии, заметки и настройки из такого файла здесь не импортируются.
 */
export function importDevicesFile(
  db: AppDatabase,
  vault: Vault,
  path: string,
  opts: { password?: string; overwrite: boolean; knownHosts: boolean; secrets: boolean }
): Record<string, number> {
  const { payload: p } = readDevicesFile(path, opts.password);
  if (!p) throw new Error('Файл зашифрован — введите пароль, который задали при экспорте');
  const onlyDevices: JsonPayload = { ...p, commands: [], scenarios: [], notes: [], profiles: [], templateParams: [], settings: undefined, history: undefined };
  const { counts, deviceMap } = mergePayload(db, onlyDevices, { overwriteConflicts: opts.overwrite });
  const out: Record<string, number> = { devices: counts.devices, devicesUpdated: opts.overwrite ? counts.devicesExisting : 0, devicesSkipped: opts.overwrite ? 0 : counts.devicesExisting, groups: counts.groups };
  if (opts.knownHosts) Object.assign(out, mergeKnownHosts(db, p.knownHosts ?? []));
  if (opts.secrets) Object.assign(out, mergeSecrets(db, vault, p.secrets ?? [], deviceMap, opts.overwrite));
  return out;
}

// ---------- CSV (устройства) ----------

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const CSV_COLUMNS: Record<string, string[]> = {
  name: ['name', 'название', 'имя', 'устройство', 'device'],
  host: ['host', 'ip', 'address', 'адрес', 'ip-адрес', 'hostname', 'dns'],
  port: ['port', 'порт', 'ssh port', 'ssh-порт'],
  username: ['username', 'user', 'login', 'логин', 'пользователь'],
  type: ['type', 'тип', 'device_type', 'платформа', 'platform', 'vendor', 'производитель'],
  model: ['model', 'модель'],
  group: ['group', 'группа'],
  description: ['description', 'описание', 'comment', 'комментарий'],
  location: ['location', 'расположение', 'место'],
  tags: ['tags', 'теги'],
  auth: ['auth', 'auth_method', 'авторизация'],
  key: ['key', 'key_path', 'identityfile', 'ключ'],
  password: ['password', 'пароль', 'pass'],
  protocol: ['protocol', 'протокол', 'proto'],
  baud: ['baud', 'скорость', 'baudrate']
};

function mapType(v: string): { deviceType: string; platform: string } {
  const t = v.toLowerCase();
  const found =
    DEVICE_TYPES.find((d) => d.id === t || d.label.toLowerCase() === t || d.platform === t) ??
    (/(linux|debian|ubuntu|centos|server)/.test(t)
      ? DEVICE_TYPES.find((d) => d.id === 'linux')
      : /sg\s?3/.test(t)
        ? DEVICE_TYPES.find((d) => d.id === 'cisco-sg300')
        : /cisco/.test(t)
          ? DEVICE_TYPES.find((d) => d.id === 'cisco')
          : /hp|procurve|aruba/.test(t)
            ? DEVICE_TYPES.find((d) => d.id === 'hp-procurve')
            : /8000s/.test(t)
              ? DEVICE_TYPES.find((d) => d.id === 'at-8000s')
              : /telesis|allied/.test(t)
                ? DEVICE_TYPES.find((d) => d.id === 'alliedware')
                : /osnovo|осново/.test(t)
                  ? DEVICE_TYPES.find((d) => d.id === 'osnovo')
                  : /qtech/.test(t)
                    ? DEVICE_TYPES.find((d) => d.id === 'qtech')
                    : /tp-?link/.test(t)
                      ? DEVICE_TYPES.find((d) => d.id === 'tplink')
                      : /linksys/.test(t)
                        ? DEVICE_TYPES.find((d) => d.id === 'linksys')
                        : undefined);
  return found ? { deviceType: found.id, platform: found.platform } : { deviceType: 'other', platform: 'generic-ssh' };
}

export function blankDevice(): DeviceInput {
  return {
    name: '',
    host: '',
    port: 22,
    vendor: '',
    model: '',
    platform: 'generic-ssh',
    deviceType: 'other',
    osVersion: '',
    username: '',
    authMethod: 'password',
    keyPath: '',
    description: '',
    location: '',
    groupId: null,
    tags: [],
    favorite: false,
    linuxDistro: '',
    linuxVersion: '',
    hostname: '',
    serverType: '',
    servicesNotes: '',
    connectionNotes: '',
    legacyAlgorithms: false,
    autoEnable: false,
    disablePagerOnConnect: false,
    readOnly: false,
    keepaliveSec: 30,
    timeoutSec: 20,
    jumpDeviceId: null,
    protocol: 'ssh',
    serialBaud: 9600,
    loginCommands: '',
    color: ''
  };
}

export function previewDevicesCsv(db: AppDatabase, path: string): DevicesPreview & { passwords: (string | undefined)[]; groups: (string | undefined)[] } {
  const { text } = decodeText(readFileSync(path));
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) return { devices: [], hasPasswordColumn: false, errors: ['В файле нет данных (нужна строка заголовков и хотя бы одна строка)'], passwords: [], groups: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (key: string) => header.findIndex((h) => CSV_COLUMNS[key].includes(h));
  const idx = Object.fromEntries(Object.keys(CSV_COLUMNS).map((k) => [k, col(k)])) as Record<string, number>;
  if (idx.host < 0) errors.push('Не найден столбец с адресом (host / ip / адрес)');
  const existing = new Map(db.listDevices().map((d) => [deviceKey(d), d.name]));
  const devices: DevicesPreview['devices'] = [];
  const passwords: (string | undefined)[] = [];
  const groups: (string | undefined)[] = [];
  rows.slice(1).forEach((r, i) => {
    const get = (k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
    const host = get('host');
    if (!host) {
      errors.push(`Строка ${i + 2}: пустой адрес — пропущена`);
      return;
    }
    const t = mapType(get('type'));
    const protoRaw = get('protocol').toLowerCase();
    const protocol: DeviceInput['protocol'] = /telnet/.test(protoRaw) ? 'telnet' : /serial|com|консол|uart/.test(protoRaw) ? 'serial' : 'ssh';
    const d: DeviceInput = {
      ...blankDevice(),
      name: get('name') || host,
      host,
      port: Number(get('port')) || (protocol === 'telnet' ? 23 : 22),
      protocol,
      serialBaud: Number(get('baud')) || 9600,
      username: get('username'),
      model: get('model'),
      description: get('description'),
      location: get('location'),
      tags: get('tags') ? get('tags').split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : [],
      deviceType: t.deviceType,
      platform: t.platform,
      vendor: getPlatform(t.platform).vendor,
      keyPath: get('key'),
      authMethod: get('key') ? 'key' : 'password'
    };
    const warnings: string[] = [];
    if (t.deviceType === 'other' && get('type')) warnings.push(`тип «${get('type')}» не распознан — выбран «Другое»`);
    if (protocol === 'telnet') warnings.push('Telnet: логин и пароль передаются по сети без шифрования');
    const pw = get('password');
    devices.push({ ...d, hasPassword: !!pw, duplicateOf: existing.get(deviceKey(d)), warnings });
    passwords.push(pw || undefined);
    groups.push(get('group') || undefined);
  });
  return { devices, hasPasswordColumn: idx.password >= 0, errors, passwords, groups };
}

export function importDevicesCsv(db: AppDatabase, vault: Vault, path: string, opts: { importPasswords: boolean; skipDuplicates: boolean }): number {
  const pv = previewDevicesCsv(db, path);
  let n = 0;
  db.tx(() => {
    const groups = new Map(db.listGroups().map((g) => [g.name.toLowerCase(), g.id]));
    pv.devices.forEach((d, i) => {
      if (opts.skipDuplicates && d.duplicateOf) return;
      const gname = pv.groups[i];
      let groupId: number | null = null;
      if (gname) {
        groupId = groups.get(gname.toLowerCase()) ?? null;
        if (!groupId) {
          groupId = db.saveGroup({ name: gname, parentId: null, kind: 'group', sort: 0 }).id;
          groups.set(gname.toLowerCase(), groupId);
        }
      }
      const { hasPassword: _h, duplicateOf: _d, warnings: _w, ...input } = d;
      const saved = db.saveDevice({ ...input, groupId });
      if (opts.importPasswords && pv.passwords[i] && vault.canStore()) vault.store(saved.id, 'password', pv.passwords[i]!);
      n++;
    });
  });
  return n;
}

// ---------- ~/.ssh/config ----------

export function parseSshConfig(text: string): { alias: string; opts: Record<string, string> }[] {
  const hosts: { alias: string; opts: Record<string, string> }[] = [];
  let cur: { alias: string; opts: Record<string, string> } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^(\S+)\s*=?\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'host') {
      cur = null;
      const aliases = val.split(/\s+/).filter((a) => !/[*?!]/.test(a));
      if (aliases.length) {
        cur = { alias: aliases[0], opts: {} };
        hosts.push(cur);
      }
    } else if (key === 'match') {
      cur = null;
    } else if (cur && !(key in cur.opts)) {
      cur.opts[key] = val;
    }
  }
  return hosts;
}

export function previewSshConfig(db: AppDatabase, path?: string): DevicesPreview {
  const p = path || join(homedir(), '.ssh', 'config');
  if (!existsSync(p)) return { devices: [], hasPasswordColumn: false, errors: [`Файл ${p} не найден`] };
  const hosts = parseSshConfig(readFileSync(p, 'utf8'));
  const existing = new Map(db.listDevices().map((d) => [deviceKey(d), d.name]));
  const devices = hosts.map(({ alias, opts }) => {
    const warnings: string[] = [];
    const legacy = /group1-sha1|group14-sha1|ssh-rsa|ssh-dss|-cbc/.test(`${opts.kexalgorithms ?? ''} ${opts.hostkeyalgorithms ?? ''} ${opts.ciphers ?? ''} ${opts.pubkeyacceptedalgorithms ?? ''}`);
    if (legacy) warnings.push('в конфигурации разрешены устаревшие алгоритмы — включена соответствующая опция устройства');
    if (opts.proxyjump) warnings.push(`ProxyJump «${opts.proxyjump}» — укажите промежуточный сервер в карточке после импорта`);
    if (opts.proxycommand) warnings.push('ProxyCommand не поддерживается — настройте подключение вручную');
    const d: DeviceInput = {
      ...blankDevice(),
      name: alias,
      host: opts.hostname || alias,
      port: Number(opts.port) || 22,
      username: opts.user || '',
      keyPath: opts.identityfile?.replace(/^"|"$/g, '') || '',
      authMethod: opts.identityfile ? 'key' : 'password',
      legacyAlgorithms: legacy,
      connectionNotes: opts.proxyjump ? `ProxyJump ${opts.proxyjump}` : '',
      description: 'Импортировано из ~/.ssh/config'
    };
    return { ...d, duplicateOf: existing.get(deviceKey(d)), warnings };
  });
  return { devices, hasPasswordColumn: false, errors: [] };
}

export function importSshConfig(db: AppDatabase, path: string | undefined, opts: { skipDuplicates: boolean }): number {
  const pv = previewSshConfig(db, path);
  let n = 0;
  db.tx(() => {
    for (const d of pv.devices) {
      if (opts.skipDuplicates && d.duplicateOf) continue;
      const { hasPassword: _h, duplicateOf: _d, warnings: _w, ...input } = d;
      db.saveDevice(input);
      n++;
    }
  });
  return n;
}
