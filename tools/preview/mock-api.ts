// Имитация window.nad для предпросмотра интерфейса в обычном браузере.
// Используются настоящие встроенные справочники и настоящий разбор TXT; SSH имитируется.
// Только для проверки интерфейса разработчиком — в приложение не входит.
import type { NadApi, NadEvent, AnyPrompt } from '../../src/shared/ipc';
import type {
  BackupRecord,
  CommandInput,
  CommandRecord,
  Device,
  DeviceGroup,
  DiagnosticProfile,
  DiagnosticResult,
  HistoryEntry,
  ImportReportRecord,
  KnownHost,
  Note,
  Scenario,
  SessionInfo,
  Settings,
  TemplateParamDef,
  TxtParseReport,
  VaultStatus
} from '../../src/shared/types';
import { BUILTIN_COMMANDS, BUILTIN_SCENARIOS, SEED_FILES, builtinProfiles } from '../../data/index';
import { importTxt } from '../../src/shared/txtImport';
import { classifyCommand } from '../../src/shared/risk';
import { BUILTIN_PARAMS } from '../../src/shared/templates';
import { DB_CHECKS } from '../../src/shared/dbDiag';
import { checkById } from '../../src/shared/linuxDiag';
import { DB_SAMPLE } from './db-sample';
import { diffLines, toHunks, diffStats } from '../../src/shared/diff';
import mainTxt from '../../data/user/komandy-kommutatorov.txt';
import aclTxt from '../../data/user/acl-notes.txt';

const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const listeners = new Set<(e: NadEvent) => void>();
const emit = (e: NadEvent) => setTimeout(() => listeners.forEach((l) => l(e)), 0);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---- Данные ----
let nextId = 1;
const commands: CommandRecord[] = [];
function addCommand(c: CommandInput): CommandRecord {
  const rec = { ...c, id: c.id ?? nextId++, createdAt: ago(60 * 24 * 3), updatedAt: ago(60 * 24 * 3) } as CommandRecord;
  const i = commands.findIndex((x) => x.id === rec.id);
  if (i >= 0) commands[i] = rec;
  else commands.push(rec);
  return rec;
}
BUILTIN_COMMANDS.forEach(addCommand);
const reports: ImportReportRecord[] = [];
const texts: Record<string, string> = { 'txt-main': mainTxt, 'txt-acl': aclTxt };
for (const f of SEED_FILES) {
  const r = importTxt(texts[f.key], { fileLabel: f.label, sourceKey: f.key, source: f.source }, { encoding: 'utf-8' });
  r.records.forEach(addCommand);
  reports.push({ id: reports.length + 1, ts: ago(60 * 24 * 3), file: f.label, report: { ...r.report, imported: r.records.length, updated: 0, unchanged: 0 } });
}

let settings: Settings = {
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
  vaultMode: 'os',
  showSensitive: false,
  sidebarCollapsed: false,
  uiMode: 'simple',
  navCollapsed: [],
  navOverrides: {},
  terminalHighlight: true,
  quickCommandsBar: false,
  splitRatio: 0.62,
  lastSection: 'home',
  telemetry: false
};
const qs = new URLSearchParams(location.search);
if (qs.get('theme') === 'light') settings.theme = 'light';
if (qs.get('section')) settings.lastSection = qs.get('section')!;

const groups: DeviceGroup[] = [
  { id: 1, name: 'Демо: Офис', parentId: null, kind: 'group', sort: 0 },
  { id: 2, name: 'Коммутаторы доступа', parentId: 1, kind: 'folder', sort: 0 },
  { id: 3, name: 'Серверы', parentId: 1, kind: 'folder', sort: 1 }
];

function device(p: Partial<Device> & Pick<Device, 'id' | 'name' | 'host' | 'platform' | 'deviceType'>): Device {
  return {
    port: 22,
    vendor: '',
    model: '',
    osVersion: '',
    username: 'admin',
    authMethod: 'password',
    keyPath: '',
    description: '',
    location: '',
    groupId: 2,
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
    disablePagerOnConnect: true,
    readOnly: false,
    keepaliveSec: 30,
    timeoutSec: 20,
    jumpDeviceId: null,
    protocol: 'ssh',
    serialBaud: 9600,
    loginCommands: '',
    color: '',
    lastConnectedAt: null,
    lastStatus: 'never',
    lastError: '',
    createdAt: ago(60 * 24 * 10),
    updatedAt: ago(60 * 24 * 2),
    ...p
  };
}

