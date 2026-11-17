// Общие типы NetAdmin Desk (используются main, preload и renderer).

export type RiskLevel = 'info' | 'change' | 'danger' | 'critical';
/** Раздел справочника: команды коммутаторов, Linux или SQL (MySQL / MariaDB / PostgreSQL). */
export type CommandKind = 'switch' | 'linux' | 'sql';
/** Происхождение записи справочника. */
export type CommandSource = 'user_txt' | 'builtin' | 'user' | 'imported';
export type EntryType = 'command' | 'sequence' | 'note';
export type CommandMode = 'exec' | 'config' | 'shell' | 'any';

export interface LineNote {
  /** Номер строки команды внутри записи (0..n-1). */
  index: number;
  /** Пояснение к строке из исходного файла. */
  note: string;
  /** Приглашение/режим, указанный в исходной строке, например «(config-if)#». */
  prompt?: string;
}

export interface CommandExample {
  cmd: string;
  desc: string;
}

export interface CommandDetails {
  syntax?: string;
  params?: { name: string; desc: string }[];
  examples?: CommandExample[];
  /** Пояснение результата выполнения. */
  output?: string;
  /** Пример вывода из исходного файла (сохраняется дословно). */
  exampleOutput?: string;
  privileges?: string;
  compat?: string;
  /** Пакет, если команда не входит в базовую установку. */
  package?: string;
  preinstalled?: boolean;
  warnings?: string[];
  verify?: string;
  related?: string[];
  docs?: string;
  versionNotes?: string;
  lineNotes?: LineNote[];
  /** Заголовок раздела исходного TXT (например «###SG300###»). */
  sectionHeader?: string;
  /** Примечание о том, на чём основано предположение о синтаксисе. */
  assumption?: string;
}

export interface CommandRecord {
  id: number;
  uid: string;
  kind: CommandKind;
  entryType: EntryType;
  platform: string;
  vendorLabel: string;
  model?: string;
  os?: string;
  category: string;
  title: string;
  /** Точная команда или последовательность (несколько строк). */
  command: string;
  description: string;
  details: CommandDetails;
  /** Исходный текст дословно (для записей из файлов). */
  rawText?: string;
  /** Шаблон с параметрами {{NAME}}; исходная команда сохраняется отдельно. */
  template?: string | null;
  risk: RiskLevel;
  /** true — уровень риска изменён пользователем вручную. */
  riskManual: boolean;
  mode: CommandMode;
  source: CommandSource;
  verified: boolean;
  needsReview: boolean;
  reviewNote?: string;
  vendorUnknown: boolean;
  sensitive: boolean;
  favorite: boolean;
  userModified: boolean;
  tags: string[];
  originFile?: string;
  originLine?: number;
  createdAt: string;
  updatedAt: string;
}

export type CommandInput = Omit<CommandRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: number };

export type DeviceColor = '' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

export type AuthMethod = 'password' | 'key' | 'agent' | 'keyboard-interactive';

