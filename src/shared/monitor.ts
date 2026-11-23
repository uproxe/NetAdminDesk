// Мониторинг доступности: типы и чистая логика (смена состояний, разбор ping, письма, массовое добавление).
// Сам опрос выполняет src/main/monitor/engine.ts.

export type MonitorKind = 'switch' | 'router' | 'firewall' | 'server' | 'vms' | 'camera' | 'ap' | 'printer' | 'pc' | 'other';
export type MonitorMethod = 'ping' | 'snmp' | 'tcp';
export type MonitorStatus = 'up' | 'warn' | 'down' | 'unknown' | 'paused';

export const MONITOR_KINDS: { id: MonitorKind; label: string; icon: string }[] = [
  { id: 'switch', label: 'Коммутатор', icon: 'switch' },
  { id: 'router', label: 'Маршрутизатор', icon: 'router' },
  { id: 'firewall', label: 'Межсетевой экран', icon: 'shield' },
  { id: 'server', label: 'Сервер', icon: 'server' },
  { id: 'vms', label: 'Сервер видеонаблюдения', icon: 'video' },
  { id: 'camera', label: 'Камера', icon: 'camera' },
  { id: 'ap', label: 'Точка доступа Wi-Fi', icon: 'wifi' },
  { id: 'printer', label: 'Принтер / МФУ', icon: 'printer' },
  { id: 'pc', label: 'Компьютер', icon: 'monitor' },
  { id: 'other', label: 'Другое', icon: 'box' }
];

export const MONITOR_METHODS: { id: MonitorMethod; label: string; hint: string }[] = [
  { id: 'ping', label: 'Ping (ICMP)', hint: 'Проще всего: узел отвечает на ping — значит, в сети. Ничего настраивать на устройстве не нужно.' },
  { id: 'snmp', label: 'SNMP', hint: 'Запрос времени работы и имени по SNMP v1/v2c. Видно перезагрузки и порты; если SNMP не ответил, программа проверит ping.' },
  { id: 'tcp', label: 'TCP-порт', hint: 'Подключение к порту (например, 80 — веб-интерфейс, 554 — RTSP камеры). Если порт не ответил, программа проверит ping: узел в сети, а служба нет. Подходит, если ping запрещён.' }
];

export const STATUS_LABELS: Record<MonitorStatus, string> = {
  up: 'В сети',
  warn: 'Есть проблемы',
  down: 'Не в сети',
  unknown: 'Проверяется',
  paused: 'Отключён'
};

