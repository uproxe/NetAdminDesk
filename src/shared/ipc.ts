// Контракт IPC между интерфейсом и main-процессом. Preload открывает только перечисленные методы.
import type {
  CommandKind,
  AppInfo,
  BackupRecord,
  CaptureResult,
  CommandInput,
  CommandRecord,
  Device,
  DeviceGroup,
  DeviceInput,
  DeviceSecretsInput,
  DeviceSecretsState,
  ProbeResult,
  DiagnosticProfile,
  DiagnosticReport,
  DiagnosticResult,
  ExecResult,
  HistoryEntry,
  HistorySource,
  ImportPreviewItem,
  ImportReportRecord,
  KnownHost,
  Note,
  RiskLevel,
  Scenario,
  ScenarioInput,
  SessionInfo,
  Settings,
  SftpEntry,
  TemplateParamDef,
  TunnelInfo,
  TunnelSpec,
  TxtParseReport,
  VaultStatus
} from './types';
import type { DiffHunk } from './diff';
import type { MonitorEvent, MonitorMap, MonitorMapInput, MonitorNode, MonitorNodeInput, MonitorState, MonitorStatusInfo } from './monitor';

export const API_SPEC = {
  app: ['info', 'openExternal', 'showItemInFolder', 'openPath', 'selectFile', 'selectSaveFile', 'selectDirectory', 'clipboardWrite', 'clipboardRead', 'setZoom', 'relaunch', 'readTextFile', 'writeTextFile', 'ready'],
  settings: ['get', 'set'],
  commands: ['list', 'save', 'remove', 'setFlags', 'restoreDeleted'],
  devices: ['list', 'save', 'remove', 'duplicate', 'setFavorite', 'secretsState', 'knownHosts', 'forgetHostKey'],
  groups: ['list', 'save', 'remove'],
  scenarios: ['list', 'save', 'remove', 'setFavorite'],
  history: ['list', 'clear', 'add'],
  notes: ['list', 'save', 'remove'],
  vault: ['status', 'setupMaster', 'unlock', 'lock', 'changeMaster', 'switchMode'],
  ssh: ['connect', 'write', 'resize', 'disconnect', 'list', 'send', 'capture', 'exec', 'sendEnable', 'probe'],
  serial: ['feed', 'opened', 'closed', 'listBegin', 'listEnd'],
  tools: ['run', 'stop', 'tcpCheck', 'createKey'],
  prompts: ['respond'],
  sftp: ['list', 'download', 'upload', 'mkdir', 'rename', 'remove', 'home'],
  tunnels: ['list', 'start', 'stop'],
  backups: ['list', 'fetchSwitchConfig', 'read', 'diff', 'remove', 'downloadLinux'],
  diagnostics: ['save', 'list'],
  profiles: ['list', 'save', 'reset'],
  templates: ['listParams', 'saveParam', 'removeParam'],
  io: [
    'previewTxt',
    'importTxt',
    'exportTxt',
    'exportJson',
    'previewJson',
    'importJson',
    'previewDevicesCsv',
    'importDevicesCsv',
    'previewSshConfig',
    'importSshConfig',
    'exportEncrypted',
    'exportDevices',
    'exportDevicesCsv',
    'previewDevicesFile',
    'importDevicesFile',
    'previewEncrypted',
    'importEncrypted',
    'backupDatabase',
    'restoreDatabase',
    'importReports'
  ],
  db: ['integrity', 'autoBackups', 'restoreAutoBackup'],
  monitor: ['status', 'states', 'nodes', 'saveNode', 'removeNode', 'bulkAdd', 'maps', 'saveMap', 'removeMap', 'events', 'clearEvents', 'checkNow', 'ports', 'clearPorts', 'setSecret', 'testMail', 'applySettings']
} as const;

export type ApiNamespace = keyof typeof API_SPEC;

export const EVENT_CHANNEL = 'nad:event';

