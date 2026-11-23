// Локальная база NetAdmin Desk: репозитории поверх драйвера SQLite.
import type {
  BackupRecord,
  CommandInput,
  CommandRecord,
  Device,
  DeviceGroup,
  DeviceInput,
  DiagnosticProfile,
  DiagnosticReport,
  DiagnosticResult,
  HistoryEntry,
  ImportReportRecord,
  KnownHost,
  Note,
  Scenario,
  ScenarioInput,
  Settings,
  TemplateParamDef,
  TxtParseReport
} from '../../shared/types';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import { DEFAULT_MONITOR, withMonitorDefaults, type MapItem, type MapLink, type MonitorEvent, type MonitorEventLevel, type MonitorEventType, type MonitorMap, type MonitorMapInput, type MonitorNode, type MonitorNodeInput } from '../../shared/monitor';
import type { SqlDriver } from './driver';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  uiScale: 1,
  uiFont: '',
  monoFont: '',
  terminalFontSize: 14,
  terminalScrollback: 10000,
  terminalCursorBlink: true,
  copyOnSelect: false,
  readOnlyMode: false,
  logTypedCommands: true,
  saveSessionLogs: false,
  confirmChangeCommands: true,
  allowMassConfig: false,
  ctrlKInTerminal: false,
  defaultKeepaliveSec: 30,
  defaultTimeoutSec: 20,
  vaultMode: 'unset',
  showSensitive: false,
  sidebarCollapsed: false,
  uiMode: 'simple',
  navCollapsed: [],
  navOverrides: {},
  terminalHighlight: true,
  quickCommandsBar: false,
  splitRatio: 0.62,
  lastSection: 'home',
  monitor: DEFAULT_MONITOR,
  telemetry: false
};

const now = () => new Date().toISOString();
const j = (v: unknown) => JSON.stringify(v ?? null);
function pj<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
const b = (v: unknown) => v === 1 || v === true || v === '1';

type Row = Record<string, unknown>;

