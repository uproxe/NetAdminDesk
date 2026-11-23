// Категории справочника и автоматическое определение категории для импортируемых команд.

export interface CategoryInfo {
  id: string;
  name: string;
  kind: 'switch' | 'linux' | 'sql';
}

export const SWITCH_CATEGORIES: CategoryInfo[] = [
  ['cli-basics', 'Основы CLI: вход, режимы, выход'],
  ['general', 'Общая информация о коммутаторе'],
  ['hardware', 'Диагностика оборудования'],
  ['port-check', 'Проверка портов'],
  ['port-config', 'Настройка портов'],
  ['access-trunk', 'Access / Trunk'],
  ['vlan', 'VLAN'],
  ['mac', 'MAC Address Table'],
  ['fdb', 'FDB'],
  ['arp', 'ARP'],
  ['ip-interfaces', 'IP-интерфейсы'],
  ['routing', 'Маршрутизация'],
  ['acl', 'ACL'],
  ['object-groups', 'Object Groups'],
  ['port-channel', 'Port-Channel'],
  ['etherchannel', 'EtherChannel'],
  ['poe', 'PoE'],
  ['stp', 'STP'],
  ['lacp', 'LACP'],
  ['lldp', 'LLDP'],
  ['cdp', 'CDP'],
  ['logs', 'Логи'],
  ['errors', 'Ошибки интерфейсов'],
  ['counters', 'Счётчики'],
  ['ntp', 'SNTP / NTP'],
  ['backup', 'Резервное копирование'],
  ['firmware', 'Обновление прошивки'],
  ['users', 'Управление пользователями'],
  ['security', 'Безопасность'],
  ['reboot', 'Перезагрузка'],
  ['management', 'Управление: IP, имя, доступ'],
  ['zones', 'Зоны и доступ к управлению'],
  ['firewall', 'Правила межсетевого экрана и NAT'],
  ['traffic', 'Трафик, соединения, захват пакетов'],
  ['net-diag', 'Ping, traceroute, DNS, проверка сайта'],
  ['dns', 'DNS'],
  ['cluster', 'Кластер и отказоустойчивость'],
  ['snmp', 'SNMP и мониторинг'],
  ['other', 'Прочее']
].map(([id, name]) => ({ id, name, kind: 'switch' as const }));

export const LINUX_CATEGORIES: CategoryInfo[] = [
  ['basics', 'Первые шаги в терминале'],
  ['editors', 'Редакторы nano и vim'],
  ['power', 'Перезагрузка и выключение'],
  ['sysinfo', 'Общая информация о системе'],
  ['files', 'Файлы и каталоги'],
  ['text', 'Поиск и обработка текста'],
  ['perms', 'Права и пользователи'],
  ['processes', 'Процессы и нагрузка'],
  ['systemd', 'Службы systemd'],
  ['network', 'Сетевые команды'],
  ['ssh', 'SSH и передача файлов'],
  ['disks', 'Диски и файловые системы'],
  ['packages', 'Пакеты и обновления'],
  ['logs', 'Логи и диагностика'],
  ['firewall', 'Firewall и безопасность'],
  ['cron', 'Cron и автоматизация'],
  ['bash', 'Скрипты Bash'],
  ['backup', 'Резервное копирование'],
  ['docker', 'Docker и контейнеры'],
  ['nginx', 'Nginx'],
  ['apache', 'Apache'],
  ['mysql', 'MySQL / MariaDB'],
  ['postgresql', 'PostgreSQL'],
  ['samba', 'Samba'],
  ['nfs', 'NFS'],
  ['dns', 'DNS'],
  ['dhcp', 'DHCP'],
  ['web', 'Веб-сервисы'],
  ['monitoring', 'Мониторинг'],
  ['netservices', 'Сетевые службы'],
  ['time', 'Дата, время и язык'],
  ['dev', 'Git, Python, Java, Node.js'],
  ['virt', 'Виртуализация'],
  ['troubleshoot', 'Решение типовых проблем']
].map(([id, name]) => ({ id, name, kind: 'linux' as const }));