export type NadEvent =
  | { type: 'ssh:data'; id: string; data: string }
  | { type: 'ssh:status'; info: SessionInfo }
  | { type: 'ssh:closed'; id: string }
  | { type: 'prompt'; prompt: AnyPrompt }
  | { type: 'tunnels:changed'; tunnels: TunnelInfo[] }
  | { type: 'menu'; action: string }
  | { type: 'app:error'; message: string }
  | { type: 'serial:open'; id: string; portName: string; baudRate: number }
  | { type: 'serial:write'; id: string; data: string }
  | { type: 'serial:close'; id: string }
  | { type: 'tools:output'; runId: string; chunk: string }
  | { type: 'tools:done'; runId: string; code: number | null }
  | { type: 'data:changed'; what: 'commands' | 'devices' | 'scenarios' | 'history' | 'settings' | 'monitor' | 'all' }
  | { type: 'monitor:states'; states: MonitorState[] }
  | { type: 'monitor:event'; event: MonitorEvent }
  | { type: 'monitor:status'; status: MonitorStatusInfo };

export type AnyPrompt =
  | ({ kind: 'hostKey' } & import('./types').HostKeyPrompt)
  | ({ kind: 'kbd' } & import('./types').KbdPrompt)
  | { kind: 'credentials'; requestId: string; deviceName: string; secretKind: string; message: string };

