// Профили диагностики коммутаторов: для каждой платформы — свои команды.
// fromUserTxt — команда взята из TXT-заметок; unverified — синтаксис не подтверждён для всех моделей.
// Профили можно редактировать в приложении (Диагностика → Профили платформ).
import type { DiagnosticProfile, DiagnosticProfileStep } from '../src/shared/types';

export interface SwitchTask {
  id: string;
  title: string;
  params: string[];
  description: string;
  /** Задача только для этих платформ (например, межсетевого экрана UserGate). */
  only?: string[];
}

export const SWITCH_TASKS: SwitchTask[] = [
  { id: 'port-status', title: 'Проверить состояние порта', params: ['INTERFACE'], description: 'Линк, скорость, дуплекс, статус порта.' },
  { id: 'port-config', title: 'Посмотреть конфигурацию порта', params: ['INTERFACE'], description: 'Режим, VLAN, описание, прочие настройки порта.' },
  { id: 'port-errors', title: 'Проверить ошибки порта', params: ['INTERFACE'], description: 'CRC, input/output errors, отбросы.' },
  { id: 'port-counters', title: 'Посмотреть счётчики', params: ['INTERFACE'], description: 'Трафик и счётчики пакетов.' },
  { id: 'mac-find', title: 'Найти устройство по MAC', params: ['MAC'], description: 'VLAN и порт, за которым виден MAC-адрес.' },
  { id: 'arp-ip', title: 'Посмотреть ARP по IP', params: ['IP'], description: 'MAC-адрес, соответствующий IP.' },
  { id: 'vlan-check', title: 'Проверить VLAN', params: ['VLAN'], description: 'Существует ли VLAN и на каких портах.' },
  { id: 'trunk-check', title: 'Проверить Trunk', params: [], description: 'Trunk-порты и разрешённые VLAN.' },
  { id: 'poe-check', title: 'Проверить PoE', params: [], description: 'Бюджет и потребление PoE по портам.' },
  { id: 'portchannel-check', title: 'Проверить Port-Channel', params: [], description: 'Агрегированные каналы и их участники.' },
  { id: 'neighbors', title: 'Посмотреть соседей CDP/LLDP', params: [], description: 'Подключённые соседние устройства.' },
  { id: 'logs', title: 'Посмотреть логи', params: [], description: 'Журнал событий коммутатора.' },
  { id: 'hw-info', title: 'Получить информацию об оборудовании', params: [], description: 'Модель, серийный номер, версия ПО, датчики.' },
  { id: 'memory', title: 'Проверить свободную память', params: [], description: 'Оперативная и flash-память.' },
  { id: 'system', title: 'Проверить системные параметры', params: [], description: 'Время работы, время на устройстве, общие сведения.' },
  { id: 'ports-overview', title: 'Обзор всех портов', params: [], description: 'Какие порты подключены, скорость, VLAN — одной таблицей.' },
  { id: 'port-macs', title: 'Кто подключён к порту (MAC)', params: ['INTERFACE'], description: 'MAC-адреса устройств за портом: одно устройство или ещё коммутатор.' },
  { id: 'vlan-list', title: 'Список всех VLAN', params: [], description: 'Какие VLAN есть на коммутаторе и их порты.' },
  { id: 'errdisabled', title: 'Порты, отключённые защитой (err-disabled)', params: [], description: 'Порты, выключенные BPDU Guard, port-security и т. п., и причины.' },
  { id: 'stp-check', title: 'Проверить Spanning Tree (петли)', params: [], description: 'Корневой мост, заблокированные порты, изменения топологии.' },
  { id: 'sfp-check', title: 'Проверить оптику (SFP)', params: [], description: 'Модули SFP и уровни сигнала (DOM), если поддерживается.' },
  { id: 'cable-test', title: 'Проверить медный кабель (TDR)', params: ['INTERFACE'], description: 'Длина и исправность пар кабеля; на время теста порт может пропасть.' },
  { id: 'cpu-check', title: 'Проверить загрузку процессора', params: [], description: 'Высокая загрузка CPU — признак шторма, петли или атаки.' },
  { id: 'time-check', title: 'Проверить время и синхронизацию', params: [], description: 'Время на устройстве и состояние NTP/SNTP.' },
  { id: 'sessions', title: 'Кто подключён к коммутатору', params: [], description: 'Активные сеансы управления (SSH, Telnet, консоль).' },
  { id: 'config-view', title: 'Посмотреть текущую конфигурацию', params: [], description: 'Действующая конфигурация целиком.' },
  { id: 'route-check', title: 'Куда идёт трафик к адресу (маршрут)', params: ['IP'], description: 'Какой маршрут и шлюз межсетевой экран выберет для адреса.', only: ['usergate'] },
  { id: 'host-reach', title: 'Доступен ли адрес с межсетевого экрана', params: ['HOST'], description: 'Ping и трассировка с самого межсетевого экрана: виден ли узел из его сети.', only: ['usergate'] },
  { id: 'connections', title: 'Соединения к адресу и от него', params: ['IP'], description: 'Записи таблицы соединений: есть ли трафик, установлено ли соединение (ASSURED) или нет ответа (UNREPLIED).', only: ['usergate'] },
  { id: 'blocked-ip', title: 'Адреса, заблокированные СОВ', params: [], description: 'Таблица IP-адресов, временно заблокированных системой обнаружения вторжений.', only: ['usergate'] },
  { id: 'cluster-check', title: 'Состояние кластера (HA)', params: [], description: 'Какой узел ведущий, состояние узлов и история переключений.', only: ['usergate'] }
];