function rowToCommand(r: Row): CommandRecord {
  return {
    id: Number(r.id),
    uid: String(r.uid),
    kind: r.kind as CommandRecord['kind'],
    entryType: r.entry_type as CommandRecord['entryType'],
    platform: String(r.platform),
    vendorLabel: String(r.vendor_label ?? ''),
    model: (r.model as string) ?? undefined,
    os: (r.os as string) ?? undefined,
    category: String(r.category),
    title: String(r.title),
    command: String(r.command ?? ''),
    description: String(r.description ?? ''),
    details: pj(r.details, {}),
    rawText: (r.raw_text as string) ?? undefined,
    template: (r.template as string) ?? null,
    risk: r.risk as CommandRecord['risk'],
    riskManual: b(r.risk_manual),
    mode: r.mode as CommandRecord['mode'],
    source: r.source as CommandRecord['source'],
    verified: b(r.verified),
    needsReview: b(r.needs_review),
    reviewNote: (r.review_note as string) ?? undefined,
    vendorUnknown: b(r.vendor_unknown),
    sensitive: b(r.sensitive),
    favorite: b(r.favorite),
    userModified: b(r.user_modified),
    tags: pj(r.tags, []),
    originFile: (r.origin_file as string) ?? undefined,
    originLine: r.origin_line == null ? undefined : Number(r.origin_line),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

function rowToDevice(r: Row): Device {
  return {
    id: Number(r.id),
    name: String(r.name),
    host: String(r.host),
    port: Number(r.port),
    vendor: String(r.vendor ?? ''),
    model: String(r.model ?? ''),
    platform: String(r.platform),
    deviceType: String(r.device_type),
    osVersion: String(r.os_version ?? ''),
    username: String(r.username ?? ''),
    authMethod: r.auth_method as Device['authMethod'],
    keyPath: String(r.key_path ?? ''),
    description: String(r.description ?? ''),
    location: String(r.location ?? ''),
    groupId: r.group_id == null ? null : Number(r.group_id),
    tags: pj(r.tags, []),
    favorite: b(r.favorite),
    linuxDistro: String(r.linux_distro ?? ''),
    linuxVersion: String(r.linux_version ?? ''),
    hostname: String(r.hostname ?? ''),
    serverType: String(r.server_type ?? ''),
    servicesNotes: String(r.services_notes ?? ''),
    connectionNotes: String(r.connection_notes ?? ''),
    legacyAlgorithms: b(r.legacy_algorithms),
    autoEnable: b(r.auto_enable),
    disablePagerOnConnect: b(r.disable_pager),
    readOnly: b(r.read_only),
    keepaliveSec: Number(r.keepalive_sec),
    timeoutSec: Number(r.timeout_sec),
    jumpDeviceId: r.jump_device_id == null ? null : Number(r.jump_device_id),
    protocol: (['ssh', 'telnet', 'serial'].includes(String(r.protocol)) ? r.protocol : 'ssh') as Device['protocol'],
    serialBaud: Number(r.serial_baud ?? 9600) || 9600,
    loginCommands: String(r.login_commands ?? ''),
    color: String(r.color ?? '') as Device['color'],
    lastConnectedAt: (r.last_connected_at as string) ?? null,
    lastStatus: (r.last_status as Device['lastStatus']) ?? 'never',
    lastError: String(r.last_error ?? ''),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

function rowToScenario(r: Row): Scenario {
  return {
    id: Number(r.id),
    uid: String(r.uid),
    name: String(r.name),
    description: String(r.description ?? ''),
    platforms: pj(r.platforms, []),
    steps: pj(r.steps, []),
    builtin: b(r.builtin),
    favorite: b(r.favorite),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export interface UpsertResult {
  action: 'inserted' | 'updated' | 'unchanged' | 'skipped';
  id: number;
}

export class AppDatabase {
  constructor(public readonly driver: SqlDriver) {}

  // ---------- Служебное ----------

  migrate(): { from: number; to: number } {
    this.driver.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);');
    const from = Number(this.getMeta('schema_version') ?? 0);
    for (const m of MIGRATIONS) {
      if (m.version <= from) continue;
      this.tx(() => {
        this.driver.exec(m.sql);
        this.setMeta('schema_version', String(m.version));
      });
    }
    this.driver.flush();
    return { from, to: SCHEMA_VERSION };
  }

  tx<T>(fn: () => T): T {
    this.driver.exec('BEGIN');
    try {
      const r = fn();
      this.driver.exec('COMMIT');
      return r;
    } catch (e) {
      try {
        this.driver.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  integrityCheck(): string {
    const rows = this.driver.all<Row>('PRAGMA integrity_check');
    return rows.map((r) => String(Object.values(r)[0])).join('\n');
  }

  getMeta(key: string): string | undefined {
    return this.driver.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value;
  }

  setMeta(key: string, value: string): void {
    this.driver.run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  flush(): void {
    this.driver.flush();
  }

  close(): void {
    this.driver.close();
  }

  // ---------- Команды ----------

  listCommands(includeDeleted = false): CommandRecord[] {
    const rows = this.driver.all<Row>(`SELECT * FROM commands ${includeDeleted ? '' : 'WHERE deleted = 0'} ORDER BY kind, platform, category, id`);
    return rows.map(rowToCommand);
  }

  getCommand(id: number): CommandRecord | undefined {
    const r = this.driver.get<Row>('SELECT * FROM commands WHERE id = ?', [id]);
    return r ? rowToCommand(r) : undefined;
  }

  getCommandByUid(uid: string): CommandRecord | undefined {
    const r = this.driver.get<Row>('SELECT * FROM commands WHERE uid = ?', [uid]);
    return r ? rowToCommand(r) : undefined;
  }

  private commandValues(c: CommandInput): unknown[] {
    return [
      c.kind,
      c.entryType,
      c.platform,
      c.vendorLabel,
      c.model ?? null,
      c.os ?? null,
      c.category,
      c.title,
      c.command,
      c.description,
      j(c.details ?? {}),
      c.rawText ?? null,
      c.template ?? null,
      c.risk,
      c.riskManual,
      c.mode,
      c.source,
      c.verified,
      c.needsReview,
      c.reviewNote ?? null,
      c.vendorUnknown,
      c.sensitive,
      c.favorite,
      c.userModified,
      j(c.tags ?? []),
      c.originFile ?? null,
      c.originLine ?? null
    ];
  }

  private static readonly CMD_COLS =
    'kind, entry_type, platform, vendor_label, model, os, category, title, command, description, details, raw_text, template, risk, risk_manual, mode, source, verified, needs_review, review_note, vendor_unknown, sensitive, favorite, user_modified, tags, origin_file, origin_line';

  insertCommand(c: CommandInput): number {
    const ts = now();
    const r = this.driver.run(
      `INSERT INTO commands(uid, ${AppDatabase.CMD_COLS}, created_at, updated_at) VALUES(?, ${AppDatabase.CMD_COLS.split(',')
        .map(() => '?')
        .join(', ')}, ?, ?)`,
      [c.uid, ...this.commandValues(c), ts, ts]
    );
    return r.lastInsertRowid;
  }

  updateCommand(id: number, c: CommandInput): void {
    const sets = AppDatabase.CMD_COLS.split(',')
      .map((col) => `${col.trim()} = ?`)
      .join(', ');
    this.driver.run(`UPDATE commands SET ${sets}, updated_at = ? WHERE id = ?`, [...this.commandValues(c), now(), id]);
  }

  /**
   * Обновление/вставка записи из встроенных данных или повторного импорта.
   * Записи, изменённые пользователем, и удалённые пользователем не перезаписываются.
   * Пользовательские флаги (избранное, «проверено», ручной риск) сохраняются.
   */
  upsertSeedCommand(c: CommandInput): UpsertResult {
    const existing = this.driver.get<Row>('SELECT * FROM commands WHERE uid = ?', [c.uid]);
    if (!existing) return { action: 'inserted', id: this.insertCommand(c) };
    const cur = rowToCommand(existing);
    if (b(existing.deleted) || cur.userModified) return { action: 'skipped', id: cur.id };
    const merged: CommandInput = {
      ...c,
      favorite: cur.favorite,
      verified: cur.verified,
      risk: cur.riskManual ? cur.risk : c.risk,
      riskManual: cur.riskManual
    };
    const same =
      cur.title === merged.title &&
      cur.command === merged.command &&
      cur.description === merged.description &&
      j(cur.details) === j(merged.details ?? {}) &&
      (cur.rawText ?? null) === (merged.rawText ?? null) &&
      (cur.template ?? null) === (merged.template ?? null) &&
      cur.risk === merged.risk &&
      cur.category === merged.category &&
      cur.kind === merged.kind &&
      cur.platform === merged.platform &&
      cur.source === merged.source &&
      (cur.originFile ?? null) === (merged.originFile ?? null);
    if (same) return { action: 'unchanged', id: cur.id };
    this.updateCommand(cur.id, merged);
    return { action: 'updated', id: cur.id };
  }

  /** Сохранение записи пользователем (создание или редактирование). */
  saveCommand(c: CommandInput): CommandRecord {
    if (c.id) {
      const cur = this.getCommand(c.id);
      if (!cur) throw new Error('Запись не найдена');
      const userModified = cur.source === 'user' ? false : true;
      this.updateCommand(c.id, { ...c, userModified: c.userModified || userModified });
      return this.getCommand(c.id)!;
    }
    const uid = c.uid || `user:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    const id = this.insertCommand({ ...c, uid });
    return this.getCommand(id)!;
  }

  /**
   * Удаление устаревших записей повторно импортированного файла: записи с тем же префиксом uid,
   * которых больше нет в новой версии файла. Записи, изменённые пользователем, остаются.
   */
  pruneSeedCommands(uidPrefix: string, keep: Set<string>): number {
    const rows = this.driver.all<Row>('SELECT id, uid FROM commands WHERE uid LIKE ? AND user_modified = 0', [`${uidPrefix}%`]);
    let n = 0;
    for (const r of rows) {
      if (keep.has(String(r.uid))) continue;
      this.driver.run('DELETE FROM commands WHERE id = ?', [Number(r.id)]);
      n++;
    }
    return n;
  }

  deleteCommand(id: number): void {
    const cur = this.getCommand(id);
    if (!cur) return;
    if (cur.source === 'user') this.driver.run('DELETE FROM commands WHERE id = ?', [id]);
    else this.driver.run('UPDATE commands SET deleted = 1, updated_at = ? WHERE id = ?', [now(), id]);
  }

  restoreDeletedCommands(): number {
    return this.driver.run('UPDATE commands SET deleted = 0 WHERE deleted = 1').changes;
  }

  setCommandFlags(id: number, flags: { favorite?: boolean; verified?: boolean }): CommandRecord | undefined {
    if (flags.favorite !== undefined) this.driver.run('UPDATE commands SET favorite = ? WHERE id = ?', [flags.favorite, id]);
    if (flags.verified !== undefined) this.driver.run('UPDATE commands SET verified = ? WHERE id = ?', [flags.verified, id]);
    return this.getCommand(id);
  }

  // ---------- Группы ----------

  listGroups(): DeviceGroup[] {
    return this.driver.all<Row>('SELECT * FROM device_groups ORDER BY sort, name').map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      parentId: r.parent_id == null ? null : Number(r.parent_id),
      kind: r.kind as DeviceGroup['kind'],
      sort: Number(r.sort)
    }));
  }

  saveGroup(g: Omit<DeviceGroup, 'id'> & { id?: number }): DeviceGroup {
    if (g.id) {
      this.driver.run('UPDATE device_groups SET name = ?, parent_id = ?, kind = ?, sort = ? WHERE id = ?', [g.name, g.parentId, g.kind, g.sort, g.id]);
      return this.listGroups().find((x) => x.id === g.id)!;
    }
    const id = this.driver.run('INSERT INTO device_groups(name, parent_id, kind, sort) VALUES(?, ?, ?, ?)', [g.name, g.parentId, g.kind, g.sort]).lastInsertRowid;
    return this.listGroups().find((x) => x.id === id)!;
  }

  deleteGroup(id: number): void {
    this.driver.run('UPDATE devices SET group_id = NULL WHERE group_id = ?', [id]);
    this.driver.run('UPDATE device_groups SET parent_id = NULL WHERE parent_id = ?', [id]);
    this.driver.run('DELETE FROM device_groups WHERE id = ?', [id]);
  }

  // ---------- Устройства ----------

  listDevices(): Device[] {
    return this.driver.all<Row>('SELECT * FROM devices ORDER BY name COLLATE NOCASE').map(rowToDevice);
  }

  getDevice(id: number): Device | undefined {
    const r = this.driver.get<Row>('SELECT * FROM devices WHERE id = ?', [id]);
    return r ? rowToDevice(r) : undefined;
  }

  saveDevice(d: DeviceInput): Device {
    const vals = [
      d.name.trim(),
      d.host.trim(),
      d.port || 22,
      d.vendor,
      d.model,
      d.platform,
      d.deviceType,
      d.osVersion,
      d.username,
      d.authMethod,
      d.keyPath,
      d.description,
      d.location,
      d.groupId,
      j(d.tags ?? []),
      d.favorite,
      d.linuxDistro,
      d.linuxVersion,
      d.hostname,
      d.serverType,
      d.servicesNotes,
      d.connectionNotes,
      d.legacyAlgorithms,
      d.autoEnable,
      d.disablePagerOnConnect,
      d.readOnly,
      d.keepaliveSec,
      d.timeoutSec,
      d.jumpDeviceId && d.jumpDeviceId !== d.id ? d.jumpDeviceId : null,
      ['ssh', 'telnet', 'serial'].includes(d.protocol) ? d.protocol : 'ssh',
      d.serialBaud || 9600,
      d.loginCommands ?? '',
      d.color ?? ''
    ];
    const cols =
      'name, host, port, vendor, model, platform, device_type, os_version, username, auth_method, key_path, description, location, group_id, tags, favorite, linux_distro, linux_version, hostname, server_type, services_notes, connection_notes, legacy_algorithms, auto_enable, disable_pager, read_only, keepalive_sec, timeout_sec, jump_device_id, protocol, serial_baud, login_commands, color';
    if (!d.name.trim()) throw new Error('Укажите название устройства');
    if (!d.host.trim()) throw new Error(d.protocol === 'serial' ? 'Укажите COM-порт (например, COM3 или /dev/ttyUSB0)' : 'Укажите IP-адрес или DNS-имя');
    if (d.id) {
      const sets = cols
        .split(',')
        .map((c) => `${c.trim()} = ?`)
        .join(', ');
      this.driver.run(`UPDATE devices SET ${sets}, updated_at = ? WHERE id = ?`, [...vals, now(), d.id]);
      return this.getDevice(d.id)!;
    }
    const ts = now();
    const id = this.driver.run(
      `INSERT INTO devices(${cols}, created_at, updated_at) VALUES(${cols
        .split(',')
        .map(() => '?')
        .join(', ')}, ?, ?)`,
      [...vals, ts, ts]
    ).lastInsertRowid;
    return this.getDevice(id)!;
  }

  deleteDevice(id: number): void {
    this.driver.run('DELETE FROM secrets WHERE device_id = ?', [id]);
    this.driver.run('UPDATE devices SET jump_device_id = NULL WHERE jump_device_id = ?', [id]);
    this.driver.run('DELETE FROM devices WHERE id = ?', [id]);
  }

  markDeviceStatus(id: number, status: 'ok' | 'error', error = ''): void {
    if (status === 'ok') this.driver.run('UPDATE devices SET last_status = ?, last_error = ?, last_connected_at = ? WHERE id = ?', [status, '', now(), id]);
    else this.driver.run('UPDATE devices SET last_status = ?, last_error = ? WHERE id = ?', [status, error.slice(0, 500), id]);
  }

  // ---------- Секреты (только зашифрованные значения) ----------

  getSecret(deviceId: number, kind: string): { scheme: string; blob: string } | undefined {
    return this.driver.get<{ scheme: string; blob: string }>('SELECT scheme, blob FROM secrets WHERE device_id = ? AND kind = ?', [deviceId, kind]);
  }

  setSecret(deviceId: number, kind: string, scheme: string, blob: string): void {
    this.driver.run(
      'INSERT INTO secrets(device_id, kind, scheme, blob, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(device_id, kind) DO UPDATE SET scheme = excluded.scheme, blob = excluded.blob, updated_at = excluded.updated_at',
      [deviceId, kind, scheme, blob, now()]
    );
  }

  deleteSecret(deviceId: number, kind: string): void {
    this.driver.run('DELETE FROM secrets WHERE device_id = ? AND kind = ?', [deviceId, kind]);
  }

  listSecretRows(): { deviceId: number; kind: string; scheme: string; blob: string }[] {
    return this.driver.all<Row>('SELECT * FROM secrets').map((r) => ({ deviceId: Number(r.device_id), kind: String(r.kind), scheme: String(r.scheme), blob: String(r.blob) }));
  }

  // ---------- Известные ключи хостов ----------

  getKnownHost(host: string, port: number): (KnownHost & { keyB64: string }) | undefined {
    const r = this.driver.get<Row>('SELECT * FROM known_hosts WHERE host = ? AND port = ?', [host.toLowerCase(), port]);
    return r
      ? {
          id: Number(r.id),
          host: String(r.host),
          port: Number(r.port),
          keyType: String(r.key_type),
          fingerprint: String(r.fingerprint),
          keyB64: String(r.key_b64),
          firstSeen: String(r.first_seen),
          lastSeen: String(r.last_seen)
        }
      : undefined;
  }

  saveKnownHost(host: string, port: number, keyType: string, fingerprint: string, keyB64: string): void {
    const ts = now();
    this.driver.run(
      `INSERT INTO known_hosts(host, port, key_type, fingerprint, key_b64, first_seen, last_seen) VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host, port) DO UPDATE SET key_type = excluded.key_type, fingerprint = excluded.fingerprint, key_b64 = excluded.key_b64, first_seen = excluded.first_seen, last_seen = excluded.last_seen`,
      [host.toLowerCase(), port, keyType, fingerprint, keyB64, ts, ts]
    );
  }

  touchKnownHost(host: string, port: number): void {
    this.driver.run('UPDATE known_hosts SET last_seen = ? WHERE host = ? AND port = ?', [now(), host.toLowerCase(), port]);
  }

  deleteKnownHost(host: string, port: number): void {
    this.driver.run('DELETE FROM known_hosts WHERE host = ? AND port = ?', [host.toLowerCase(), port]);
  }

  listKnownHosts(): (KnownHost & { keyB64: string })[] {
    return this.driver.all<Row>('SELECT * FROM known_hosts ORDER BY host').map((r) => ({
      id: Number(r.id),
      host: String(r.host),
      port: Number(r.port),
      keyType: String(r.key_type),
      fingerprint: String(r.fingerprint),
      keyB64: String(r.key_b64),
      firstSeen: String(r.first_seen),
      lastSeen: String(r.last_seen)
    }));
  }

  // ---------- Сценарии ----------

  listScenarios(): Scenario[] {
    return this.driver.all<Row>('SELECT * FROM scenarios WHERE deleted = 0 ORDER BY builtin DESC, name').map(rowToScenario);
  }

  getScenario(id: number): Scenario | undefined {
    const r = this.driver.get<Row>('SELECT * FROM scenarios WHERE id = ?', [id]);
    return r ? rowToScenario(r) : undefined;
  }

  upsertSeedScenario(s: ScenarioInput): UpsertResult {
    const ex = this.driver.get<Row>('SELECT * FROM scenarios WHERE uid = ?', [s.uid]);
    if (!ex) {
      const ts = now();
      const id = this.driver.run(
        'INSERT INTO scenarios(uid, name, description, platforms, steps, builtin, favorite, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [s.uid, s.name, s.description, j(s.platforms), j(s.steps), s.builtin, s.favorite, ts, ts]
      ).lastInsertRowid;
      return { action: 'inserted', id };
    }
    if (b(ex.user_modified) || b(ex.deleted)) return { action: 'skipped', id: Number(ex.id) };
    if (ex.name === s.name && ex.description === s.description && ex.platforms === j(s.platforms) && ex.steps === j(s.steps)) {
      return { action: 'unchanged', id: Number(ex.id) };
    }
    this.driver.run('UPDATE scenarios SET name = ?, description = ?, platforms = ?, steps = ?, updated_at = ? WHERE id = ?', [
      s.name,
      s.description,
      j(s.platforms),
      j(s.steps),
      now(),
      ex.id
    ]);
    return { action: 'updated', id: Number(ex.id) };
  }

  saveScenario(s: ScenarioInput): Scenario {
    if (!s.name.trim()) throw new Error('Укажите название сценария');
    if (s.id) {
      this.driver.run('UPDATE scenarios SET name = ?, description = ?, platforms = ?, steps = ?, favorite = ?, user_modified = 1, updated_at = ? WHERE id = ?', [
        s.name,
        s.description,
        j(s.platforms),
        j(s.steps),
        s.favorite,
        now(),
        s.id
      ]);
      return this.getScenario(s.id)!;
    }
    const ts = now();
    const uid = s.uid || `user:scenario:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const id = this.driver.run(
      'INSERT INTO scenarios(uid, name, description, platforms, steps, builtin, favorite, user_modified, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 0, ?, 1, ?, ?)',
      [uid, s.name, s.description, j(s.platforms), j(s.steps), s.favorite, ts, ts]
    ).lastInsertRowid;
    return this.getScenario(id)!;
  }

  setScenarioFavorite(id: number, fav: boolean): void {
    this.driver.run('UPDATE scenarios SET favorite = ? WHERE id = ?', [fav, id]);
  }

  deleteScenario(id: number): void {
    const s = this.getScenario(id);
    if (!s) return;
    if (s.builtin) this.driver.run('UPDATE scenarios SET deleted = 1 WHERE id = ?', [id]);
    else this.driver.run('DELETE FROM scenarios WHERE id = ?', [id]);
  }

  // ---------- История ----------

  addHistory(e: Omit<HistoryEntry, 'id' | 'ts'> & { ts?: string }): void {
    this.driver.run('INSERT INTO history(ts, device_id, device_name, command, source, risk, result, note) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', [
      e.ts ?? now(),
      e.deviceId,
      e.deviceName,
      e.command,
      e.source,
      e.risk,
      e.result,
      e.note ?? ''
    ]);
  }

  listHistory(filter: { deviceId?: number; search?: string; limit?: number; source?: string } = {}): HistoryEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.deviceId) {
      where.push('device_id = ?');
      params.push(filter.deviceId);
    }
    if (filter.source) {
      where.push('source = ?');
      params.push(filter.source);
    }
    if (filter.search) {
      where.push('(command LIKE ? OR device_name LIKE ? OR note LIKE ?)');
      const q = `%${filter.search}%`;
      params.push(q, q, q);
    }
    params.push(filter.limit ?? 1000);
    return this.driver
      .all<Row>(`SELECT * FROM history ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, params)
      .map((r) => ({
        id: Number(r.id),
        ts: String(r.ts),
        deviceId: r.device_id == null ? null : Number(r.device_id),
        deviceName: String(r.device_name),
        command: String(r.command),
        source: r.source as HistoryEntry['source'],
        risk: r.risk as HistoryEntry['risk'],
        result: r.result as HistoryEntry['result'],
        note: String(r.note ?? '')
      }));
  }

  clearHistory(): void {
    this.driver.run('DELETE FROM history');
  }

  // ---------- Заметки ----------

  listNotes(): Note[] {
    return this.driver.all<Row>('SELECT * FROM notes ORDER BY updated_at DESC').map((r) => ({
      id: Number(r.id),
      title: String(r.title),
      body: String(r.body),
      tags: pj(r.tags, []),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    }));
  }

  saveNote(n: Omit<Note, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }): Note {
    const ts = now();
    if (n.id) {
      this.driver.run('UPDATE notes SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?', [n.title, n.body, j(n.tags), ts, n.id]);
      return this.listNotes().find((x) => x.id === n.id)!;
    }
    const id = this.driver.run('INSERT INTO notes(title, body, tags, created_at, updated_at) VALUES(?, ?, ?, ?, ?)', [n.title, n.body, j(n.tags), ts, ts]).lastInsertRowid;
    return this.listNotes().find((x) => x.id === id)!;
  }

  deleteNote(id: number): void {
    this.driver.run('DELETE FROM notes WHERE id = ?', [id]);
  }

  // ---------- Резервные копии конфигураций ----------

  addBackup(r: Omit<BackupRecord, 'id'>): BackupRecord {
    const id = this.driver.run(
      'INSERT INTO backups(device_id, device_name, ts, kind, path, size, sha256, comment, same_as_previous) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [r.deviceId, r.deviceName, r.ts, r.kind, r.path, r.size, r.sha256, r.comment, r.sameAsPrevious]
    ).lastInsertRowid;
    return { ...r, id };
  }

  listBackups(deviceId?: number): BackupRecord[] {
    const rows = deviceId
      ? this.driver.all<Row>('SELECT * FROM backups WHERE device_id = ? ORDER BY ts DESC', [deviceId])
      : this.driver.all<Row>('SELECT * FROM backups ORDER BY ts DESC');
    return rows.map((r) => ({
      id: Number(r.id),
      deviceId: r.device_id == null ? null : Number(r.device_id),
      deviceName: String(r.device_name),
      ts: String(r.ts),
      kind: r.kind as BackupRecord['kind'],
      path: String(r.path),
      size: Number(r.size),
      sha256: String(r.sha256),
      comment: String(r.comment),
      sameAsPrevious: b(r.same_as_previous)
    }));
  }

  getBackup(id: number): BackupRecord | undefined {
    return this.listBackups().find((x) => x.id === id);
  }

  deleteBackup(id: number): void {
    this.driver.run('DELETE FROM backups WHERE id = ?', [id]);
  }

  // ---------- Результаты диагностики ----------

  saveDiagnostic(deviceId: number | null, deviceName: string, task: string, report: DiagnosticReport): DiagnosticResult {
    const ts = now();
    const id = this.driver.run('INSERT INTO diagnostics(device_id, device_name, task, ts, report) VALUES(?, ?, ?, ?, ?)', [deviceId, deviceName, task, ts, j(report)]).lastInsertRowid;
    return { id, deviceId, deviceName, task, ts, report };
  }

  listDiagnostics(deviceId?: number, task?: string, limit = 50): DiagnosticResult[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (deviceId) {
      where.push('device_id = ?');
      params.push(deviceId);
    }
    if (task) {
      where.push('task = ?');
      params.push(task);
    }
    params.push(limit);
    return this.driver
      .all<Row>(`SELECT * FROM diagnostics ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, params)
      .map((r) => ({
        id: Number(r.id),
        deviceId: r.device_id == null ? null : Number(r.device_id),
        deviceName: String(r.device_name),
        task: String(r.task),
        ts: String(r.ts),
        report: pj(r.report, {} as DiagnosticReport)
      }));
  }

  // ---------- Настройки ----------

  getSettings(): Settings {
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of this.driver.all<Row>('SELECT key, value FROM settings')) {
      const k = String(r.key);
      if (k in DEFAULT_SETTINGS) s[k] = pj(r.value, (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k]);
    }
    s.telemetry = false;
    s.monitor = withMonitorDefaults(s.monitor as never);
    return s as unknown as Settings;
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.tx(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_SETTINGS) || k === 'telemetry') continue;
        this.driver.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, j(v)]);
      }
    });
    return this.getSettings();
  }

  // ---------- Профили диагностики ----------

  listProfileOverrides(): DiagnosticProfile[] {
    return this.driver.all<Row>('SELECT * FROM profiles').map((r) => ({
      platform: String(r.platform),
      task: String(r.task),
      steps: pj(r.steps, []),
      note: (r.note as string) ?? undefined,
      userModified: b(r.user_modified)
    }));
  }

  saveProfile(p: DiagnosticProfile): void {
    this.driver.run(
      'INSERT INTO profiles(platform, task, steps, note, user_modified) VALUES(?, ?, ?, ?, 1) ON CONFLICT(platform, task) DO UPDATE SET steps = excluded.steps, note = excluded.note, user_modified = 1',
      [p.platform, p.task, j(p.steps), p.note ?? null]
    );
  }

  resetProfile(platform: string, task: string): void {
    this.driver.run('DELETE FROM profiles WHERE platform = ? AND task = ?', [platform, task]);
  }

  // ---------- Пользовательские параметры шаблонов ----------

  listTemplateParams(): TemplateParamDef[] {
    return this.driver.all<Row>('SELECT * FROM template_params ORDER BY name').map((r) => ({
      name: String(r.name),
      label: String(r.label),
      type: r.type as TemplateParamDef['type'],
      regex: (r.regex as string) ?? undefined,
      description: (r.description as string) ?? undefined,
      builtin: false
    }));
  }

  saveTemplateParam(p: TemplateParamDef): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) throw new Error('Имя параметра: латинские буквы, цифры и _');
    this.driver.run(
      'INSERT INTO template_params(name, label, type, regex, description) VALUES(?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET label = excluded.label, type = excluded.type, regex = excluded.regex, description = excluded.description',
      [p.name.toUpperCase(), p.label, p.type, p.regex ?? null, p.description ?? null]
    );
  }

  deleteTemplateParam(name: string): void {
    this.driver.run('DELETE FROM template_params WHERE name = ?', [name]);
  }

  // ---------- Отчёты импорта ----------

  addImportReport(file: string, report: TxtParseReport): ImportReportRecord {
    const ts = now();
    const id = this.driver.run('INSERT INTO import_reports(ts, file, report) VALUES(?, ?, ?)', [ts, file, j(report)]).lastInsertRowid;
    return { id, ts, file, report };
  }

  listImportReports(): ImportReportRecord[] {
    return this.driver.all<Row>('SELECT * FROM import_reports ORDER BY id DESC').map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      file: String(r.file),
      report: pj(r.report, {} as TxtParseReport)
    }));
  }

  // ---------- Пользовательские платформы ----------

  listCustomPlatforms(): { id: string; name: string; vendor: string }[] {
    return this.driver.all<Row>('SELECT * FROM custom_platforms ORDER BY name').map((r) => ({ id: String(r.id), name: String(r.name), vendor: String(r.vendor) }));
  }

  saveCustomPlatform(id: string, name: string, vendor = ''): void {
    this.driver.run('INSERT INTO custom_platforms(id, name, vendor) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, vendor = excluded.vendor', [id, name, vendor]);
  }

  // ---------- Секреты приложения (не привязанные к устройству) ----------

  getAppSecret(key: string): { scheme: string; blob: string } | undefined {
    return this.driver.get<{ scheme: string; blob: string }>('SELECT scheme, blob FROM app_secrets WHERE key = ?', [key]);
  }

  setAppSecret(key: string, scheme: string, blob: string): void {
    this.driver.run('INSERT INTO app_secrets(key, scheme, blob, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET scheme = excluded.scheme, blob = excluded.blob, updated_at = excluded.updated_at', [key, scheme, blob, now()]);
  }

  deleteAppSecret(key: string): void {
    this.driver.run('DELETE FROM app_secrets WHERE key = ?', [key]);
  }

  listAppSecretRows(): { key: string; scheme: string; blob: string }[] {
    return this.driver.all<Row>('SELECT key, scheme, blob FROM app_secrets').map((r) => ({ key: String(r.key), scheme: String(r.scheme), blob: String(r.blob) }));
  }

  // ---------- Мониторинг ----------

  listMonitorNodes(): MonitorNode[] {
    const withSecret = new Set(this.listAppSecretRows().map((r) => r.key));
    return this.driver.all<Row>('SELECT * FROM monitor_nodes ORDER BY name COLLATE NOCASE, id').map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      host: String(r.host),
      kind: String(r.kind) as MonitorNode['kind'],
      vendor: String(r.vendor),
      method: String(r.method) as MonitorNode['method'],
      snmpVersion: Number(r.snmp_version) === 1 ? 1 : 2,
      snmpPort: Number(r.snmp_port),
      tcpPort: Number(r.tcp_port),
      intervalSec: Number(r.interval_sec),
      enabled: !!Number(r.enabled),
      deviceId: r.device_id == null ? null : Number(r.device_id),
      notes: String(r.notes),
      hasCommunity: withSecret.has(`monitor:community:${r.id}`),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    }));
  }

  getMonitorNode(id: number): MonitorNode | undefined {
    return this.listMonitorNodes().find((n) => n.id === id);
  }

  saveMonitorNode(n: MonitorNodeInput): MonitorNode {
    const ts = now();
    const vals = [n.name.trim(), n.host.trim(), n.kind, n.vendor, n.method, n.snmpVersion, n.snmpPort, n.tcpPort, n.intervalSec, n.enabled ? 1 : 0, n.deviceId, n.notes];
    let id = n.id;
    if (id) this.driver.run('UPDATE monitor_nodes SET name = ?, host = ?, kind = ?, vendor = ?, method = ?, snmp_version = ?, snmp_port = ?, tcp_port = ?, interval_sec = ?, enabled = ?, device_id = ?, notes = ?, updated_at = ? WHERE id = ?', [...vals, ts, id]);
    else id = this.driver.run('INSERT INTO monitor_nodes(name, host, kind, vendor, method, snmp_version, snmp_port, tcp_port, interval_sec, enabled, device_id, notes, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...vals, ts, ts]).lastInsertRowid;
    return this.getMonitorNode(id)!;
  }

  deleteMonitorNode(id: number): void {
    this.tx(() => {
      this.driver.run('DELETE FROM monitor_map_items WHERE node_id = ?', [id]);
      this.driver.run('DELETE FROM monitor_links WHERE a = ? OR b = ?', [id, id]);
      this.driver.run('DELETE FROM monitor_nodes WHERE id = ?', [id]);
      this.deleteAppSecret(`monitor:community:${id}`);
    });
  }

  listMonitorMaps(): MonitorMap[] {
    const items = this.driver.all<Row>('SELECT * FROM monitor_map_items');
    const links = this.driver.all<Row>('SELECT * FROM monitor_links ORDER BY id');
    return this.driver.all<Row>('SELECT * FROM monitor_maps ORDER BY id').map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      background: String(r.background),
      width: Number(r.width),
      height: Number(r.height),
      items: items.filter((i) => Number(i.map_id) === Number(r.id)).map((i): MapItem => ({ nodeId: Number(i.node_id), x: Number(i.x), y: Number(i.y) })),
      links: links.filter((l) => Number(l.map_id) === Number(r.id)).map((l): MapLink => ({ id: Number(l.id), a: Number(l.a), b: Number(l.b), label: String(l.label) })),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    }));
  }

  /** Карта целиком: свойства, расположение узлов и связи заменяются переданными. */
  saveMonitorMap(m: MonitorMapInput): MonitorMap {
    const ts = now();
    const nodes = new Set(this.driver.all<Row>('SELECT id FROM monitor_nodes').map((r) => Number(r.id)));
    const id = this.tx(() => {
      let mid = m.id;
      if (mid) this.driver.run('UPDATE monitor_maps SET name = ?, background = ?, width = ?, height = ?, updated_at = ? WHERE id = ?', [m.name.trim() || 'Карта', m.background, m.width, m.height, ts, mid]);
      else mid = this.driver.run('INSERT INTO monitor_maps(name, background, width, height, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)', [m.name.trim() || 'Карта', m.background, m.width, m.height, ts, ts]).lastInsertRowid;
      this.driver.run('DELETE FROM monitor_map_items WHERE map_id = ?', [mid]);
      this.driver.run('DELETE FROM monitor_links WHERE map_id = ?', [mid]);
      const seen = new Set<number>();
      for (const it of m.items) {
        if (!nodes.has(it.nodeId) || seen.has(it.nodeId)) continue;
        seen.add(it.nodeId);
        this.driver.run('INSERT INTO monitor_map_items(map_id, node_id, x, y) VALUES(?, ?, ?, ?)', [mid, it.nodeId, Math.round(it.x), Math.round(it.y)]);
      }
      const pairs = new Set<string>();
      for (const l of m.links) {
        const key = [Math.min(l.a, l.b), Math.max(l.a, l.b)].join('-');
        if (l.a === l.b || !seen.has(l.a) || !seen.has(l.b) || pairs.has(key)) continue;
        pairs.add(key);
        this.driver.run('INSERT INTO monitor_links(map_id, a, b, label) VALUES(?, ?, ?, ?)', [mid, l.a, l.b, l.label ?? '']);
      }
      return mid;
    });
    return this.listMonitorMaps().find((x) => x.id === id)!;
  }

  deleteMonitorMap(id: number): void {
    this.tx(() => {
      this.driver.run('DELETE FROM monitor_map_items WHERE map_id = ?', [id]);
      this.driver.run('DELETE FROM monitor_links WHERE map_id = ?', [id]);
      this.driver.run('DELETE FROM monitor_maps WHERE id = ?', [id]);
    });
  }

  addMonitorEvent(e: { nodeId: number | null; nodeName: string; level: MonitorEventLevel; type: MonitorEventType; message: string; ts?: string }): MonitorEvent {
    const ts = e.ts ?? now();
    const id = this.driver.run('INSERT INTO monitor_events(ts, node_id, node_name, level, type, message) VALUES(?, ?, ?, ?, ?, ?)', [ts, e.nodeId, e.nodeName, e.level, e.type, e.message]).lastInsertRowid;
    return { id, ts, nodeId: e.nodeId, nodeName: e.nodeName, level: e.level, type: e.type, message: e.message };
  }

  listMonitorEvents(filter: { nodeId?: number; limit?: number; level?: MonitorEventLevel } = {}): MonitorEvent[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.nodeId) {
      where.push('node_id = ?');
      args.push(filter.nodeId);
    }
    if (filter.level) {
      where.push('level = ?');
      args.push(filter.level);
    }
    const sql = `SELECT * FROM monitor_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${Math.min(Math.max(filter.limit ?? 500, 1), 5000)}`;
    return this.driver.all<Row>(sql, args).map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      nodeId: r.node_id == null ? null : Number(r.node_id),
      nodeName: String(r.node_name),
      level: String(r.level) as MonitorEventLevel,
      type: String(r.type) as MonitorEventType,
      message: String(r.message)
    }));
  }

  /** Хранить не больше keep последних событий. */
  pruneMonitorEvents(keep = 20000): void {
    this.driver.run('DELETE FROM monitor_events WHERE id <= (SELECT id FROM monitor_events ORDER BY id DESC LIMIT 1 OFFSET ?)', [keep]);
  }

  clearMonitorEvents(): void {
    this.driver.run('DELETE FROM monitor_events');
  }
}