const devices: Device[] = [
  device({ id: 1, name: 'demo-sg300', host: '192.0.2.11', platform: 'cisco-sg300', deviceType: 'switch', vendor: 'Cisco', model: 'SG300-28', location: 'Демо-стойка 1', favorite: true, lastConnectedAt: ago(35), lastStatus: 'ok', tags: ['доступ'] }),
  device({ id: 2, name: 'demo-procurve', host: '192.0.2.12', platform: 'hp-procurve', deviceType: 'switch', vendor: 'HP', model: 'ProCurve 2510', legacyAlgorithms: true, lastConnectedAt: ago(60 * 26), lastStatus: 'error', lastError: 'Тайм-аут подключения' }),
  device({ id: 3, name: 'demo-osnovo', host: '192.0.2.13', platform: 'osnovo', deviceType: 'switch', vendor: 'OSNOVO', model: 'SW-демо' }),
  device({ id: 4, name: 'demo-at8000s', host: '192.0.2.14', platform: 'at-8000s', deviceType: 'switch', vendor: 'Allied Telesis', model: 'AT-8000S', autoEnable: true }),
  device({ id: 5, name: 'demo-debian', host: '192.0.2.21', platform: 'linux', deviceType: 'linux', groupId: 3, username: 'user', authMethod: 'key', keyPath: '~/.ssh/id_ed25519', linuxDistro: 'Debian', linuxVersion: '13', serverType: 'Мониторинг', favorite: true, lastConnectedAt: ago(5), lastStatus: 'ok' })
];

const scenarios: Scenario[] = BUILTIN_SCENARIOS.map((s, i) => ({ ...s, id: i + 1, createdAt: ago(9999), updatedAt: ago(9999) }));
const profiles: DiagnosticProfile[] = builtinProfiles();
const notes: Note[] = [
  { id: 1, title: 'Демо-заметка: порядок замены коммутатора', body: '1. Снять конфигурацию (раздел «Бэкапы»).\n2. Проверить VLAN на аплинке.\n3. После замены сравнить конфигурации.', tags: ['регламент'], createdAt: ago(3000), updatedAt: ago(300) }
];
const templateParams: TemplateParamDef[] = BUILTIN_PARAMS.map((p) => ({ ...p, builtin: true })) as TemplateParamDef[];
const history: HistoryEntry[] = [
  { id: 3, ts: ago(4), deviceId: 5, deviceName: 'demo-debian', command: 'systemctl --failed', source: 'diagnostic', risk: 'info', result: 'done', note: '' },
  { id: 2, ts: ago(33), deviceId: 1, deviceName: 'demo-sg300', command: 'show mac address-table', source: 'reference', risk: 'info', result: 'sent', note: '' },
  { id: 1, ts: ago(34), deviceId: 1, deviceName: 'demo-sg300', command: 'interface gi1/0/5\nshutdown', source: 'reference', risk: 'danger', result: 'cancelled', note: 'Отменено пользователем' }
];
const knownHosts: KnownHost[] = [
  { id: 1, host: '192.0.2.11', port: 22, keyType: 'ssh-rsa', fingerprint: 'SHA256:demoDEMOdemoDEMOdemoDEMOdemoDEMOdemoDEMO00', firstSeen: ago(9000), lastSeen: ago(35) },
  { id: 2, host: '192.0.2.21', port: 22, keyType: 'ssh-ed25519', fingerprint: 'SHA256:previewPREVIEWpreviewPREVIEWpreviewPREVIE1', firstSeen: ago(8000), lastSeen: ago(5) }
];
const SAMPLE_CFG_A = `!\nhostname demo-sg300\nvlan database\nvlan 10,20,101\nexit\ninterface vlan 10\n ip address 192.0.2.11 255.255.255.0\nexit\ninterface gi1/0/5\n switchport mode access\n switchport access vlan 20\nexit\n!\n`;
const SAMPLE_CFG_B = SAMPLE_CFG_A.replace('vlan 10,20,101', 'vlan 10,20,101,102').replace('switchport access vlan 20', 'switchport access vlan 102');
const backups: BackupRecord[] = [
  { id: 2, deviceId: 1, deviceName: 'demo-sg300', ts: ago(40), kind: 'switch-config', path: '/demo/backups/demo-sg300/2.cfg', size: SAMPLE_CFG_B.length, sha256: 'b', comment: '', sameAsPrevious: false },
  { id: 1, deviceId: 1, deviceName: 'demo-sg300', ts: ago(60 * 24 * 7), kind: 'switch-config', path: '/demo/backups/demo-sg300/1.cfg', size: SAMPLE_CFG_A.length, sha256: 'a', comment: 'до замены аплинка', sameAsPrevious: false }
];
const diagnostics: DiagnosticResult[] = [];
let vault: VaultStatus = { mode: 'os', osAvailable: true, osBackend: 'gnome_libsecret', osSecure: true, masterConfigured: false, unlocked: true };