/** Задачи, доступные для платформы. */
export function tasksFor(platform: string, hasProfile: (task: string) => boolean, onlyProfiled = false): SwitchTask[] {
  return SWITCH_TASKS.filter((t) => (!t.only || t.only.includes(platform)) && (!onlyProfiled || hasProfile(t.id)));
}

const u = (command: string, note?: string): DiagnosticProfileStep => ({ command, note, fromUserTxt: true });
const d = (command: string, note?: string): DiagnosticProfileStep => ({ command, note });
const x = (command: string, note?: string): DiagnosticProfileStep => ({ command, note, unverified: true });

type ProfileMap = Record<string, Partial<Record<string, DiagnosticProfileStep[]>>>;

const MAP: ProfileMap = {
  'unknown-ios': {
    'port-status': [u('show interfaces status')],
    'port-errors': [u('show interfaces {{INTERFACE}} counters errors'), u('show interface counters errors')],
    'port-counters': [u('show interfaces counters')],
    'port-config': [x('show running-config interface {{INTERFACE}}')],
    'mac-find': [u('show mac address-table address {{MAC}}')],
    'arp-ip': [u('show ip arp | in {{IP}}')],
    'vlan-check': [u('show vlan id {{VLAN}}')],
    'poe-check': [u('show power inline'), u('show power inline consumption')],
    'portchannel-check': [x('show etherchannel summary')],
    neighbors: [u('show cdp neighbors')],
    logs: [u('show log')],
    'hw-info': [u('show env all'), u('show inventory'), u('show version')],
    memory: [u('show platform resources'), u('show memory'), u('dir flash:')],
    system: [u('show system'), u('show version')]
  },
  'cisco-ios': {
    'port-status': [d('show interfaces {{INTERFACE}} status'), d('show interfaces {{INTERFACE}}')],
    'port-config': [d('show running-config interface {{INTERFACE}}'), d('show interfaces {{INTERFACE}} switchport')],
    'port-errors': [d('show interfaces {{INTERFACE}} counters errors'), d('show interfaces {{INTERFACE}} | include error|CRC|drops|collision')],
    'port-counters': [d('show interfaces {{INTERFACE}} counters')],
    'mac-find': [d('show mac address-table address {{MAC}}')],
    'arp-ip': [d('show ip arp {{IP}}')],
    'vlan-check': [d('show vlan id {{VLAN}}')],
    'trunk-check': [d('show interfaces trunk')],
    'poe-check': [d('show power inline')],
    'portchannel-check': [d('show etherchannel summary'), d('show lacp neighbor')],
    neighbors: [d('show cdp neighbors detail'), d('show lldp neighbors detail')],
    logs: [d('show logging')],
    'hw-info': [d('show version'), d('show inventory'), d('show environment all')],
    memory: [d('show memory statistics'), d('show processes cpu sorted 5sec')],
    system: [d('show version'), d('show clock detail'), d('show ntp status')]
  },
  'cisco-sg300': {
    'port-status': [d('show interfaces status {{INTERFACE}}')],
    'port-config': [d('show interfaces switchport {{INTERFACE}}'), x('show running-config interface {{INTERFACE}}')],
    'port-errors': [d('show interfaces counters {{INTERFACE}}')],
    'port-counters': [d('show interfaces counters {{INTERFACE}}')],
    'mac-find': [x('show mac address-table address {{MAC}}')],
    'arp-ip': [x('show arp')],
    'vlan-check': [x('show vlan tag {{VLAN}}')],
    'trunk-check': [d('show interfaces switchport')],
    'poe-check': [d('show power inline')],
    'portchannel-check': [x('show interfaces port-channel')],
    neighbors: [d('show lldp neighbors')],
    logs: [d('show logging')],
    'hw-info': [d('show version'), d('show system'), x('show inventory')],
    memory: [x('show cpu utilization')],
    system: [d('show system'), d('show clock')]
  },
  'hp-procurve': {
    'port-status': [u('show interfaces brief'), d('show interfaces {{INTERFACE}}')],
    'port-config': [u('show running-config interface {{INTERFACE}}'), x('show vlans ports {{INTERFACE}} detail')],
    'port-errors': [d('show interfaces {{INTERFACE}}')],
    'port-counters': [d('show interfaces {{INTERFACE}}')],
    'mac-find': [u('show mac-address {{MAC}}', 'формат MAC — как в TXT-заметках')],
    'arp-ip': [d('show arp')],
    'vlan-check': [u('show vlans {{VLAN}}')],
    'trunk-check': [d('show trunks')],
    'poe-check': [d('show power-over-ethernet brief')],
    'portchannel-check': [d('show trunks'), d('show lacp')],
    neighbors: [d('show lldp info remote-device'), x('show cdp neighbors')],
    logs: [d('show logging -r')],
    'hw-info': [d('show system'), d('show version')],
    memory: [d('show system')],
    system: [d('show system'), d('show time')]
  },
  linksys: {
    'port-config': [u('show interfaces switchport ethernet {{INTERFACE}}')],
    'mac-find': [u('show fdb', 'поиск MAC выполняется по полной таблице')],
    'port-status': [u('show interfaces description')],
    'vlan-check': [x('show vlan')]
  },
  'at-8000s': {
    'mac-find': [u('show bridge address-table address {{MAC}}')],
    'port-config': [u('show interfaces switchport ethernet {{INTERFACE}}')],
    'port-counters': [x('show interfaces counters ethernet {{INTERFACE}}')],
    'vlan-check': [u('show bridge address-table vlan {{VLAN}}', 'MAC-адреса в VLAN')]
  },
  alliedware: {
    'port-status': [u('show interface={{PORT}}'), u('show switch port={{PORT}}')],
    'port-config': [u('show switch port={{PORT}}'), u('show vlan port={{PORT}}')],
    'port-counters': [x('show switch port={{PORT}} counter')],
    'port-errors': [x('show switch port={{PORT}} counter')],
    'mac-find': [u('show switch fdb address={{MAC}}')],
    'arp-ip': [u('sh ip arp')],
    'vlan-check': [u('sh vlan={{VLAN}}')],
    'trunk-check': [u('sh conf dyn=vlan')],
    logs: [x('show log')],
    'hw-info': [x('show system')],
    system: [x('show system'), u('sh config')]
  },
  qtech: {
    'port-status': [u('show interface ethernet status')],
    'port-counters': [u('show interface ethernet counter packet'), u('show interface ethernet counter rate')],
    'hw-info': [u('show version')]
  },
  osnovo: {
    'port-status': [u('show interface brief L2'), u('show interface {{INTERFACE}}')],
    'port-config': [u('show interface {{INTERFACE}}')],
    'port-counters': [u('show interface statistics {{INTERFACE}}')],
    'port-errors': [u('show interface statistics {{INTERFACE}}')],
    'mac-find': [u('show bridge fdb vlan {{VLAN}}', 'поиск MAC — по таблице FDB указанного VLAN')],
    'vlan-check': [u('show bridge fdb vlan {{VLAN}}')],
    'hw-info': [u('show version'), u('show switch')],
    system: [u('show switch'), u('show version')]
  },
  tplink: {
    'port-status': [x('show interface status')],
    'mac-find': [x('show mac address-table address {{MAC}}')],
    'vlan-check': [x('show vlan id {{VLAN}}')],
    'hw-info': [x('show system-info')]
  },
  // UserGate NGFW 7.x: команды режима диагностики (Admin@узел>) по документации производителя.
  usergate: {
    'port-status': [x('show network interface')],
    'port-config': [x('show network interface {{INTERFACE}} type info')],
    'port-counters': [x('show network interface {{INTERFACE}} type statistics')],
    'port-errors': [x('show network interface {{INTERFACE}} type statistics', 'ошибки и отбросы — в статистике интерфейса')],
    'arp-ip': [x('show network arp host {{IP}}')],
    neighbors: [x('show lldp neighbors', 'нужен включённый профиль LLDP на интерфейсах')],
    'hw-info': [x('show system version')],
    system: [x('show system version'), x('date')]
  }
};