export interface MonitorNode {
  id: number;
  name: string;
  host: string;
  kind: MonitorKind;
  /** Производитель / ОС для подсказок: cisco, osnovo, usergate, linux, windows… */
  vendor: string;
  method: MonitorMethod;
  snmpVersion: 1 | 2;
  snmpPort: number;
  tcpPort: number;
  /** 0 — интервал по умолчанию из настроек. */
  intervalSec: number;
  enabled: boolean;
  /** Связанное устройство из раздела «Устройства» (для SSH). */
  deviceId: number | null;
  notes: string;
  /** Community сохранена в защищённом хранилище (само значение в интерфейс не передаётся). */
  hasCommunity: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MonitorNodeInput = Omit<MonitorNode, 'id' | 'createdAt' | 'updatedAt' | 'hasCommunity'> & {
  id?: number;
  /** undefined — не менять, '' или null — удалить, строка — сохранить в хранилище. */
  community?: string | null;
};

export interface PortDown {
  ifIndex: number;
  label: string;
  since: string;
}

export interface MonitorState {
  nodeId: number;
  status: MonitorStatus;
  /** С какого момента текущий статус. */
  since: string;
  lastCheck: string | null;
  latencyMs: number | null;
  message: string;
  failCount: number;
  sysName?: string;
  sysDescr?: string;
  uptimeTicks?: number;
  /** Порты, о падении которых сообщили трапы linkDown (до трапа linkUp или сброса). */
  portsDown: PortDown[];
}

export interface MapItem {
  nodeId: number;
  x: number;
  y: number;
}

export interface MapLink {
  id?: number;
  a: number;
  b: number;
  label: string;
}

export interface MonitorMap {
  id: number;
  name: string;
  /** Подложка: картинка data:image/… (план этажа, схема). */
  background: string;
  width: number;
  height: number;
  items: MapItem[];
  links: MapLink[];
  createdAt: string;
  updatedAt: string;
}

export type MonitorMapInput = Omit<MonitorMap, 'id' | 'createdAt' | 'updatedAt'> & { id?: number };

export type MonitorEventType = 'down' | 'up' | 'warn' | 'ok' | 'reboot' | 'trap' | 'mail' | 'system';
export type MonitorEventLevel = 'info' | 'ok' | 'warn' | 'crit';

export interface MonitorEvent {
  id: number;
  ts: string;
  nodeId: number | null;
  nodeName: string;
  level: MonitorEventLevel;
  type: MonitorEventType;
  message: string;
}

export interface MonitorSettings {
  enabled: boolean;
  defaultIntervalSec: number;
  timeoutMs: number;
  /** Сколько проверок подряд должно не пройти, чтобы считать узел «не в сети». */
  failThreshold: number;
  concurrency: number;
  trap: {
    enabled: boolean;
    port: number;
    bind: string;
    /** Трап linkDown делает коммутатор «жёлтым» до трапа linkUp. */
    linkDownWarn: boolean;
    /** Записывать трапы от адресов, которых нет в списке узлов. */
    logUnknown: boolean;
    /** Проверять community трапов (значение хранится в защищённом хранилище). */
    checkCommunity: boolean;
  };
  notify: {
    desktop: boolean;
    onRecovery: boolean;
  };
  email: {
    enabled: boolean;
    host: string;
    port: number;
    security: 'starttls' | 'tls' | 'none';
    /** Пустой — без авторизации. Пароль — в защищённом хранилище. */
    user: string;
    from: string;
    to: string;
    /** Собирать события за это время в одно письмо. */
    delaySec: number;
    includeTraps: boolean;
    allowInvalidCert: boolean;
  };
  background: {
    /** При закрытии окна продолжать мониторинг (значок в области уведомлений). */
    keepRunning: boolean;
    openAtLogin: boolean;
  };
}

export const DEFAULT_MONITOR: MonitorSettings = {
  enabled: true,
  defaultIntervalSec: 30,
  timeoutMs: 1500,
  failThreshold: 2,
  concurrency: 16,
  trap: { enabled: false, port: 162, bind: '0.0.0.0', linkDownWarn: true, logUnknown: true, checkCommunity: false },
  notify: { desktop: true, onRecovery: true },
  email: { enabled: false, host: '', port: 587, security: 'starttls', user: '', from: '', to: '', delaySec: 60, includeTraps: false, allowInvalidCert: false },
  background: { keepRunning: true, openAtLogin: false }
};

/** Настройки из базы + значения по умолчанию для полей, появившихся позже. */
export function withMonitorDefaults(s: Partial<MonitorSettings> | undefined): MonitorSettings {
  const v = s ?? {};
  return {
    ...DEFAULT_MONITOR,
    ...v,
    trap: { ...DEFAULT_MONITOR.trap, ...(v.trap ?? {}) },
    notify: { ...DEFAULT_MONITOR.notify, ...(v.notify ?? {}) },
    email: { ...DEFAULT_MONITOR.email, ...(v.email ?? {}) },
    background: { ...DEFAULT_MONITOR.background, ...(v.background ?? {}) }
  };
}

export interface MonitorStatusInfo {
  running: boolean;
  trap: { enabled: boolean; listening: boolean; port: number; bind: string; error: string; received: number; dropped: number };
  counts: Record<MonitorStatus, number>;
  canStoreSecrets: boolean;
  emailPassword: boolean;
  trapCommunity: boolean;
  mailQueue: number;
  lastMailError: string;
  /** IPv4-адреса этого компьютера — их указывают на устройствах как получатель трапов. */
  localAddresses: string[];
}

export interface CheckResult {
  /** Узел ответил (ping, TCP или SNMP). */
  reachable: boolean;
  /** Узел доступен, но есть замечание (например, SNMP не отвечает). */
  warn?: string;
  latencyMs: number | null;
  message: string;
  sysName?: string;
  sysDescr?: string;
  uptimeTicks?: number;
}

export interface StateChange {
  type: MonitorEventType;
  level: MonitorEventLevel;
  message: string;
}

export function initialState(nodeId: number, enabled: boolean, nowIso: string): MonitorState {
  return { nodeId, status: enabled ? 'unknown' : 'paused', since: nowIso, lastCheck: null, latencyMs: null, message: '', failCount: 0, portsDown: [] };
}

export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} д ${h % 24} ч`;
}

/**
 * Новое состояние после проверки. Узел становится «не в сети» только после failThreshold неудач подряд
 * (защита от ложных тревог при потере одного пакета), а «в сети» — после первой удачной проверки.
 */
export function applyCheck(prev: MonitorState, r: CheckResult, threshold: number, nowIso: string): { state: MonitorState; changes: StateChange[] } {
  const changes: StateChange[] = [];
  const s: MonitorState = { ...prev, lastCheck: nowIso, latencyMs: r.latencyMs, message: r.message };
  if (r.sysName !== undefined) s.sysName = r.sysName;
  if (r.sysDescr !== undefined) s.sysDescr = r.sysDescr;
  const nowMs = Date.parse(nowIso);
  if (r.reachable) {
    s.failCount = 0;
    if (r.uptimeTicks !== undefined) {
      if (prev.uptimeTicks !== undefined && r.uptimeTicks + 500 < prev.uptimeTicks) {
        const up = Math.round(r.uptimeTicks / 100) * 1000;
        changes.push({ type: 'reboot', level: 'warn', message: `перезагрузился (работает ${durationText(up)})` });
      }
      s.uptimeTicks = r.uptimeTicks;
    }
    const status: MonitorStatus = r.warn || prev.portsDown.length ? 'warn' : 'up';
    if (prev.status === 'down') changes.push({ type: 'up', level: 'ok', message: `снова в сети (не было ${durationText(nowMs - Date.parse(prev.since))})` });
    else if (status === 'warn' && prev.status !== 'warn' && r.warn) changes.push({ type: 'warn', level: 'warn', message: r.warn });
    else if (status === 'up' && prev.status === 'warn') changes.push({ type: 'ok', level: 'ok', message: 'проблема устранена' });
    if (status !== prev.status) s.since = nowIso;
    s.status = status;
    if (r.warn) s.message = r.warn;
    return { state: s, changes };
  }
  s.failCount = prev.failCount + 1;
  if (s.failCount >= threshold) {
    if (prev.status !== 'down') {
      changes.push({ type: 'down', level: 'crit', message: `не в сети: ${r.message}` });
      s.since = nowIso;
    }
    s.status = 'down';
  }
  return { state: s, changes };
}

// ---------- ping ----------

/** Разбор вывода ping (Windows на русском и английском, Linux, macOS). */
export function parsePing(output: string, code: number | null, platform: string): { ok: boolean; ms: number | null; text: string } {
  const ms = (() => {
    const m = /(?:time|время)\s*[=<]\s*([\d.,]+)\s*(?:ms|мс)/i.exec(output);
    return m ? Math.round(Number(m[1].replace(',', '.'))) : null;
  })();
  if (platform === 'win32') {
    // В Windows «Заданный узел недоступен» приходит с кодом 0 — признак ответа только TTL=.
    const ok = /TTL=/i.test(output);
    const text = ok ? 'отвечает на ping' : /недоступ|unreachable/i.test(output) ? 'узел недоступен (нет маршрута)' : /не удается обнаружить|could not find/i.test(output) ? 'имя не найдено в DNS' : 'нет ответа на ping';
    return { ok, ms: ok ? (ms ?? 0) : null, text };
  }
  const ok = code === 0 && /ttl=|time[=<]/i.test(output);
  const text = ok ? 'отвечает на ping' : /unknown host|name or service not known|cannot resolve|not known/i.test(output) ? 'имя не найдено в DNS' : /unreachable/i.test(output) ? 'узел недоступен (нет маршрута)' : 'нет ответа на ping';
  return { ok, ms: ok ? (ms ?? 0) : null, text };
}

export function pingArgs(host: string, timeoutMs: number, platform: string): string[] {
  if (platform === 'win32') return ['-n', '1', '-w', String(timeoutMs), host];
  if (platform === 'darwin') return ['-c', '1', '-W', String(timeoutMs), host];
  return ['-c', '1', '-n', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];
}

// ---------- Массовое добавление ----------

const KIND_WORDS: [RegExp, MonitorKind][] = [
  [/коммут|switch|^sw\b|osnovo|cisco/i, 'switch'],
  [/маршрут|router|роутер/i, 'router'],
  [/межсет|firewall|usergate|ngfw/i, 'firewall'],
  [/видео|vms|регистратор|nvr/i, 'vms'],
  [/камер|camera|cam\b/i, 'camera'],
  [/точк|wi-?fi|\bap\b/i, 'ap'],
  [/принтер|мфу|printer/i, 'printer'],
  [/сервер|server|srv/i, 'server'],
  [/компьют|\bпк\b|\bpc\b|рабоч/i, 'pc']
];

export function guessKind(text: string): MonitorKind | undefined {
  for (const [re, k] of KIND_WORDS) if (re.test(text)) return k;
  return undefined;
}

const HOST_RE = /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9.\-]*[a-zA-Z0-9])?$/;

/**
 * Список узлов из текста: по строке на узел — «имя; адрес; тип» (разделитель ; , или табуляция)
 * или просто адрес. Диапазон «10.10.5.1-20» раскрывается в 20 адресов.
 */
export function parseBulkNodes(text: string, defaults: { kind: MonitorKind }): { nodes: { name: string; host: string; kind: MonitorKind }[]; errors: string[] } {
  const nodes: { name: string; host: string; kind: MonitorKind }[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/\s*[;\t,]\s*/).filter(Boolean);
    let name = '';
    let host = '';
    let kindText = '';
    if (parts.length === 1) host = parts[0];
    else {
      const ipIdx = parts.findIndex((p) => /^\d{1,3}(\.\d{1,3}){3}(-\d{1,3})?$/.test(p));
      const hi = ipIdx >= 0 ? ipIdx : 1;
      host = parts[hi];
      const rest = parts.filter((_, k) => k !== hi);
      name = rest[0] ?? '';
      kindText = rest.slice(1).join(' ');
    }
    const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})-(\d{1,3})$/.exec(host);
    const kind = guessKind(kindText) ?? guessKind(name) ?? defaults.kind;
    if (range) {
      const [a, b] = [Number(range[2]), Number(range[3])];
      if (a > b || b > 255 || b - a > 255) {
        errors.push(`Строка ${i + 1}: неверный диапазон ${host}`);
        return;
      }
      for (let n = a; n <= b; n++) nodes.push({ name: name ? `${name} ${n}` : `${range[1]}${n}`, host: `${range[1]}${n}`, kind });
      return;
    }
    const ipOk = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host.split('.').every((o) => Number(o) <= 255) : HOST_RE.test(host);
    if (!ipOk) {
      errors.push(`Строка ${i + 1}: «${host}» — не IP-адрес и не имя узла`);
      return;
    }
    nodes.push({ name: name || host, host, kind });
  });
  return { nodes, errors };
}

// ---------- Письмо ----------

export interface MailItem {
  ts: string;
  nodeName: string;
  host: string;
  type: MonitorEventType;
  message: string;
}

export function composeAlertMail(items: MailItem[], counts: Record<MonitorStatus, number>, computer: string): { subject: string; text: string } {
  const down = items.filter((i) => i.type === 'down');
  const up = items.filter((i) => i.type === 'up');
  const subject =
    down.length && !up.length
      ? `Не в сети: ${down.length === 1 ? down[0].nodeName : `${down.length} узл.`}`
      : up.length && !down.length
        ? `Снова в сети: ${up.length === 1 ? up[0].nodeName : `${up.length} узл.`}`
        : `Мониторинг: ${items.length} событ.`;
  const time = (iso: string) => new Date(iso).toLocaleString('ru-RU');
  const lines = items.map((i) => `${time(i.ts)}  ${i.nodeName} (${i.host}) — ${i.message}`);
  const text = [
    'NetAdmin Desk — мониторинг',
    '',
    ...lines,
    '',
    `Сейчас: в сети ${counts.up}, с проблемами ${counts.warn}, не в сети ${counts.down}${counts.paused ? `, отключено ${counts.paused}` : ''}.`,
    `Отправлено с компьютера ${computer}.`
  ].join('\r\n');
  return { subject: `[NetAdmin Desk] ${subject}`, text };
}