// ---- Имитация SSH ----
interface MockSession {
  info: SessionInfo;
  line: string;
  linux: boolean;
  prompt: string;
}
const sessions = new Map<string, MockSession>();
let sessionSeq = 1;
const pendingPrompts = new Map<string, (answer: unknown) => void>();

const SWITCH_OUT: Record<string, string> = {
  'show version': 'Демонстрационный вывод (имитация, не реальное устройство)\nSW version    1.4.x (demo)\nBoot version  1.x (demo)\nHW version    V0x',
  'show mac address-table': '  Vlan        Mac Address         Port       Type\n-------- --------------------- ---------- ----------\n   10      00:11:22:33:44:55    gi1/0/5    dynamic\n   10      00:11:22:33:44:66    gi1/0/24   dynamic\n   20      00:aa:bb:cc:dd:ee    gi1/0/24   dynamic',
  'show interfaces status': 'Port     Type         Duplex  Speed Neg      ctrl State       \n-------- ------------ ------  ----- -------- ---- ----------- \ngi1/0/1  1G-Copper    Full    1000  Enabled  Off  Up\ngi1/0/5  1G-Copper    Full    100   Enabled  Off  Up\ngi1/0/6  1G-Copper      --      --     --     --  Down',
  'show running-config': SAMPLE_CFG_B
};
const LINUX_OUT: Record<string, string> = {
  'cat /etc/os-release': 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nNAME="Debian GNU/Linux"\nVERSION_ID="13"\nID=debian',
  'uname -r': '6.12.0-demo-amd64',
  uptime: ' 10:12:01 up 41 days,  3:02,  1 user,  load average: 0.12, 0.20, 0.18',
  nproc: '4',
  'cat /proc/loadavg': '0.12 0.20 0.18 1/245 99999',
  'free -b': '               total        used        free      shared  buff/cache   available\nMem:      8221151232  2147483648  1073741824   104857600  5000000000  5800000000\nSwap:     2147483648           0  2147483648',
  'df -PB1 -x tmpfs -x devtmpfs -x squashfs -x overlay': 'Filesystem      1-blocks        Used   Available Capacity Mounted on\n/dev/sda1     52521566208 46800000000  3000000000      94% /\n/dev/sdb1    209715200000 50000000000 159715200000     24% /var/lib/demo',
  'ip -br link': 'lo               UNKNOWN        00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP>\nens18            UP             bc:24:11:00:00:01 <BROADCAST,MULTICAST,UP,LOWER_UP>',
  'ip -br addr': 'lo               UNKNOWN        127.0.0.1/8 ::1/128\nens18            UP             192.0.2.21/24',
  'ip route': 'default via 192.0.2.1 dev ens18 onlink\n192.0.2.0/24 dev ens18 proto kernel scope link src 192.0.2.21',
  'systemctl --failed --no-legend --plain': 'demo-agent.service loaded failed failed Demo agent (имитация)'
};
// Проверки баз данных: PostgreSQL — снимок с настоящего сервера (db-sample.ts), MySQL / MariaDB не установлен.
for (const c of DB_CHECKS) c.commands.forEach((cmd, i) => (LINUX_OUT[cmd] = DB_SAMPLE[c.id]?.[i] ?? (cmd.startsWith('command -v mysql') ? 'NO_CLIENT' : c.id === 'db-mysql-service' && i === 0 ? 'mariadb=inactive\nmysql=inactive' : c.id === 'db-mysql-disk' && i === 0 ? 'DIR=/var/lib/mysql' : '')));
LINUX_OUT[checkById('databases')!.commands[0]] = 'mysql=inactive\nmariadb=inactive\npostgresql=active\nredis-server=inactive\nmongod=inactive';