/** Команды «полной таблицы MAC» для поиска с локальной фильтрацией по любому формату MAC. */
export const MAC_TABLE_DUMP: Record<string, DiagnosticProfileStep> = {
  'unknown-ios': u('show mac address-table'),
  'cisco-ios': d('show mac address-table'),
  'cisco-sg300': d('show mac address-table'),
  'hp-procurve': d('show mac-address'),
  linksys: u('show fdb'),
  'at-8000s': u('show bridge address-table'),
  alliedware: u('show switch fdb'),
  qtech: x('show mac-address-table'),
  osnovo: x('show bridge fdb'),
  tplink: x('show mac address-table all')
};

/** Команды получения соседей (CDP/LLDP) для трассировки MAC. */
export const NEIGHBOR_COMMANDS: Record<string, DiagnosticProfileStep[]> = {
  'unknown-ios': [u('show cdp neighbors'), x('show cdp neighbors detail'), x('show lldp neighbors detail')],
  'cisco-ios': [d('show cdp neighbors detail'), d('show lldp neighbors detail')],
  'cisco-sg300': [d('show lldp neighbors')],
  'hp-procurve': [d('show lldp info remote-device')],
  tplink: [x('show lldp neighbor-information interface')]
};

/** Дополнительные задачи диагностики (версия 2 справочника). */
const EXTRA: ProfileMap = {
  'unknown-ios': {
    'ports-overview': [u('show interfaces status')],
    'port-macs': [x('show mac address-table interface {{INTERFACE}}')],
    'vlan-list': [x('show vlan brief')],
    'errdisabled': [x('show interfaces status err-disabled')],
    'stp-check': [x('show spanning-tree summary')],
    'config-view': [x('show running-config')]
  },
  'cisco-ios': {
    'ports-overview': [d('show interfaces status')],
    'port-macs': [d('show mac address-table interface {{INTERFACE}}')],
    'vlan-list': [d('show vlan brief')],
    'errdisabled': [d('show interfaces status err-disabled'), d('show errdisable recovery')],
    'stp-check': [d('show spanning-tree summary'), d('show spanning-tree detail | include ieee|occurr|from|is exec')],
    'sfp-check': [d('show interfaces transceiver'), d('show inventory')],
    'cable-test': [d('test cable-diagnostics tdr interface {{INTERFACE}}', 'тест занимает несколько секунд; порт может кратковременно пропасть'), d('show cable-diagnostics tdr interface {{INTERFACE}}')],
    'cpu-check': [d('show processes cpu sorted | exclude 0.00%'), d('show processes cpu history')],
    'time-check': [d('show clock detail'), d('show ntp status'), d('show ntp associations')],
    sessions: [d('show users'), d('show ssh')],
    'config-view': [d('show running-config')]
  },
  'cisco-sg300': {
    'ports-overview': [d('show interfaces status')],
    'port-macs': [x('show mac address-table interface {{INTERFACE}}')],
    'vlan-list': [d('show vlan')],
    'stp-check': [d('show spanning-tree')],
    'sfp-check': [x('show fiber-ports optical-transceiver')],
    'cable-test': [x('test cable-diagnostics tdr interface {{INTERFACE}}'), x('show cable-diagnostics tdr interface {{INTERFACE}}')],
    'cpu-check': [d('show cpu utilization')],
    'time-check': [d('show clock'), x('show sntp status')],
    sessions: [x('show users')],
    'config-view': [d('show running-config')]
  },
  'hp-procurve': {
    'ports-overview': [u('show interfaces brief')],
    'port-macs': [u('show mac-address {{INTERFACE}}')],
    'vlan-list': [d('show vlans')],
    'stp-check': [d('show spanning-tree')],
    'sfp-check': [x('show interfaces transceivers'), x('show interfaces transceivers detail')],
    'cable-test': [x('test cable-diagnostics {{INTERFACE}}'), x('show cable-diagnostics {{INTERFACE}}')],
    'cpu-check': [d('show cpu')],
    'time-check': [d('show time'), x('show sntp')],
    sessions: [x('show ip ssh')],
    'config-view': [d('show running-config')]
  },
  linksys: {
    'ports-overview': [x('show interfaces status')],
    'port-macs': [u('show mac address-table ethernet {{INTERFACE}}')],
    'vlan-list': [x('show vlan')],
    'config-view': [x('show running-config')]
  },
  'at-8000s': {
    'ports-overview': [x('show interfaces status')],
    'port-macs': [u('show bridge address-table ethernet {{INTERFACE}}')],
    'vlan-list': [x('show vlan')],
    'config-view': [x('show running-config')]
  },
  alliedware: {
    'ports-overview': [u('show interfaces status')],
    'port-macs': [u('show switch fdb port={{INTERFACE}}')],
    'vlan-list': [u('show vlan')],
    'config-view': [u('show config dynamic')]
  },
  qtech: {
    'ports-overview': [u('show interface ethernet status')],
    'port-macs': [x('show mac-address-table interface ethernet {{INTERFACE}}')],
    'vlan-list': [x('show vlan')],
    'config-view': [x('show running-config')]
  },
  osnovo: {
    'ports-overview': [u('show interface brief L2')],
    'port-macs': [u('show bridge fdb interface {{INTERFACE}}')],
    'config-view': [x('show running-config')]
  },
  tplink: {
    'ports-overview': [x('show interface status')],
    'port-macs': [x('show mac address-table interface gigabitEthernet {{INTERFACE}}')],
    'vlan-list': [x('show vlan')],
    'config-view': [x('show running-config')]
  },
  usergate: {
    'ports-overview': [x('show network interface')],
    'time-check': [x('date')],
    'route-check': [x('show network route ip {{IP}}')],
    'host-reach': [x('ping hostname {{HOST}} count 4', 'без count ping не остановится сам'), x('traceroute hostname {{HOST}}')],
    connections: [x('show traffic connections dest-ip {{IP}}'), x('show traffic connections source-ip {{IP}}')],
    'blocked-ip': [x('show blocked-ip')],
    'cluster-check': [x('show ha-cluster state'), x('show ha-cluster tablestat'), x('show ha-cluster failover')]
  }
};

export function builtinProfiles(): DiagnosticProfile[] {
  const out: DiagnosticProfile[] = [];
  for (const [platform, base] of Object.entries(MAP)) {
    const tasks = { ...base, ...(EXTRA[platform] ?? {}) };
    for (const t of SWITCH_TASKS) {
      const steps = tasks[t.id];
      if (steps && steps.length) out.push({ platform, task: t.id, steps });
    }
  }
  return out;
}