export interface Device {
  id: number;
  name: string;
  host: string;
  port: number;
  vendor: string;
  model: string;
  platform: string;
  deviceType: string;
  osVersion: string;
  username: string;
  authMethod: AuthMethod;
  keyPath: string;
  description: string;
  location: string;
  groupId: number | null;
  tags: string[];
  favorite: boolean;
  // Linux
  linuxDistro: string;
  linuxVersion: string;
  hostname: string;
  serverType: string;
  servicesNotes: string;
  connectionNotes: string;
  // Подключение
  legacyAlgorithms: boolean;
  autoEnable: boolean;
  disablePagerOnConnect: boolean;
  readOnly: boolean;
  keepaliveSec: number;
  timeoutSec: number;
  jumpDeviceId: number | null;
  /** Протокол: ssh (по умолчанию), telnet (без шифрования, для старого оборудования), serial (COM/USB-консоль). */
  protocol: SessionProtocol;
  /** Скорость COM-порта, бод (для protocol = serial). Формат 8N1 без управления потоком. */
  serialBaud: number;
  /** Команды, отправляемые видимо в терминал сразу после входа (по одной на строку). */
  loginCommands: string;
  /** Цвет метки устройства и вкладки (например, красный для «боевых»). */
  color: DeviceColor;
  lastConnectedAt: string | null;
  lastStatus: 'never' | 'ok' | 'error';
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

export type DeviceInput = Omit<Device, 'id' | 'createdAt' | 'updatedAt' | 'lastConnectedAt' | 'lastStatus' | 'lastError'> & {
  id?: number;
};

export interface DeviceSecretsInput {
  password?: string | null;
  keyPassphrase?: string | null;
  enablePassword?: string | null;
}

export interface DeviceSecretsState {
  password: boolean;
  keyPassphrase: boolean;
  enablePassword: boolean;
}

export interface DeviceGroup {
  id: number;
  name: string;
  parentId: number | null;
  kind: 'group' | 'folder';
  sort: number;
}

export interface ScenarioStep {
  id: string;
  title: string;
  /** Команда или шаблон. Может содержать несколько строк. */
  command: string;
  note?: string;
  risk?: RiskLevel;
  /** Ссылка на запись справочника, из которой собран шаг. */
  commandUid?: string;
  /** Платформа шага; пусто — совпадает с платформами сценария. */
  platform?: string;
  /** Пауза после шага, мс. */
  waitMs?: number;
}

export interface Scenario {
  id: number;
  uid: string;
  name: string;
  description: string;
  platforms: string[];
  steps: ScenarioStep[];
  builtin: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ScenarioInput = Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'> & { id?: number };

export type HistorySource = 'reference' | 'scenario' | 'diagnostic' | 'typed' | 'backup' | 'mac-search' | 'template' | 'compose';

export interface HistoryEntry {
  id: number;
  ts: string;
  deviceId: number | null;
  deviceName: string;
  command: string;
  source: HistorySource;
  risk: RiskLevel;
  result: 'sent' | 'cancelled' | 'blocked' | 'error' | 'done';
  note: string;
}

export interface Note {
  id: number;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BackupRecord {
  id: number;
  deviceId: number | null;
  deviceName: string;
  ts: string;
  kind: 'switch-config' | 'linux-files';
  path: string;
  size: number;
  sha256: string;
  comment: string;
  sameAsPrevious: boolean;
}

export interface KnownHost {
  id: number;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  firstSeen: string;
  lastSeen: string;
}

export interface DiagnosticResult {
  id: number;
  deviceId: number | null;
  deviceName: string;
  task: string;
  ts: string;
  report: DiagnosticReport;
}

export type CheckStatus = 'ok' | 'warn' | 'crit' | 'info' | 'unknown';

export interface DiagnosticCheck {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  criteria: string;
  metrics?: Record<string, number>;
  commands: { command: string; output: string; code?: number | null; error?: string }[];
  findings: string[];
}

export interface DiagnosticReport {
  task: string;
  title: string;
  deviceName: string;
  platform: string;
  startedAt: string;
  finishedAt: string;
  checks: DiagnosticCheck[];
}

export interface ThemeSettings {
  theme: 'dark' | 'light';
  uiScale: number;
  uiFont: string;
  monoFont: string;
}

export interface Settings extends ThemeSettings {
  terminalFontSize: number;
  terminalScrollback: number;
  terminalCursorBlink: boolean;
  copyOnSelect: boolean;
  readOnlyMode: boolean;
  logTypedCommands: boolean;
  saveSessionLogs: boolean;
  confirmChangeCommands: boolean;
  allowMassConfig: boolean;
  ctrlKInTerminal: boolean;
  defaultKeepaliveSec: number;
  defaultTimeoutSec: number;
  vaultMode: 'os' | 'master' | 'prompt' | 'unset';
  showSensitive: boolean;
  sidebarCollapsed: boolean;
  /** Уровень интерфейса: «простой» прячет редкие разделы и кнопки в «Ещё», «полный» показывает всё. */
  uiMode: 'simple' | 'full';
  /** Свёрнутые группы бокового меню (ref, tools). */
  navCollapsed: string[];
  /** Ручные настройки пунктов меню: show — всегда видно, more — убрано в «Ещё». */
  navOverrides: Record<string, 'show' | 'more'>;
  /** Подсветка ключевых слов в выводе терминала (up/down, ошибки, IP, MAC). */
  terminalHighlight: boolean;
  /** Панель быстрых команд (избранное для платформы) над терминалом. */
  quickCommandsBar: boolean;
  splitRatio: number;
  lastSection: string;
  telemetry: false;
}

export interface VaultStatus {
  mode: Settings['vaultMode'];
  osAvailable: boolean;
  osBackend: string;
  osSecure: boolean;
  masterConfigured: boolean;
  unlocked: boolean;
}

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  dataDir: string;
  dbPath: string;
  portable: boolean;
  electron: string;
  node: string;
  chrome: string;
  schemaVersion: number;
  dbDriver: string;
}

/** Встроенное руководство (раздел «Обучение»). */
export interface Guide {
  id: string;
  section: 'start' | 'network' | 'switch' | 'linux' | 'db' | 'troubleshoot' | 'glossary';
  level: 'новичок' | 'базовый' | 'опытный';
  title: string;
  summary: string;
  /** Текст в упрощённой разметке: ## заголовки, списки, блоки ```платформа, `код`, **жирный**, > предупреждение, [[id]]. */
  body: string;
  tags: string[];
}

export interface ProbeStep {
  step: 'dns' | 'tcp' | 'banner';
  ok: boolean;
  text: string;
}

export interface ProbeResult {
  steps: ProbeStep[];
  conclusion: string;
  ok: boolean;
}

export type SessionStatus = 'connecting' | 'authenticating' | 'ready' | 'closed' | 'error';

export type SessionProtocol = 'ssh' | 'telnet' | 'serial';

export interface SessionInfo {
  id: string;
  deviceId: number;
  deviceName: string;
  host: string;
  platform: string;
  protocol: SessionProtocol;
  status: SessionStatus;
  error?: string;
  startedAt: string;
}

export interface CaptureResult {
  command: string;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecResult {
  command: string;
  stdout: string;
  stderr: string;
  code: number | null;
  durationMs: number;
}

export interface HostKeyPrompt {
  requestId: string;
  deviceName: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  /** Известный ранее отпечаток (если ключ изменился). */
  knownFingerprint?: string;
  knownKeyType?: string;
  mismatch: boolean;
}

export interface KbdPrompt {
  requestId: string;
  deviceName: string;
  name: string;
  instructions: string;
  prompts: { prompt: string; echo: boolean }[];
}

export interface SftpEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  mode: string;
}

export interface TunnelSpec {
  sessionId: string;
  type: 'local' | 'remote' | 'dynamic';
  bindHost: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
}

export interface TunnelInfo extends TunnelSpec {
  id: string;
  status: 'listening' | 'error' | 'stopped';
  error?: string;
  connections: number;
}

export interface ImportPreviewItem {
  title: string;
  command: string;
  platform: string;
  vendorLabel: string;
  category: string;
  entryType: EntryType;
  startLine: number;
  flags: string[];
  duplicateOf?: string;
}

export interface DiagnosticProfileStep {
  command: string;
  note?: string;
  /** Команда взята из пользовательского TXT. */
  fromUserTxt?: boolean;
  /** Синтаксис не подтверждён документацией/пользователем. */
  unverified?: boolean;
}

export interface DiagnosticProfile {
  platform: string;
  task: string;
  steps: DiagnosticProfileStep[];
  note?: string;
  userModified?: boolean;
}

export interface TemplateParamDef {
  name: string;
  label: string;
  type: 'ip' | 'mac' | 'vlan' | 'port' | 'interface' | 'text' | 'number' | 'path' | 'regex';
  regex?: string;
  description?: string;
  builtin: boolean;
}

export interface ImportReportRecord {
  id: number;
  ts: string;
  file: string;
  report: TxtParseReport;
}

// ---- Отчёт разбора TXT ----

export interface TxtReportIssue {
  line: number;
  text: string;
  reason: string;
}

export interface TxtParseReport {
  file: string;
  sha256: string;
  encoding: string;
  totalLines: number;
  nonEmptyLines: number;
  headers: { line: number; text: string; platform: string; vendorLabel: string }[];
  entries: number;
  byType: Record<EntryType, number>;
  byPlatform: Record<string, number>;
  commandLines: number;
  outputLines: number;
  headingLines: number;
  noteLines: number;
  needsReview: TxtReportIssue[];
  vendorUnknown: number;
  sensitive: TxtReportIssue[];
  noDescription: number;
  skipped: TxtReportIssue[];
  errors: TxtReportIssue[];
  /** Номера непустых строк, не попавших ни в одну запись (должно быть пусто). */
  unaccounted: number[];
  imported?: number;
  updated?: number;
  unchanged?: number;
}