export const SQL_CATEGORIES: CategoryInfo[] = [
  ['sql-connect', 'Подключение к серверу БД'],
  ['sql-basics', 'Основы SQL: выборка данных'],
  ['sql-change', 'Изменение данных: INSERT, UPDATE, DELETE'],
  ['sql-databases', 'Базы данных и схемы'],
  ['sql-tables', 'Таблицы, столбцы, индексы'],
  ['sql-users', 'Пользователи и права'],
  ['sql-backup', 'Резервные копии и восстановление'],
  ['sql-monitor', 'Мониторинг: соединения, запросы, размер'],
  ['sql-locks', 'Блокировки и зависшие запросы'],
  ['sql-maint', 'Обслуживание: VACUUM, ANALYZE, проверка таблиц'],
  ['sql-config', 'Настройки и параметры сервера'],
  ['sql-replication', 'Репликация'],
  ['sql-service', 'Служба, логи и файлы'],
  ['sql-transactions', 'Транзакции']
].map(([id, name]) => ({ id, name, kind: 'sql' as const }));

const allCats = new Map<string, CategoryInfo>();
for (const c of SWITCH_CATEGORIES) allCats.set(`switch:${c.id}`, c);
for (const c of LINUX_CATEGORIES) allCats.set(`linux:${c.id}`, c);
for (const c of SQL_CATEGORIES) allCats.set(`sql:${c.id}`, c);

export function categoriesFor(kind: 'switch' | 'linux' | 'sql'): CategoryInfo[] {
  return kind === 'switch' ? SWITCH_CATEGORIES : kind === 'linux' ? LINUX_CATEGORIES : SQL_CATEGORIES;
}

export function categoryName(kind: 'switch' | 'linux' | 'sql', id: string): string {
  return allCats.get(`${kind}:${id}`)?.name ?? id;
}

type Rule = [RegExp, string];

// Порядок важен: более специфичные правила раньше.
const SWITCH_RULES: Rule[] = [
  [/object-group|обджек|групп/, 'object-groups'],
  [/access-list|access-group|\bacl\b|^\d+\s+(permit|deny)\b|^(permit|deny)\b|^no \d+$|^no \(|dynamic=class|resequence|аксесс|акцесс/m, 'acl'],
  [/power inline|\bpoe\b|power-over-ethernet/, 'poe'],
  [/etherchannel/, 'etherchannel'],
  [/\blacp\b/, 'lacp'],
  [/\blldp\b/, 'lldp'],
  [/\bcdp\b/, 'cdp'],
  [/spanning-tree|\bstp\b/, 'stp'],
  [/switchport|tagged|frame=tagged|vlan port=|\btrunk\b|\bnative\b/, 'access-trunk'],
  [/port-channel|\btrk\d|\btrunks\b|чанел/, 'port-channel'],
  [/bridge address-table|mac address-table|mac-address-table|mac-address\b/, 'mac'],
  [/\bfdb\b/, 'fdb'],
  [/\barp\b/, 'arp'],
  [/ip route|^router\b|show ip route|маршрутиз|dynamic=ip/m, 'routing'],
  [/ip interface|ip address|ip helper|ip dhcp/, 'ip-interfaces'],
  [/\bvlan\b|\bvlans\b|\bvtp\b|влан/, 'vlan'],
  [/\blog\b|logging|show log|\blogs?\b|логи/, 'logs'],
  [/counerts err|errors?\b|ошибк/, 'errors'],
  [/counters|counerts|statistics|counter\b|счетчик|счётчик/, 'counters'],
  [/\bsntp\b|\bntp\b|\bclock\b|времен/, 'ntp'],
  [/\bimage\b|boot system|firmware|прошивк/, 'firmware'],
  [/tftp|copy (running|startup)|write memory|whrite memory|create config|upload file|copy running-config|^wr\b|^write\b/m, 'backup'],
  [/telnet|\bssh\b|security|management access-list|macro auto/, 'security'],
  [/username|passwords?\b|privilege|пользовател|парол/, 'users'],
  [/\breload\b|\breboot\b|restart reboot|перезагруз/, 'reboot'],
  [/show env|platform resources|inventory|show system|\bmemory\b|flash:|file systems|show version|^show switch$|\bmtu\b|куллер|температур/m, 'hardware'],
  [/interfaces? status|interface brief|interfaces brief|show interface|show interfaces|show running-config interface|description|port=\d/, 'port-check'],
  [/interface range|default interface|\binterface\b|\bint\b|shutdown|disable$|enable$|speed|duplex/m, 'port-config'],
  [/history|show history|conf t|configure terminal|\bsh(ow)? config\b|show running-config|show startup-config/, 'general']
];

export function categorizeSwitch(command: string, description = ''): string {
  const text = `${command}\n${description}`.toLowerCase();
  for (const [re, cat] of SWITCH_RULES) {
    if (re.test(text)) return cat;
  }
  return 'other';
}