function outputFor(s: MockSession, cmd: string): string {
  const c = cmd.trim();
  if (!c) return '';
  const table = s.linux ? LINUX_OUT : SWITCH_OUT;
  if (table[c] !== undefined) return table[c];
  return s.linux ? `[предпросмотр] вывод команды «${c}» не имитируется` : `% [предпросмотр] вывод команды «${c}» не имитируется`;
}

function sessData(id: string, data: string) {
  emit({ type: 'ssh:data', id, data });
}

function waitPrompt(p: AnyPrompt): Promise<unknown> {
  return new Promise((resolve) => {
    pendingPrompts.set(p.requestId, resolve);
    emit({ type: 'prompt', prompt: p });
  });
}

// ---- API ----
const api: NadApi & { platform: string } = {
  platform: /Mac/.test(navigator.platform) ? 'darwin' : 'linux',
  app: {
    info: async () => ({ version: '1.0.0-preview', platform: 'preview', arch: 'browser', dataDir: '/demo/NetAdmin Desk', dbPath: '/demo/NetAdmin Desk/netadmin.db', portable: false, electron: '—', node: '—', chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '—', schemaVersion: 1, dbDriver: 'имитация' }),
    openExternal: async () => {},
    showItemInFolder: async () => {},
    openPath: async () => '',
    selectFile: async (o) => (/перенос/i.test(o?.title ?? '') ? '/demo/netadmin-devices-2026-11-18.nadevices' : '/demo/komandy-kommutatorov.txt'),
    selectSaveFile: async (o) => `/demo/${o.defaultPath ?? 'export'}`,
    selectDirectory: async () => '/demo',
    clipboardWrite: async (t) => {
      try {
        await navigator.clipboard.writeText(t);
      } catch {
        /* нет доступа в предпросмотре */
      }
    },
    clipboardRead: async () => '',
    setZoom: async () => {},
    relaunch: async () => location.reload(),
    readTextFile: async () => '',
    writeTextFile: async () => {},
    ready: async () => {
      (window as unknown as { __nadReady: boolean }).__nadReady = true;
    }
  },
  settings: {
    get: async () => clone(settings),
    set: async (patch) => ((settings = { ...settings, ...patch, telemetry: false }), clone(settings))
  },
  commands: {
    list: async () => clone(commands.filter((c) => !(c as CommandRecord & { deleted?: boolean }).deleted)),
    save: async (c) => {
      const rec = addCommand({ ...c, risk: c.riskManual ? c.risk : classifyCommand(c.command, c.kind), source: c.source || 'user' } as CommandInput);
      return clone(rec);
    },
    remove: async (id) => {
      const i = commands.findIndex((c) => c.id === id);
      if (i >= 0) commands.splice(i, 1);
    },
    setFlags: async (id, f) => {
      const c = commands.find((x) => x.id === id)!;
      Object.assign(c, f);
      return clone(c);
    },
    restoreDeleted: async () => 0
  },
  devices: {
    list: async () => clone(devices),
    save: async (d) => {
      const rec = { ...device({ ...(d as Device), id: d.id ?? Math.max(0, ...devices.map((x) => x.id)) + 1 }) };
      const i = devices.findIndex((x) => x.id === rec.id);
      if (i >= 0) devices[i] = { ...devices[i], ...rec, updatedAt: now() };
      else devices.push(rec);
      return clone(rec);
    },
    remove: async (id) => {
      const i = devices.findIndex((x) => x.id === id);
      if (i >= 0) devices.splice(i, 1);
    },
    duplicate: async (id) => {
      const d = devices.find((x) => x.id === id)!;
      const n = { ...clone(d), id: Math.max(...devices.map((x) => x.id)) + 1, name: `${d.name} (копия)` };
      devices.push(n);
      return n;
    },
    setFavorite: async (id, fav) => {
      const d = devices.find((x) => x.id === id);
      if (d) d.favorite = fav;
    },
    secretsState: async (id) => ({ password: id !== 5, keyPassphrase: false, enablePassword: id === 4 }),
    knownHosts: async () => clone(knownHosts),
    forgetHostKey: async (host, port) => {
      const i = knownHosts.findIndex((k) => k.host === host && k.port === port);
      if (i >= 0) knownHosts.splice(i, 1);
    }
  },
  groups: {
    list: async () => clone(groups),
    save: async (g) => {
      const rec = { ...g, id: g.id ?? Math.max(0, ...groups.map((x) => x.id)) + 1 } as DeviceGroup;
      const i = groups.findIndex((x) => x.id === rec.id);
      if (i >= 0) groups[i] = rec;
      else groups.push(rec);
      return rec;
    },
    remove: async (id) => {
      const i = groups.findIndex((x) => x.id === id);
      if (i >= 0) groups.splice(i, 1);
    }
  },
  scenarios: {
    list: async () => clone(scenarios),
    save: async (s) => {
      const rec = { ...s, id: s.id ?? scenarios.length + 1, createdAt: now(), updatedAt: now() } as Scenario;
      const i = scenarios.findIndex((x) => x.id === rec.id);
      if (i >= 0) scenarios[i] = rec;
      else scenarios.push(rec);
      return rec;
    },
    remove: async (id) => {
      const i = scenarios.findIndex((x) => x.id === id);
      if (i >= 0) scenarios.splice(i, 1);
    },
    setFavorite: async (id, fav) => {
      const s = scenarios.find((x) => x.id === id);
      if (s) s.favorite = fav;
    }
  },
  history: {
    list: async (f) => clone(history.filter((h) => (!f?.deviceId || h.deviceId === f.deviceId) && (!f?.search || h.command.includes(f.search)))),
    clear: async () => void history.splice(0),
    add: async (e) => void history.unshift({ ...e, id: history.length + 10, ts: now() })
  },
  notes: {
    list: async () => clone(notes),
    save: async (n) => {
      const rec = { ...n, id: n.id ?? notes.length + 1, createdAt: now(), updatedAt: now() } as Note;
      const i = notes.findIndex((x) => x.id === rec.id);
      if (i >= 0) notes[i] = rec;
      else notes.push(rec);
      return rec;
    },
    remove: async (id) => {
      const i = notes.findIndex((x) => x.id === id);
      if (i >= 0) notes.splice(i, 1);
    }
  },
  vault: {
    status: async () => clone(vault),
    setupMaster: async () => ((vault = { ...vault, mode: 'master', masterConfigured: true, unlocked: true }), clone(vault)),
    unlock: async (pw) => {
      if (pw.length < 8) return false;
      vault = { ...vault, unlocked: true };
      return true;
    },
    lock: async () => void (vault = { ...vault, unlocked: false }),
    changeMaster: async () => {},
    switchMode: async (mode) => ((vault = { ...vault, mode, unlocked: true }), clone(vault))
  },
  serial: {
    feed: async () => {},
    opened: async () => {},
    closed: async () => {},
    listBegin: async () => {},
    listEnd: async () => [
      { portId: '1', portName: 'COM3', displayName: 'USB-SERIAL CH340' },
      { portId: '2', portName: 'COM1', displayName: 'Communications Port' }
    ]
  },
  tools: {
    run: async (tool, host) => {
      const runId = `run-${sessionSeq++}`;
      const lines =
        tool === 'ping'
          ? [`Обмен пакетами с ${host} по с 32 байтами данных:`, ...[1, 2, 3, 4].map((i) => `Ответ от ${host}: число байт=32 время=${i}мс TTL=63`), '', `Статистика Ping для ${host}:`, '    Пакетов: отправлено = 4, получено = 4, потеряно = 0 (0% потерь)']
          : [`Трассировка маршрута к ${host} с максимальным числом прыжков 20`, '  1    <1 мс    <1 мс    <1 мс  192.168.1.1', '  2     2 мс     1 мс     2 мс  10.0.0.1', `  3     3 мс     2 мс     3 мс  ${host}`, '', 'Трассировка завершена.'];
      lines.forEach((l, i) => setTimeout(() => emit({ type: 'tools:output', runId, chunk: `${l}\n` }), 120 * (i + 1)));
      setTimeout(() => emit({ type: 'tools:done', runId, code: 0 }), 120 * (lines.length + 1));
      return { runId, commandLine: tool === 'ping' ? `ping -n 4 -w 2000 ${host}` : `tracert -d -w 1000 -h 20 ${host}` };
    },
    stop: async () => {},
    tcpCheck: async (_host, ports) => ports.map((port, i) => ({ port, ok: port !== 23, ms: 3 + i, text: `${port}${port === 22 ? ' (SSH)' : port === 23 ? ' (Telnet)' : port === 80 ? ' (HTTP)' : port === 443 ? ' (HTTPS)' : ''}: ${port === 23 ? 'закрыт (служба не запущена)' : 'открыт'}` })),
    createKey: async (o) => ({ path: o.path, publicKey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPdHgkffwRsbV8O8pzecgIubKkjrD1uV1ijjVv6twoFE ${o.comment}`, fingerprint: 'SHA256:Ud96LFYLlDscSPSaq4bnvVt5j26TUv/Tlq9SkmOlPnQ' })
  },
  ssh: {
    connect: async (deviceId) => {
      const d = devices.find((x) => x.id === deviceId)!;
      const id = `mock-${sessionSeq++}`;
      const info: SessionInfo = { id, deviceId, deviceName: d.name, host: d.host, platform: d.platform, protocol: d.protocol ?? 'ssh', status: 'connecting', startedAt: now() };
      if (d.protocol === 'ssh' && !knownHosts.some((k) => k.host === d.host)) {
        const answer = await waitPrompt({
          kind: 'hostKey',
          requestId: `hk-${id}`,
          deviceName: d.name,
          host: d.host,
          port: d.port,
          keyType: 'ssh-ed25519',
          fingerprint: 'SHA256:mockMOCKmockMOCKmockMOCKmockMOCKmockMOCK123',
          mismatch: false
        });
        if (answer !== 'accept') throw new Error('Подключение отменено: ключ хоста не принят');
        knownHosts.push({ id: knownHosts.length + 1, host: d.host, port: d.port, keyType: 'ssh-ed25519', fingerprint: 'SHA256:mockMOCKmockMOCKmockMOCKmockMOCKmockMOCK123', firstSeen: now(), lastSeen: now() });
      }
      const linux = d.platform === 'linux';
      const s: MockSession = { info: { ...info, status: 'ready' }, line: '', linux, prompt: linux ? `${d.username}@${d.name}:~$ ` : `${d.name}#` };
      sessions.set(id, s);
      d.lastConnectedAt = now();
      d.lastStatus = 'ok';
      setTimeout(() => {
        sessData(id, `\x1b[2m[предпросмотр интерфейса: SSH имитируется, реального подключения нет]\x1b[0m\r\n`);
        sessData(id, linux ? `Linux ${d.name} 6.12.0-demo-amd64\r\n${s.prompt}` : `\r\n${s.prompt}`);
      }, 50);
      return s.info;
    },
    write: async (id, data) => {
      const s = sessions.get(id);
      if (!s) return;
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          const out = outputFor(s, s.line);
          sessData(id, `\r\n${out ? out.replace(/\n/g, '\r\n') + '\r\n' : ''}${s.prompt}`);
          s.line = '';
        } else if (ch === '\x7f') {
          if (s.line) {
            s.line = s.line.slice(0, -1);
            sessData(id, '\b \b');
          }
        } else if (ch >= ' ') {
          s.line += ch;
          sessData(id, ch);
        }
      }
    },
    resize: async () => {},
    disconnect: async (id) => {
      const s = sessions.get(id);
      if (!s) return;
      sessions.delete(id);
      emit({ type: 'ssh:status', info: { ...s.info, status: 'closed' } });
      emit({ type: 'ssh:closed', id });
    },
    list: async () => [...sessions.values()].map((s) => s.info),
    send: async (id, command) => {
      for (const line of command.split('\n')) await api.ssh.write(id, line + '\r');
    },
    capture: async (id, command) => {
      const s = sessions.get(id)!;
      await api.ssh.write(id, command + '\r');
      return { command, output: outputFor(s, command), timedOut: false, durationMs: 120 };
    },
    exec: async (id, command) => {
      const s = sessions.get(id)!;
      const out = outputFor(s, command);
      return { command, stdout: out.startsWith('[предпросмотр]') ? '' : out, stderr: out.startsWith('[предпросмотр]') ? out : '', code: 0, durationMs: 80 };
    },
    sendEnable: async () => true,
    probe: async (deviceId) => {
      const d = devices.find((x) => x.id === deviceId)!;
      return {
        ok: false,
        steps: [
          { step: 'dns', ok: true, text: `${d.host} — IP-адрес, DNS не нужен` },
          { step: 'tcp', ok: true, text: `TCP-порт ${d.port} открыт (41 мс)` },
          { step: 'banner', ok: false, text: 'Сервер закрыл соединение, не отправив приветствие SSH' }
        ],
        conclusion: 'TCP-соединение устанавливается, но SSH-сервер сразу разрывает его (имитация для предпросмотра).'
      };
    }
  },
  prompts: {
    respond: async (requestId, answer) => {
      pendingPrompts.get(requestId)?.(answer);
      pendingPrompts.delete(requestId);
    }
  },
  sftp: {
    list: async (_s, path) => [
      { name: '..', path: path.replace(/\/[^/]+$/, '') || '/', isDir: true, size: 0, mtime: Date.now() / 1000, mode: 'drwxr-xr-x' },
      { name: 'etc', path: `${path}/etc`.replace('//', '/'), isDir: true, size: 0, mtime: Date.now() / 1000, mode: 'drwxr-xr-x' },
      { name: 'notes.txt', path: `${path}/notes.txt`.replace('//', '/'), isDir: false, size: 1834, mtime: Date.now() / 1000 - 3600, mode: '-rw-r--r--' }
    ],
    download: async () => {},
    upload: async () => {},
    mkdir: async () => {},
    rename: async () => {},
    remove: async () => {},
    home: async () => '/home/user'
  },
  tunnels: { list: async () => [], start: async (s) => ({ ...s, id: 't1', status: 'listening', connections: 0 }), stop: async () => {} },
  backups: {
    list: async (deviceId) => clone(backups.filter((b) => !deviceId || b.deviceId === deviceId)),
    fetchSwitchConfig: async (sid) => {
      const s = sessions.get(sid)!;
      const b: BackupRecord = { id: backups.length + 1, deviceId: s.info.deviceId, deviceName: s.info.deviceName, ts: now(), kind: 'switch-config', path: `/demo/backups/${backups.length + 1}.cfg`, size: SAMPLE_CFG_B.length, sha256: 'b', comment: '', sameAsPrevious: true };
      backups.unshift(b);
      return b;
    },
    read: async (id) => (id === 1 ? SAMPLE_CFG_A : SAMPLE_CFG_B),
    diff: async (a, b) => {
            const ops = diffLines(a === 1 ? SAMPLE_CFG_A : SAMPLE_CFG_B, b === 1 ? SAMPLE_CFG_A : SAMPLE_CFG_B);
      return { hunks: toHunks(ops, 3), stats: diffStats(ops) };
    },
    remove: async (id) => {
      const i = backups.findIndex((b) => b.id === id);
      if (i >= 0) backups.splice(i, 1);
    },
    downloadLinux: async (sid, paths) => {
      const s = sessions.get(sid)!;
      const b: BackupRecord = { id: backups.length + 1, deviceId: s.info.deviceId, deviceName: s.info.deviceName, ts: now(), kind: 'linux-files', path: '/demo/backups/linux', size: 12345, sha256: '', comment: paths.join(', '), sameAsPrevious: false };
      backups.unshift(b);
      return b;
    }
  },
  diagnostics: {
    save: async (deviceId, deviceName, task, report) => {
      const r = { id: diagnostics.length + 1, deviceId, deviceName, task, ts: now(), report };
      diagnostics.unshift(r);
      return r;
    },
    list: async (deviceId, task) => clone(diagnostics.filter((d) => (!deviceId || d.deviceId === deviceId) && (!task || d.task === task)))
  },
  profiles: { list: async () => clone(profiles), save: async () => {}, reset: async () => {} },
  templates: {
    listParams: async () => clone(templateParams),
    saveParam: async (p) => void templateParams.push(p),
    removeParam: async (n) => {
      const i = templateParams.findIndex((p) => p.name === n);
      if (i >= 0) templateParams.splice(i, 1);
    }
  },
  io: {
    previewTxt: async () => {
      const r = importTxt(mainTxt, { fileLabel: 'komandy-kommutatorov.txt', sourceKey: 'preview', source: 'imported' }, { encoding: 'utf-8' });
      return {
        report: r.report,
        items: r.records.map((x) => ({ title: x.title, command: x.command, platform: x.platform, vendorLabel: x.vendorLabel, category: x.category, entryType: x.entryType, startLine: x.originLine ?? 0, flags: [...(x.needsReview ? ['Требует проверки'] : []), ...(x.vendorUnknown ? ['Производитель не указан'] : [])], duplicateOf: 'совпадает с записью из «Команды комутаторов.txt»' }))
      };
    },
    importTxt: async () => ({ ...reports[0].report, imported: 0, updated: 0, unchanged: reports[0].report.entries }) as TxtParseReport,
    exportTxt: async () => commands.filter((c) => c.source !== 'builtin').length,
    exportJson: async () => commands.length,
    previewJson: async () => ({ commands: { total: 10, new: 2, same: 7, conflicts: [{ uid: 'x', title: 'Пример отличающейся записи' }] }, scenarios: { total: 1, new: 1, conflicts: 0 }, devices: { total: 2, new: 1, existing: 1 }, notes: 1 }),
    importJson: async () => ({ commands: { total: 0, new: 0, same: 0, conflicts: [] }, scenarios: { total: 0, new: 0, conflicts: 0 }, devices: { total: 0, new: 0, existing: 0 }, notes: 0 }),
    previewDevicesCsv: async () => ({ devices: [], hasPasswordColumn: false, errors: [] }),
    importDevicesCsv: async () => 0,
    previewSshConfig: async () => ({ devices: [], hasPasswordColumn: false, errors: [] }),
    importSshConfig: async () => 0,
    exportEncrypted: async () => ({ devices: devices.length, secrets: 4, commands: commands.length }),
    exportDevices: async (_p, o) => ({ devices: o.deviceIds?.length ?? devices.length, groups: 2, knownHosts: o.knownHosts ? 3 : 0, secrets: o.secrets ? 2 : 0, jumpAdded: 0, encrypted: o.secrets ? 1 : 0 }),
    exportDevicesCsv: async (_p, ids) => ids?.length ?? devices.length,
    previewDevicesFile: async (_p, pw) =>
      pw === undefined && _p.includes('enc')
        ? { encrypted: true, needsPassword: true, content: 'devices', createdAt: ago(30), appVersion: '1.0.0', devices: [], groups: 0, knownHosts: 0, knownHostConflicts: 0, secrets: 0 }
        : {
            encrypted: false,
            needsPassword: false,
            content: 'devices',
            createdAt: ago(30),
            appVersion: '1.0.0',
            devices: [
              { name: 'SW-ACCESS-2', host: '10.10.1.12', port: 22, protocol: 'ssh', username: 'admin', group: 'Коммутаторы доступа', hasSecret: false, warnings: [] },
              { name: 'SW-CORE-1', host: devices[0]?.host ?? '10.10.0.1', port: 22, protocol: 'ssh', username: devices[0]?.username ?? 'admin', group: 'Ядро сети', duplicateOf: devices[0]?.name, hasSecret: false, warnings: [] },
              { name: 'console-stand', host: 'COM3', port: 0, protocol: 'serial', username: '', group: '', hasSecret: false, warnings: ['COM-порт COM3: на другом компьютере номер порта может отличаться'] },
              { name: 'srv-files', host: '10.10.5.21', port: 22, protocol: 'ssh', username: 'admin', group: 'Серверы', hasSecret: false, warnings: ['вход по ключу: файл C:\\Users\\admin\\.ssh\\id_ed25519 нужно скопировать отдельно и при необходимости указать новый путь'] }
            ],
            groups: 3,
            knownHosts: 3,
            knownHostConflicts: 0,
            secrets: 0
          },
    importDevicesFile: async () => ({ devices: 3, devicesSkipped: 1, groups: 2, knownHosts: 3, knownHostConflicts: 0 }),
    previewEncrypted: async () => ({ createdAt: ago(60), appVersion: '0.9.0', schemaVersion: 1, counts: { commands: commands.length, devices: devices.length, secrets: 4 } }),
    importEncrypted: async () => ({ devices: 0, secrets: 0, commands: 0 }),
    backupDatabase: async () => {},
    restoreDatabase: async () => {},
    importReports: async () => clone(reports)
  },
  db: {
    integrity: async () => 'ok',
    autoBackups: async () => [{ name: 'netadmin-2026-11-16.db', size: 1843200, mtime: ago(60 * 20) }],
    restoreAutoBackup: async () => {}
  },
  on: (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }
};

(window as unknown as { nad: typeof api }).nad = api;