export interface SendMeta {
  source: HistorySource;
  risk?: RiskLevel;
  note?: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface TxtPreview {
  report: TxtParseReport;
  items: ImportPreviewItem[];
}

export interface JsonPreview {
  commands: { total: number; new: number; same: number; conflicts: { uid: string; title: string }[] };
  scenarios: { total: number; new: number; conflicts: number };
  devices: { total: number; new: number; existing: number };
  notes: number;
}

export interface DevicesPreview {
  devices: (DeviceInput & { hasPassword?: boolean; duplicateOf?: string; warnings: string[] })[];
  hasPasswordColumn: boolean;
  errors: string[];
}

export interface DevicesExportOptions {
  /** Какие устройства; пусто или не задано — все. Узлы-посредники (jump host) добавляются автоматически. */
  deviceIds?: number[];
  knownHosts: boolean;
  /** Сохранённые пароли: только вместе с password — файл тогда шифруется (AES-256-GCM, ключ из пароля через scrypt). */
  secrets: boolean;
  password?: string;
}

export interface DevicesFilePreview {
  /** Файл зашифрован: для просмотра и импорта нужен пароль. */
  encrypted: boolean;
  needsPassword: boolean;
  /** Что за файл: перенос устройств или полная копия / экспорт данных (из них будут взяты только устройства). */
  content: 'devices' | 'data' | 'full';
  createdAt?: string;
  appVersion?: string;
  devices: { name: string; host: string; port: number; protocol: string; username: string; group: string; duplicateOf?: string; hasSecret: boolean; warnings: string[] }[];
  groups: number;
  knownHosts: number;
  knownHostConflicts: number;
  secrets: number;
}

export interface EncryptedPreview {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
}

export interface NadApi {
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): Promise<void>;
    openPath(path: string): Promise<string>;
    selectFile(opts: { title?: string; filters?: FileFilter[] }): Promise<string | null>;
    selectSaveFile(opts: { title?: string; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>;
    selectDirectory(opts: { title?: string }): Promise<string | null>;
    clipboardWrite(text: string): Promise<void>;
    clipboardRead(): Promise<string>;
    setZoom(factor: number): Promise<void>;
    relaunch(): Promise<void>;
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
    ready(): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  commands: {
    list(): Promise<CommandRecord[]>;
    save(c: CommandInput): Promise<CommandRecord>;
    remove(id: number): Promise<void>;
    setFlags(id: number, flags: { favorite?: boolean; verified?: boolean }): Promise<CommandRecord>;
    restoreDeleted(): Promise<number>;
  };
  devices: {
    list(): Promise<Device[]>;
    save(d: DeviceInput, secrets?: DeviceSecretsInput): Promise<Device>;
    remove(id: number): Promise<void>;
    duplicate(id: number): Promise<Device>;
    setFavorite(id: number, fav: boolean): Promise<void>;
    secretsState(id: number): Promise<DeviceSecretsState>;
    knownHosts(): Promise<KnownHost[]>;
    forgetHostKey(host: string, port: number): Promise<void>;
  };
  groups: {
    list(): Promise<DeviceGroup[]>;
    save(g: Omit<DeviceGroup, 'id'> & { id?: number }): Promise<DeviceGroup>;
    remove(id: number): Promise<void>;
  };
  scenarios: {
    list(): Promise<Scenario[]>;
    save(s: ScenarioInput): Promise<Scenario>;
    remove(id: number): Promise<void>;
    setFavorite(id: number, fav: boolean): Promise<void>;
  };
  history: {
    list(filter?: { deviceId?: number; search?: string; limit?: number; source?: string }): Promise<HistoryEntry[]>;
    clear(): Promise<void>;
    add(e: Omit<HistoryEntry, 'id' | 'ts'>): Promise<void>;
  };
  notes: {
    list(): Promise<Note[]>;
    save(n: Omit<Note, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }): Promise<Note>;
    remove(id: number): Promise<void>;
  };
  vault: {
    status(): Promise<VaultStatus>;
    setupMaster(password: string): Promise<VaultStatus>;
    unlock(password: string): Promise<boolean>;
    lock(): Promise<void>;
    changeMaster(oldPassword: string, newPassword: string): Promise<void>;
    switchMode(mode: 'os' | 'prompt'): Promise<VaultStatus>;
  };
  ssh: {
    connect(deviceId: number, size: { cols: number; rows: number }): Promise<SessionInfo>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    disconnect(id: string): Promise<void>;
    list(): Promise<SessionInfo[]>;
    send(id: string, command: string, meta: SendMeta): Promise<void>;
    capture(id: string, command: string, opts: { timeoutMs?: number; idleMs?: number }, meta: SendMeta): Promise<CaptureResult>;
    exec(id: string, command: string, meta: SendMeta, timeoutMs?: number): Promise<ExecResult>;
    sendEnable(id: string): Promise<boolean>;
    /** Проверка доступности SSH-порта устройства (DNS, TCP, приветствие) без входа. */
    probe(deviceId: number): Promise<ProbeResult>;
  };
  serial: {
    /** Данные из COM-порта → сессия в main-процессе. */
    feed(id: string, text: string): Promise<void>;
    /** Результат открытия порта: без ошибки — открыт; 'not-found' — порт с таким именем не найден. */
    opened(id: string, error?: string): Promise<void>;
    closed(id: string, reason?: string): Promise<void>;
    listBegin(): Promise<void>;
    listEnd(): Promise<{ portId: string; portName: string; displayName?: string; vendorId?: string; productId?: string }[]>;
  };
  tools: {
    /** ping или трассировка с этого компьютера; вывод приходит событиями tools:output. */
    run(tool: 'ping' | 'traceroute', host: string): Promise<{ runId: string; commandLine: string }>;
    stop(runId: string): Promise<void>;
    tcpCheck(host: string, ports: number[]): Promise<{ port: number; ok: boolean; ms: number; text: string }[]>;
    /** Создаёт ключ ed25519: приватный — в файл path (права 600), открытый — в path.pub. */
    createKey(opts: { path: string; comment: string; passphrase?: string }): Promise<{ path: string; publicKey: string; fingerprint: string }>;
  };
  prompts: {
    respond(requestId: string, answer: unknown): Promise<void>;
  };
  monitor: {
    status(): Promise<MonitorStatusInfo>;
    states(): Promise<MonitorState[]>;
    nodes(): Promise<MonitorNode[]>;
    /** community: undefined — не менять, '' — удалить; хранится в защищённом хранилище. */
    saveNode(n: MonitorNodeInput): Promise<MonitorNode>;
    removeNode(id: number): Promise<void>;
    bulkAdd(nodes: MonitorNodeInput[]): Promise<number>;
    maps(): Promise<MonitorMap[]>;
    saveMap(m: MonitorMapInput): Promise<MonitorMap>;
    removeMap(id: number): Promise<void>;
    events(filter?: { nodeId?: number; limit?: number }): Promise<MonitorEvent[]>;
    clearEvents(): Promise<void>;
    checkNow(id: number): Promise<MonitorState | undefined>;
    ports(id: number): Promise<{ ifIndex: number; name: string; alias: string; oper: string; admin: string; speedMbps: number }[]>;
    clearPorts(id: number): Promise<void>;
    /** Пароль почты (smtp-password) или community для проверки трапов (trap-community). */
    setSecret(which: 'smtp-password' | 'trap-community', value: string | null): Promise<void>;
    testMail(): Promise<void>;
    /** Применить изменённые настройки мониторинга (запуск/остановка опроса и приёма трапов). */
    applySettings(): Promise<MonitorStatusInfo>;
  };
  sftp: {
    list(sessionId: string, path: string): Promise<SftpEntry[]>;
    download(sessionId: string, remote: string, local: string): Promise<void>;
    upload(sessionId: string, local: string, remote: string): Promise<void>;
    mkdir(sessionId: string, path: string): Promise<void>;
    rename(sessionId: string, from: string, to: string): Promise<void>;
    remove(sessionId: string, path: string, isDir: boolean): Promise<void>;
    home(sessionId: string): Promise<string>;
  };
  tunnels: {
    list(): Promise<TunnelInfo[]>;
    start(spec: TunnelSpec): Promise<TunnelInfo>;
    stop(id: string): Promise<void>;
  };
  backups: {
    list(deviceId?: number): Promise<BackupRecord[]>;
    fetchSwitchConfig(sessionId: string, opts?: { command?: string; comment?: string }): Promise<BackupRecord>;
    read(id: number): Promise<string>;
    diff(aId: number, bId: number, opts?: { ignoreWhitespace?: boolean; ignoreVolatile?: boolean }): Promise<{ hunks: DiffHunk[]; stats: { added: number; removed: number; unchanged: number } }>;
    remove(id: number, deleteFile: boolean): Promise<void>;
    downloadLinux(sessionId: string, paths: string[], comment?: string): Promise<BackupRecord>;
  };
  diagnostics: {
    save(deviceId: number | null, deviceName: string, task: string, report: DiagnosticReport): Promise<DiagnosticResult>;
    list(deviceId?: number, task?: string): Promise<DiagnosticResult[]>;
  };
  profiles: {
    list(): Promise<DiagnosticProfile[]>;
    save(p: DiagnosticProfile): Promise<void>;
    reset(platform: string, task: string): Promise<void>;
  };
  templates: {
    listParams(): Promise<TemplateParamDef[]>;
    saveParam(p: TemplateParamDef): Promise<void>;
    removeParam(name: string): Promise<void>;
  };
  io: {
    previewTxt(path: string): Promise<TxtPreview>;
    importTxt(path: string, opts: { skipDuplicates: boolean }): Promise<TxtParseReport>;
    exportTxt(path: string, opts: { kinds: CommandKind[]; sources?: string[] }): Promise<number>;
    exportJson(path: string): Promise<number>;
    previewJson(path: string): Promise<JsonPreview>;
    importJson(path: string, opts: { overwriteConflicts: boolean }): Promise<JsonPreview>;
    previewDevicesCsv(path: string): Promise<DevicesPreview>;
    importDevicesCsv(path: string, opts: { importPasswords: boolean; skipDuplicates: boolean }): Promise<number>;
    previewSshConfig(path?: string): Promise<DevicesPreview>;
    importSshConfig(path: string | undefined, opts: { skipDuplicates: boolean }): Promise<number>;
    exportEncrypted(path: string, password: string, opts: { includeHistory: boolean }): Promise<Record<string, number>>;
    /** Файл переноса устройств на другой компьютер. С паролями — только зашифрованный паролем файла. */
    exportDevices(path: string, opts: DevicesExportOptions): Promise<Record<string, number>>;
    /** Таблица CSV (без паролей) — для Excel; читается «Импорт → CSV». */
    exportDevicesCsv(path: string, deviceIds?: number[]): Promise<number>;
    previewDevicesFile(path: string, password?: string): Promise<DevicesFilePreview>;
    importDevicesFile(path: string, opts: { password?: string; overwrite: boolean; knownHosts: boolean; secrets: boolean }): Promise<Record<string, number>>;
    previewEncrypted(path: string, password: string): Promise<EncryptedPreview>;
    importEncrypted(path: string, password: string, opts: { overwriteConflicts: boolean; importSettings: boolean }): Promise<Record<string, number>>;
    backupDatabase(path: string): Promise<void>;
    restoreDatabase(path: string): Promise<void>;
    importReports(): Promise<ImportReportRecord[]>;
  };
  db: {
    integrity(): Promise<string>;
    autoBackups(): Promise<{ name: string; size: number; mtime: string }[]>;
    restoreAutoBackup(name: string): Promise<void>;
  };
  on(listener: (e: NadEvent) => void): () => void;
}
