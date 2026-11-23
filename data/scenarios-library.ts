// Библиотека сценариев: типовые задачи на коммутаторах для каждой платформы и задачи на Linux.
// Сценарий коммутатора собирается из «действий» платформы; если у платформы нет нужного действия,
// сценарий для неё не создаётся. Для всех платформ, кроме Cisco IOS, синтаксис требует проверки.
import type { ScenarioInput, ScenarioStep } from '../src/shared/types';
import { classifyCommand } from '../src/shared/risk';
import { getPlatform } from '../src/shared/platforms';

type Action =
  | 'ports' | 'status' | 'detail' | 'portcfg' | 'errors' | 'clear' | 'macport' | 'macfind' | 'arp' | 'poe' | 'poeoff' | 'poeon'
  | 'access' | 'portvlan' | 'trunkshow' | 'trunkadd' | 'vlans' | 'vlannew' | 'off' | 'on' | 'desc' | 'descs' | 'save' | 'tftp'
  | 'version' | 'log' | 'clock' | 'neighbors' | 'cpu' | 'run' | 'hostname' | 'mgmtip' | 'user' | 'ssh';

const cfg = (open: string, close: string, ...lines: string[]) => [open, ...lines, close].join('\n');

const CMD: Record<string, Partial<Record<Action, string>>> = {
  'cisco-ios': {
    ports: 'show interfaces status', status: 'show interfaces {{INTERFACE}} status', detail: 'show interfaces {{INTERFACE}}',
    portcfg: 'show running-config interface {{INTERFACE}}', errors: 'show interfaces {{INTERFACE}} counters errors', clear: 'clear counters {{INTERFACE}}',
    macport: 'show mac address-table interface {{INTERFACE}}', macfind: 'show mac address-table address {{MAC}}', arp: 'show ip arp {{MAC}}',
    poe: 'show power inline {{INTERFACE}}',
    poeoff: cfg('configure terminal', 'end', 'interface {{INTERFACE}}', 'power inline never'), poeon: cfg('configure terminal', 'end', 'interface {{INTERFACE}}', 'power inline auto'),
    access: cfg('configure terminal', 'end', 'interface {{INTERFACE}}', 'switchport mode access', 'switchport access vlan {{VLAN}}'),
    portvlan: 'show interfaces {{INTERFACE}} switchport', trunkshow: 'show interfaces trunk',
    trunkadd: cfg('configure terminal', 'end', 'interface {{INTERFACE}}', 'switchport trunk allowed vlan add {{VLAN}}'),
    vlans: 'show vlan brief', vlannew: cfg('configure terminal', 'end', 'vlan {{VLAN}}', 'name {{VALUE}}'),
    off: cfg('configure terminal', 'end', 'interface {{INTERFACE}}', 'shutdown'), on: cfg('configure terminal', 'end', 'interface {{INTERFACE}}', 'no shutdown'),
    desc: cfg('configure terminal', 'end', 'interface {{INTERFACE}}', 'description {{VALUE}}'), descs: 'show interfaces description',
    save: 'write memory', tftp: 'copy running-config tftp://{{IP}}/{{FILE}}', version: 'show version', log: 'show logging',
    clock: 'show clock detail', neighbors: 'show cdp neighbors', cpu: 'show processes cpu sorted', run: 'show running-config',
    hostname: cfg('configure terminal', 'end', 'hostname {{DEVICE}}'),
    mgmtip: cfg('configure terminal', 'end', 'interface vlan {{VLAN}}', 'ip address {{IP}} 255.255.255.0', 'no shutdown', 'exit', 'ip default-gateway {{HOST}}'),
    user: cfg('configure terminal', 'end', 'username {{USERNAME}} privilege 15 secret {{PASSWORD}}'),
    ssh: cfg('configure terminal', 'end', 'ip domain-name local.lan', 'crypto key generate rsa modulus 2048', 'ip ssh version 2', 'line vty 0 15', 'transport input ssh', 'login local')
  },
  'cisco-sg300': {
    ports: 'show interfaces status', status: 'show interfaces status {{INTERFACE}}', portcfg: 'show running-config interface {{INTERFACE}}',
    errors: 'show interfaces counters {{INTERFACE}}', clear: 'clear counters', macport: 'show mac address-table interface {{INTERFACE}}',
    macfind: 'show mac address-table address {{MAC}}', arp: 'show arp', poe: 'show power inline {{INTERFACE}}',
    poeoff: cfg('configure', 'end', 'interface {{INTERFACE}}', 'power inline never'), poeon: cfg('configure', 'end', 'interface {{INTERFACE}}', 'power inline auto'),
    access: cfg('configure', 'end', 'interface {{INTERFACE}}', 'switchport mode access', 'switchport access vlan {{VLAN}}'),
    portvlan: 'show interfaces switchport {{INTERFACE}}', trunkshow: 'show interfaces switchport {{INTERFACE}}',
    trunkadd: cfg('configure', 'end', 'interface {{INTERFACE}}', 'switchport mode trunk', 'switchport trunk allowed vlan add {{VLAN}}'),
    vlans: 'show vlan', vlannew: cfg('configure', 'end', 'vlan database', 'vlan {{VLAN}}', 'exit', 'interface vlan {{VLAN}}', 'name {{VALUE}}'),
    off: cfg('configure', 'end', 'interface {{INTERFACE}}', 'shutdown'), on: cfg('configure', 'end', 'interface {{INTERFACE}}', 'no shutdown'),
    desc: cfg('configure', 'end', 'interface {{INTERFACE}}', 'description {{VALUE}}'), descs: 'show interfaces description',
    save: 'write', tftp: 'copy running-config tftp://{{IP}}/{{FILE}}', version: 'show version', log: 'show logging', clock: 'show clock',
    neighbors: 'show lldp neighbors', cpu: 'show cpu utilization', run: 'show running-config',
    hostname: cfg('configure', 'end', 'hostname {{DEVICE}}'),
    mgmtip: cfg('configure', 'end', 'interface vlan {{VLAN}}', 'ip address {{IP}} 255.255.255.0', 'exit', 'ip default-gateway {{HOST}}'),
    user: cfg('configure', 'end', 'username {{USERNAME}} privilege 15 password {{PASSWORD}}'), ssh: cfg('configure', 'end', 'ip ssh server')
  },
  'hp-procurve': {
    ports: 'show interfaces brief', status: 'show interfaces brief {{INTERFACE}}', detail: 'show interfaces {{INTERFACE}}',
    portcfg: 'show running-config interface {{INTERFACE}}', errors: 'show interfaces {{INTERFACE}}', clear: 'clear statistics {{INTERFACE}}',
    macport: 'show mac-address {{INTERFACE}}', macfind: 'show mac-address {{MAC}}', arp: 'show arp', poe: 'show power-over-ethernet {{INTERFACE}}',
    poeoff: cfg('configure', 'exit', 'no interface {{INTERFACE}} power-over-ethernet'), poeon: cfg('configure', 'exit', 'interface {{INTERFACE}} power-over-ethernet'),
    access: cfg('configure', 'exit', 'vlan {{VLAN}} untagged {{INTERFACE}}'), portvlan: 'show vlans ports {{INTERFACE}}', trunkshow: 'show vlans {{VLAN}}',
    trunkadd: cfg('configure', 'exit', 'vlan {{VLAN}} tagged {{INTERFACE}}'), vlans: 'show vlans', vlannew: cfg('configure', 'exit', 'vlan {{VLAN}} name "{{VALUE}}"'),
    off: cfg('configure', 'exit', 'interface {{INTERFACE}} disable'), on: cfg('configure', 'exit', 'interface {{INTERFACE}} enable'),
    desc: cfg('configure', 'exit', 'interface {{INTERFACE}} name "{{VALUE}}"'), descs: 'show interfaces brief',
    save: 'write memory', tftp: 'copy running-config tftp {{IP}} {{FILE}}', version: 'show version', log: 'show logging -r', clock: 'show time',
    neighbors: 'show lldp info remote-device', cpu: 'show cpu', run: 'show running-config',
    hostname: cfg('configure', 'exit', 'hostname "{{DEVICE}}"'), mgmtip: cfg('configure', 'exit', 'vlan {{VLAN}} ip address {{IP}} 255.255.255.0', 'ip default-gateway {{HOST}}'),
    ssh: cfg('configure', 'exit', 'crypto key generate ssh', 'ip ssh', 'no telnet-server')
  },
  linksys: {
    ports: 'show interfaces status', status: 'show interfaces status ethernet {{INTERFACE}}', portcfg: 'show interfaces switchport ethernet {{INTERFACE}}',
    errors: 'show interfaces counters ethernet {{INTERFACE}}', macport: 'show mac address-table ethernet {{INTERFACE}}', macfind: 'show bridge address-table address {{MAC}}',
    access: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'switchport mode access', 'switchport access vlan {{VLAN}}'),
    portvlan: 'show interfaces switchport ethernet {{INTERFACE}}', trunkshow: 'show interfaces switchport ethernet {{INTERFACE}}',
    trunkadd: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'switchport trunk allowed vlan add {{VLAN}}'),
    vlans: 'show vlan', vlannew: cfg('configure', 'end', 'vlan database', 'vlan {{VLAN}}', 'exit', 'interface vlan {{VLAN}}', 'name {{VALUE}}'),
    off: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'shutdown'), on: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'no shutdown'),
    desc: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'description {{VALUE}}'), descs: 'show interfaces description',
    save: 'copy running-config startup-config', tftp: 'copy running-config tftp://{{IP}}/{{FILE}}', version: 'show version', log: 'show logging', run: 'show running-config'
  },
  'at-8000s': {
    ports: 'show interfaces status', status: 'show interfaces status ethernet {{INTERFACE}}', portcfg: 'show interfaces switchport ethernet {{INTERFACE}}',
    errors: 'show interfaces counters ethernet {{INTERFACE}}', macport: 'show bridge address-table ethernet {{INTERFACE}}', macfind: 'show bridge address-table address {{MAC}}',
    access: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'switchport mode access', 'switchport access vlan {{VLAN}}'),
    portvlan: 'show interfaces switchport ethernet {{INTERFACE}}', trunkshow: 'show interfaces switchport ethernet {{INTERFACE}}',
    trunkadd: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'switchport trunk allowed vlan add {{VLAN}}'),
    vlans: 'show vlan', vlannew: cfg('configure', 'end', 'vlan database', 'vlan {{VLAN}}'),
    off: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'shutdown'), on: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'no shutdown'),
    desc: cfg('configure', 'end', 'interface ethernet {{INTERFACE}}', 'description {{VALUE}}'),
    save: 'copy running-config startup-config', tftp: 'copy running-config tftp://{{IP}}/{{FILE}}', version: 'show system', log: 'show logging', run: 'show running-config'
  },
  alliedware: {
    ports: 'show interfaces status', status: 'show switch port={{INTERFACE}}', portcfg: 'show vlan port={{INTERFACE}}', errors: 'show switch port={{INTERFACE}} counter',
    clear: 'reset switch port={{INTERFACE}} counter', macport: 'show switch fdb port={{INTERFACE}}', macfind: 'show switch fdb address={{MAC}}', arp: 'show ip arp',
    access: 'add vlan={{VLAN}} port={{INTERFACE}}', portvlan: 'show vlan port={{INTERFACE}}', trunkshow: 'show vlan port={{INTERFACE}}',
    trunkadd: 'add vlan={{VLAN}} port={{INTERFACE}} frame=tagged', vlans: 'show vlan', vlannew: 'create vlan={{VALUE}} vid={{VLAN}}',
    off: 'disable switch port={{INTERFACE}}', on: 'enable switch port={{INTERFACE}}', save: 'create config=boot.cfg',
    tftp: 'upload file=boot.cfg method=tftp server={{IP}} destfile={{FILE}}', version: 'show system', log: 'show log', run: 'show config dynamic'
  },
  qtech: {
    ports: 'show interface ethernet status', status: 'show interface ethernet {{INTERFACE}}', errors: 'show interface ethernet counter packet',
    macport: 'show mac-address-table interface ethernet {{INTERFACE}}', macfind: 'show mac-address-table address {{MAC}}',
    access: cfg('config', 'end', 'interface ethernet {{INTERFACE}}', 'switchport mode access', 'switchport access vlan {{VLAN}}'),
    portvlan: 'show interface ethernet {{INTERFACE}}', vlans: 'show vlan', vlannew: cfg('config', 'end', 'vlan {{VLAN}}', 'name {{VALUE}}'),
    off: cfg('config', 'end', 'interface ethernet {{INTERFACE}}', 'shutdown'), on: cfg('config', 'end', 'interface ethernet {{INTERFACE}}', 'no shutdown'),
    desc: cfg('config', 'end', 'interface ethernet {{INTERFACE}}', 'description {{VALUE}}'),
    save: 'write', version: 'show version', log: 'show logging buffered', neighbors: 'show lldp neighbors', run: 'show running-config'
  },
  osnovo: {
    ports: 'show interface brief L2', status: 'show interface {{INTERFACE}}', errors: 'show interface statistics {{INTERFACE}}',
    macport: 'show bridge fdb interface {{INTERFACE}}', version: 'show version', run: 'show running-config',
    off: cfg('configure terminal', 'exit', 'interface {{INTERFACE}}', 'shutdown'), on: cfg('configure terminal', 'exit', 'interface {{INTERFACE}}', 'no shutdown'),
    desc: cfg('configure terminal', 'exit', 'interface {{INTERFACE}}', 'description {{VALUE}}')
  },
  tplink: {
    ports: 'show interface status', status: 'show interface status gigabitEthernet {{INTERFACE}}', errors: 'show interface counters gigabitEthernet {{INTERFACE}}',
    macport: 'show mac address-table interface gigabitEthernet {{INTERFACE}}', macfind: 'show mac address-table address {{MAC}}',
    access: cfg('configure', 'end', 'interface gigabitEthernet {{INTERFACE}}', 'switchport general allowed vlan {{VLAN}} untagged', 'switchport pvid {{VLAN}}'),
    portvlan: 'show interface switchport gigabitEthernet {{INTERFACE}}', trunkshow: 'show interface switchport gigabitEthernet {{INTERFACE}}',
    trunkadd: cfg('configure', 'end', 'interface gigabitEthernet {{INTERFACE}}', 'switchport general allowed vlan {{VLAN}} tagged'),
    vlans: 'show vlan', vlannew: cfg('configure', 'end', 'vlan {{VLAN}}', 'name {{VALUE}}'),
    off: cfg('configure', 'end', 'interface gigabitEthernet {{INTERFACE}}', 'shutdown'), on: cfg('configure', 'end', 'interface gigabitEthernet {{INTERFACE}}', 'no shutdown'),
    desc: cfg('configure', 'end', 'interface gigabitEthernet {{INTERFACE}}', 'description {{VALUE}}'),
    save: 'copy running-config startup-config', tftp: 'copy startup-config tftp ip-address {{IP}} filename {{FILE}}', version: 'show system-info',
    log: 'show logging buffer', neighbors: 'show lldp neighbor-information', run: 'show running-config'
  }
};

type StepDef = [Action, string, string?, number?];

interface SwitchTask {
  id: string;
  name: string;
  description: string;
  steps: StepDef[];
}

const SAVE_NOTE = 'Сохраните конфигурацию только после проверки. Коммутатор может спросить подтверждение — ответьте в терминале.';

const SWITCH_TASKS: SwitchTask[] = [
  { id: 'port-diag', name: 'Диагностика порта', description: 'Состояние, настройки, ошибки и MAC-адреса одного порта. Только просмотр.', steps: [['status', 'Состояние порта'], ['portcfg', 'Настройки порта'], ['errors', 'Ошибки и счётчики'], ['macport', 'MAC-адреса на порту']] },
  { id: 'port-diag-poe', name: 'Диагностика PoE-порта (камера, точка, телефон)', description: 'Линк, питание, MAC-адрес устройства и ошибки. Только просмотр.', steps: [['status', 'Состояние порта'], ['poe', 'Подаётся ли питание'], ['macport', 'Видно ли устройство (MAC)'], ['errors', 'Ошибки']] },
  { id: 'find-mac', name: 'Найти устройство по MAC', description: 'Порт и VLAN по MAC; если за портом коммутатор — продолжите на нём (или используйте «Поиск MAC»).', steps: [['macfind', 'Где виден MAC'], ['neighbors', 'Соседи (нет ли за портом коммутатора)']] },
  { id: 'find-mac-arp', name: 'Найти IP устройства по MAC', description: 'Порт по MAC и IP-адрес из ARP-таблицы (на L3-коммутаторе).', steps: [['macfind', 'Где виден MAC'], ['arp', 'IP по ARP']] },
  { id: 'access-vlan', name: 'Перевести порт в другой VLAN', description: 'Смотрим текущие настройки, переводим порт в VLAN, проверяем. Сохранение — отдельным сценарием после проверки.', steps: [['portcfg', 'Текущие настройки (запомните, как было)'], ['vlans', 'Существует ли нужный VLAN'], ['access', 'Перевести порт в VLAN', 'Не меняйте порт, через который подключены.'], ['portvlan', 'Проверить результат']] },
  { id: 'trunk-add', name: 'Добавить VLAN на аплинк (trunk)', description: 'Добавить VLAN к разрешённым на trunk-порту, не затрагивая остальные.', steps: [['trunkshow', 'Текущие VLAN на trunk'], ['trunkadd', 'Добавить VLAN', 'Добавляется к существующему списку.'], ['trunkshow', 'Проверить']] },
  { id: 'vlan-new', name: 'Создать новый VLAN', description: 'Создание VLAN с именем и проверка.', steps: [['vlans', 'Текущие VLAN (номер свободен?)'], ['vlannew', 'Создать VLAN'], ['vlans', 'Проверить']] },
  { id: 'poe-reboot', name: 'Перезагрузить PoE-устройство', description: 'Снять питание с порта на 15 секунд и вернуть. Проверьте номер порта по описанию и MAC.', steps: [['poe', 'Питание до перезагрузки'], ['poeoff', 'Выключить питание', 'Устройство выключится.', 15000], ['poeon', 'Включить питание'], ['poe', 'Питание после включения']] },
  { id: 'port-bounce', name: 'Перезапустить порт', description: 'Выключить и включить порт — помогает при «зависшем» линке. Не выполняйте на порту, через который подключены.', steps: [['status', 'Состояние до'], ['off', 'Выключить порт', 'Устройство на порту потеряет связь.', 5000], ['on', 'Включить порт'], ['status', 'Состояние после']] },
  { id: 'port-label', name: 'Подписать порт', description: 'Задать описание порта и проверить.', steps: [['desc', 'Задать описание'], ['descs', 'Проверить описания']] },
  { id: 'errors-watch', name: 'Растут ли ошибки на порту', description: 'Сбросить счётчики, подождать минуту и посмотреть, появились ли новые ошибки.', steps: [['errors', 'Ошибки сейчас'], ['clear', 'Сбросить счётчики', 'Коммутатор может спросить подтверждение.', 60000], ['errors', 'Ошибки через минуту']] },
  { id: 'save', name: 'Сохранить конфигурацию', description: 'Записать текущую конфигурацию, чтобы она сохранилась после перезагрузки.', steps: [['save', 'Сохранить', SAVE_NOTE]] },
  { id: 'backup-tftp', name: 'Резервная копия на TFTP', description: 'Сохранить конфигурацию и выгрузить её на TFTP-сервер. Для копии в программе используйте раздел «Резервные копии».', steps: [['save', 'Сохранить конфигурацию', SAVE_NOTE], ['tftp', 'Выгрузить на TFTP']] },
  { id: 'overview', name: 'Обзор коммутатора', description: 'Модель, порты, VLAN и журнал — первое знакомство с устройством. Только просмотр.', steps: [['version', 'Модель и версия'], ['ports', 'Состояние портов'], ['vlans', 'VLAN'], ['log', 'Журнал']] },
  { id: 'health', name: 'Проверка здоровья коммутатора', description: 'Процессор, время, соседи и журнал. Только просмотр.', steps: [['version', 'Время работы и версия'], ['cpu', 'Загрузка процессора'], ['clock', 'Время'], ['neighbors', 'Соседи'], ['log', 'Журнал']] },
  { id: 'initial', name: 'Первичная настройка коммутатора', description: 'Имя, адрес управления, администратор, SSH. Выполняйте через консоль или пошагово — после смены адреса связь может пропасть.', steps: [['hostname', 'Имя коммутатора'], ['user', 'Пользователь-администратор'], ['ssh', 'Включить SSH'], ['mgmtip', 'Адрес управления и шлюз', 'Связь по старому адресу может пропасть.'], ['save', 'Сохранить', SAVE_NOTE]] }
];

let n = 0;
function step(title: string, command: string, kind: 'switch' | 'linux', note?: string, waitMs?: number, platform?: string): ScenarioStep {
  n++;
  return { id: `l${n}`, title, command, note, waitMs, risk: classifyCommand(command, kind, platform).level };
}

function buildSwitchScenarios(): ScenarioInput[] {
  const out: ScenarioInput[] = [];
  for (const task of SWITCH_TASKS)
    for (const [p, cmds] of Object.entries(CMD)) {
      if (!task.steps.every(([a]) => cmds[a])) continue;
      const pl = getPlatform(p);
      const review = p === 'cisco-ios' ? '' : ' Синтаксис для этой платформы требует проверки на вашей модели.';
      out.push({
        uid: `builtin:scenario:lib:${task.id}:${p}`,
        name: `${task.name} — ${pl.name}`,
        description: task.description + review,
        platforms: [p],
        steps: task.steps.map(([a, title, note, wait]) => step(title, cmds[a]!, 'switch', note, wait)),
        builtin: true,
        favorite: false
      });
    }
  return out;
}

const lx = 'linux' as const;
function L(id: string, name: string, description: string, steps: [string, string, string?][]): ScenarioInput {
  return { uid: `builtin:scenario:lib:linux:${id}`, name, description, platforms: ['linux'], steps: steps.map(([t, c, note]) => step(t, c, lx, note)), builtin: true, favorite: false };
}

const LINUX_SCENARIOS: ScenarioInput[] = [
  L('inventory', 'Паспорт сервера (инвентаризация)', 'ОС, железо, диски, сеть — для документации. Только просмотр.', [['ОС', 'cat /etc/os-release'], ['Ядро и имя', 'hostnamectl'], ['Процессор', 'lscpu | head -20'], ['Память', 'free -h'], ['Диски', 'lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS'], ['Адреса', 'ip -br a'], ['Виртуализация', 'systemd-detect-virt']]),
  L('quick-health', 'Быстрая проверка сервера (1 минута)', 'Нагрузка, память, место, упавшие службы, ошибки. Только просмотр.', [['Время работы и нагрузка', 'uptime'], ['Память', 'free -h'], ['Место', 'df -h -x tmpfs -x devtmpfs'], ['Упавшие службы', 'systemctl --failed --no-pager'], ['Ошибки за сутки', 'journalctl -p err --since "24 hours ago" --no-pager | tail -30']]),
  L('disk-full', 'Закончилось место: найти виновника', 'Разделы, крупные каталоги и файлы, журналы, кэш. Только просмотр.', [['Заполнение разделов', 'df -h'], ['Inode', 'df -i'], ['Крупные каталоги в /', 'sudo du -xh / --max-depth=1 2>/dev/null | sort -h | tail -15'], ['Крупные каталоги в /var', 'sudo du -xh /var --max-depth=2 2>/dev/null | sort -h | tail -15'], ['Файлы больше 500 МБ', 'sudo find / -xdev -type f -size +500M -exec ls -lh {} \\; 2>/dev/null'], ['Размер журнала systemd', 'journalctl --disk-usage'], ['Удалённые, но открытые файлы', 'sudo lsof +L1 2>/dev/null | head -20']]),
  L('disk-cleanup', 'Безопасная очистка места', 'Журнал systemd до 200 МБ, кэш пакетов, ненужные пакеты.', [['Место до', 'df -h /'], ['Сжать журнал systemd', 'sudo journalctl --vacuum-size=200M'], ['Очистить кэш пакетов', 'sudo apt clean'], ['Удалить ненужные зависимости', 'sudo apt autoremove -y', 'Проверьте список удаляемых пакетов в выводе.'], ['Место после', 'df -h /']]),
  L('high-load', 'Сервер тормозит: кто нагружает', 'Нагрузка, процессы по CPU и памяти, ввод-вывод. Только просмотр.', [['Нагрузка и ядра', 'uptime; nproc'], ['Топ по CPU', 'ps aux --sort=-%cpu | head -15'], ['Топ по памяти', 'ps aux --sort=-%mem | head -15'], ['Память и swap', 'free -h'], ['Ввод-вывод', 'vmstat 1 5'], ['Нехватка памяти (OOM)', 'sudo dmesg -T | grep -iE "out of memory|killed process" | tail']]),
  L('memory', 'Проверка памяти', 'Использование, swap, крупные процессы, OOM. Только просмотр.', [['Память', 'free -h'], ['Подробно', 'grep -E "MemTotal|MemAvailable|SwapTotal|SwapFree" /proc/meminfo'], ['Swap', 'swapon --show'], ['Топ по памяти', 'ps aux --sort=-%mem | head -10'], ['OOM', 'sudo dmesg -T | grep -i "killed process" | tail']]),
  L('network', 'Нет сети: проверка по шагам', 'Адрес, шлюз, DNS, интернет. Только просмотр.', [['Интерфейсы и адреса', 'ip -br a'], ['Маршрут по умолчанию', 'ip route'], ['Шлюз отвечает?', 'ping -c 3 $(ip route | awk \'/default/ {print $3; exit}\')'], ['Интернет по IP', 'ping -c 3 8.8.8.8'], ['DNS-серверы', 'resolvectl status 2>/dev/null | grep -i "dns server" || cat /etc/resolv.conf'], ['Разрешение имени', 'getent hosts ya.ru']]),
  L('dns', 'Не работает DNS', 'Какие DNS используются и отвечают ли. Только просмотр.', [['Настройки', 'resolvectl status 2>/dev/null || cat /etc/resolv.conf'], ['Через системный DNS', 'dig +short ya.ru'], ['Через 8.8.8.8', 'dig +short @8.8.8.8 ya.ru'], ['Файл hosts', 'cat /etc/hosts']]),
  L('ports', 'Какие порты открыты и кто слушает', 'Слушающие порты, firewall, активные соединения. Только просмотр.', [['Слушающие порты', 'sudo ss -tulpn'], ['Firewall', 'sudo ufw status verbose 2>/dev/null || sudo nft list ruleset | head -50'], ['Соединения', 'ss -s']]),
  L('port-check-remote', 'Проверить доступность порта на другом сервере', 'Ping и проверка TCP-порта. Укажите адрес и порт.', [['Ping', 'ping -c 3 {{HOST}}'], ['TCP-порт', 'nc -zv -w 3 {{HOST}} {{PORT}}'], ['Маршрут', 'tracepath -n {{HOST}}']]),
  L('site-down', 'Сайт не открывается', 'Веб-сервер, порты, локальный ответ, журнал ошибок. Только просмотр.', [['nginx', 'systemctl status nginx --no-pager 2>/dev/null | head -5'], ['Apache', 'systemctl status apache2 --no-pager 2>/dev/null | head -5'], ['Порты 80/443', 'sudo ss -tlnp | grep -E ":80 |:443 "'], ['Ответ локально', 'curl -sI http://localhost | head -5'], ['Ошибки nginx', 'sudo tail -n 30 /var/log/nginx/error.log 2>/dev/null'], ['Firewall', 'sudo ufw status 2>/dev/null']]),
  L('nginx-reload', 'Применить настройки nginx безопасно', 'Проверка конфигурации и мягкая перезагрузка.', [['Проверка конфигурации', 'sudo nginx -t'], ['Применить', 'sudo systemctl reload nginx', 'Выполняйте, только если проверка прошла успешно.'], ['Состояние', 'systemctl status nginx --no-pager | head -5']]),
  L('apache-restart', 'Перезапустить Apache безопасно', 'Проверка конфигурации, перезапуск, журнал.', [['Проверка конфигурации', 'sudo apache2ctl configtest'], ['Перезапуск', 'sudo systemctl restart apache2', 'Только если проверка — Syntax OK.'], ['Состояние', 'systemctl status apache2 --no-pager | head -5'], ['Ошибки', 'sudo tail -n 20 /var/log/apache2/error.log']]),
  L('service-fix', 'Служба не запускается: разбор', 'Состояние, журнал, зависимости. Укажите имя службы. Только просмотр.', [['Состояние', 'systemctl status {{SERVICE}} --no-pager'], ['Журнал службы', 'journalctl -u {{SERVICE}} -n 50 --no-pager'], ['Файл службы', 'systemctl cat {{SERVICE}}'], ['Зависимости', 'systemctl list-dependencies {{SERVICE}} --no-pager | head -20'], ['Место на диске', 'df -h /']]),
  L('service-restart', 'Перезапустить службу с проверкой', 'Состояние, перезапуск, контроль журнала. Укажите имя службы.', [['До', 'systemctl status {{SERVICE}} --no-pager | head -5'], ['Перезапуск', 'sudo systemctl restart {{SERVICE}}'], ['После', 'systemctl status {{SERVICE}} --no-pager | head -10'], ['Журнал', 'journalctl -u {{SERVICE}} -n 20 --no-pager']]),
  L('update', 'Обновить систему безопасно', 'Список обновлений, обновление, нужна ли перезагрузка.', [['Обновить списки', 'sudo apt update'], ['Что обновится', 'apt list --upgradable 2>/dev/null | head -40'], ['Обновить', 'sudo apt upgrade -y', 'Перед обновлением важного сервера сделайте снимок/копию.'], ['Нужна ли перезагрузка', 'cat /var/run/reboot-required 2>/dev/null || echo "Перезагрузка не требуется"']]),
  L('reboot-check', 'Нужна ли перезагрузка и когда была последняя', 'Признак обязательной перезагрузки, время работы, история. Только просмотр.', [['Требуется ли', 'cat /var/run/reboot-required 2>/dev/null || echo "нет"'], ['Какие пакеты требуют', 'cat /var/run/reboot-required.pkgs 2>/dev/null'], ['Последняя загрузка', 'uptime -s'], ['История перезагрузок', 'last -x reboot | head -5']]),
  L('user-new', 'Новый пользователь с правами sudo', 'Создать пользователя, добавить в sudo, проверить. Укажите имя.', [['Создать', 'sudo adduser {{USERNAME}}', 'Команда спросит пароль и данные — ответьте в терминале.'], ['Дать sudo', 'sudo usermod -aG sudo {{USERNAME}}'], ['Проверить группы', 'id {{USERNAME}}']]),
  L('user-audit', 'Кто заходил на сервер', 'Текущие сеансы, последние входы, неудачные попытки, sudo. Только просмотр.', [['Сейчас в системе', 'w'], ['Последние входы', 'last -n 20'], ['Неудачные попытки', 'sudo lastb -n 20 2>/dev/null'], ['Использование sudo', 'sudo journalctl _COMM=sudo --since "7 days ago" --no-pager | tail -20']]),
  L('ssh-security', 'Проверка безопасности SSH', 'Ключевые настройки sshd, вход root, пароли, fail2ban. Только просмотр.', [['Действующие настройки', 'sudo sshd -T | grep -E "^(permitrootlogin|passwordauthentication|port|pubkeyauthentication|maxauthtries)"'], ['Ключи root', 'sudo cat /root/.ssh/authorized_keys 2>/dev/null | cut -c1-60'], ['fail2ban', 'sudo fail2ban-client status sshd 2>/dev/null'], ['Неудачные входы', 'sudo grep -c "Failed password" /var/log/auth.log 2>/dev/null']]),
  L('ufw-setup', 'Включить firewall, сохранив SSH', 'Разрешить SSH, включить UFW, проверить.', [['Состояние', 'sudo ufw status'], ['Разрешить SSH', 'sudo ufw allow OpenSSH'], ['Включить', 'sudo ufw --force enable', 'SSH разрешён на предыдущем шаге.'], ['Проверить', 'sudo ufw status verbose']]),
  L('ufw-open', 'Открыть порт в firewall', 'Добавить правило и проверить. Укажите порт.', [['Правила сейчас', 'sudo ufw status numbered'], ['Открыть порт', 'sudo ufw allow {{PORT}}/tcp'], ['Проверить', 'sudo ufw status numbered']]),
  L('fail2ban', 'fail2ban: кто заблокирован', 'Состояние защиты SSH и заблокированные адреса. Только просмотр.', [['Все jail', 'sudo fail2ban-client status'], ['SSH', 'sudo fail2ban-client status sshd'], ['Журнал', 'sudo tail -n 30 /var/log/fail2ban.log']]),
  L('time', 'Проверить и включить синхронизацию времени', 'Время, пояс, NTP.', [['Состояние', 'timedatectl'], ['Включить NTP', 'sudo timedatectl set-ntp true'], ['Синхронизация', 'timedatectl timesync-status 2>/dev/null || chronyc tracking']]),
  L('logs-incident', 'Разбор после сбоя', 'Ошибки системы, ядра, перезагрузки и упавшие службы. Только просмотр.', [['Упавшие службы', 'systemctl --failed --no-pager'], ['Ошибки с загрузки', 'journalctl -p err -b --no-pager | tail -40'], ['Ошибки прошлой загрузки', 'journalctl -p err -b -1 --no-pager | tail -40'], ['Ядро', 'sudo dmesg -T --level=err,warn | tail -30'], ['Перезагрузки', 'last -x reboot shutdown | head -10']]),
  L('backup-etc', 'Резервная копия настроек (/etc)', 'Архив /etc с датой и проверка архива.', [['Каталог для копий', 'sudo mkdir -p /backup'], ['Архив', 'sudo tar -czpf /backup/etc-$(date +%F).tar.gz /etc'], ['Проверка', 'ls -lh /backup/ && sudo tar -tzf /backup/etc-$(date +%F).tar.gz | head']]),
  L('backup-mysql', 'Резервная копия MySQL / MariaDB', 'Дамп всех баз с датой.', [['Каталог', 'sudo mkdir -p /backup'], ['Дамп', 'sudo mysqldump --all-databases --single-transaction --routines | gzip > /tmp/mysql-$(date +%F).sql.gz && sudo mv /tmp/mysql-$(date +%F).sql.gz /backup/'], ['Проверка', 'ls -lh /backup/ | tail -5']]),
  L('backup-pg', 'Резервная копия PostgreSQL', 'Дамп всех баз с датой.', [['Каталог', 'sudo mkdir -p /backup'], ['Дамп', 'sudo -u postgres pg_dumpall | gzip > /tmp/pg-$(date +%F).sql.gz && sudo mv /tmp/pg-$(date +%F).sql.gz /backup/'], ['Проверка', 'ls -lh /backup/ | tail -5']]),
  L('mysql-check', 'Проверка MySQL / MariaDB', 'Служба, базы, размеры, процессы. Только просмотр.', [['Служба', 'systemctl status mysql mariadb --no-pager 2>/dev/null | head -8'], ['Базы', 'sudo mysql -e "SHOW DATABASES;"'], ['Размер баз', 'sudo mysql -e "SELECT table_schema, ROUND(SUM(data_length+index_length)/1024/1024) AS MB FROM information_schema.tables GROUP BY table_schema;"'], ['Запросы сейчас', 'sudo mysql -e "SHOW PROCESSLIST;"']]),
  L('pg-check', 'Проверка PostgreSQL', 'Кластеры, базы, активные подключения. Только просмотр.', [['Кластеры', 'pg_lsclusters 2>/dev/null'], ['Базы', 'sudo -u postgres psql -c "\\l"'], ['Подключения', 'sudo -u postgres psql -c "SELECT datname, usename, state, query_start FROM pg_stat_activity WHERE state IS NOT NULL;"']]),
  L('docker-status', 'Состояние Docker', 'Служба, контейнеры, ресурсы, место. Только просмотр.', [['Служба', 'systemctl status docker --no-pager | head -5'], ['Контейнеры', 'docker ps -a'], ['Ресурсы', 'docker stats --no-stream'], ['Место', 'docker system df']]),
  L('docker-compose-update', 'Обновить проект docker compose', 'Скачать новые образы и пересоздать контейнеры. Выполняйте в каталоге проекта.', [['Каталог проекта', 'pwd && ls'], ['Скачать образы', 'docker compose pull'], ['Пересоздать', 'docker compose up -d'], ['Состояние', 'docker compose ps']]),
  L('docker-cleanup', 'Очистка Docker', 'Удалить остановленные контейнеры, неиспользуемые образы и кэш.', [['Место до', 'docker system df'], ['Очистка', 'docker system prune -f', 'Удаляет остановленные контейнеры и неиспользуемые данные.'], ['Место после', 'docker system df']]),
  L('cert-check', 'Срок SSL-сертификата сайта', 'Даты действия и издатель. Укажите домен.', [['Даты', 'echo | openssl s_client -connect {{HOST}}:443 -servername {{HOST}} 2>/dev/null | openssl x509 -noout -dates -issuer -subject'], ['Таймер certbot', 'systemctl list-timers | grep -i certbot']]),
  L('big-files', 'Найти крупные и старые файлы', 'Файлы > 1 ГБ и файлы старше 90 дней в /var/log. Только просмотр.', [['Файлы > 1 ГБ', 'sudo find / -xdev -type f -size +1G -exec ls -lh {} \\; 2>/dev/null'], ['Старые журналы', 'sudo find /var/log -type f -mtime +90 | head -30']]),
  L('disk-health', 'Здоровье дисков', 'SMART, RAID, ошибки ядра. Только просмотр.', [['Диски', 'lsblk -d -o NAME,SIZE,MODEL,ROTA'], ['SMART', 'sudo smartctl -H /dev/sda'], ['RAID', 'cat /proc/mdstat 2>/dev/null'], ['Ошибки дисков', 'sudo dmesg -T | grep -iE "i/o error|ata.*error|nvme.*error" | tail']]),
  L('new-disk', 'Подключить новый диск', 'Найти диск, создать файловую систему, смонтировать. Укажите устройство (например /dev/sdb) и каталог.', [['Диски', 'lsblk'], ['Файловая система', 'sudo mkfs.ext4 {{FILE}}', 'ВСЕ ДАННЫЕ НА ДИСКЕ БУДУТ УНИЧТОЖЕНЫ. Проверьте имя устройства.'], ['Каталог', 'sudo mkdir -p {{DIRECTORY}}'], ['Монтирование', 'sudo mount {{FILE}} {{DIRECTORY}}'], ['UUID для fstab', 'sudo blkid {{FILE}}']]),
  L('swap-add', 'Добавить swap 2 ГБ', 'Создать, включить и проверить файл подкачки.', [['Сейчас', 'free -h'], ['Создать и включить', 'sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile'], ['При загрузке', "grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"], ['Проверить', 'free -h']]),
  L('hostname', 'Сменить имя сервера', 'hostnamectl и /etc/hosts. Укажите новое имя.', [['Сейчас', 'hostnamectl'], ['Новое имя', 'sudo hostnamectl set-hostname {{DEVICE}}'], ['Проверить hosts', 'grep -n "127.0.1.1" /etc/hosts', 'Замените старое имя в /etc/hosts (sudo nano /etc/hosts).']]),
  L('timezone', 'Установить московское время', 'Часовой пояс и синхронизация.', [['Сейчас', 'timedatectl'], ['Пояс', 'sudo timedatectl set-timezone Europe/Moscow'], ['NTP', 'sudo timedatectl set-ntp true'], ['Проверить', 'date']]),
  L('tools', 'Установить полезные утилиты', 'htop, mc, ncdu, curl, wget, dnsutils, net-tools, tcpdump, unzip.', [['Обновить списки', 'sudo apt update'], ['Установить', 'sudo apt install -y htop mc ncdu curl wget dnsutils net-tools tcpdump unzip']]),
  L('zabbix-agent', 'Проверка агента Zabbix', 'Служба, конфигурация, связь с сервером. Только просмотр.', [['Служба', 'systemctl status zabbix-agent2 zabbix-agent --no-pager 2>/dev/null | head -8'], ['Серверы в конфиге', 'grep -E "^(Server|ServerActive|Hostname)=" /etc/zabbix/zabbix_agent*.conf'], ['Порт 10050', 'sudo ss -tlnp | grep 10050'], ['Журнал', 'sudo tail -n 20 /var/log/zabbix/zabbix_agent*.log']]),
  L('samba-check', 'Проверка Samba', 'Конфигурация, служба, подключения. Только просмотр.', [['Конфигурация', 'testparm -s 2>/dev/null | head -40'], ['Служба', 'systemctl status smbd --no-pager | head -5'], ['Подключения', 'sudo smbstatus']]),
  L('ssh-key-setup', 'Подготовить вход по ключу для пользователя', 'Каталог .ssh с правильными правами. Сам ключ добавьте в authorized_keys.', [['Каталог', 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'], ['Файл ключей', 'touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'], ['Проверить', 'ls -la ~/.ssh']]),
  L('kernel-errors', 'Ошибки ядра и оборудования', 'Сообщения ядра уровня ошибок и предупреждений. Только просмотр.', [['Ошибки', 'sudo dmesg -T --level=err,crit,alert,emerg | tail -30'], ['Предупреждения', 'sudo dmesg -T --level=warn | tail -30'], ['Температура', 'sensors 2>/dev/null']]),
  L('cron-review', 'Что выполняется по расписанию', 'cron пользователя и системы, таймеры systemd. Только просмотр.', [['Мой crontab', 'crontab -l'], ['crontab root', 'sudo crontab -l'], ['Системные задания', 'ls /etc/cron.d /etc/cron.daily'], ['Таймеры systemd', 'systemctl list-timers --no-pager']]),
  L('proxmox', 'Обзор узла Proxmox', 'ВМ, контейнеры, хранилища. Только просмотр.', [['Виртуальные машины', 'sudo qm list'], ['Контейнеры', 'sudo pct list'], ['Хранилища', 'sudo pvesm status'], ['Версия', 'pveversion']])
];

function SW(id: string, p: string, name: string, description: string, steps: [string, string, string?][]): ScenarioInput {
  return { uid: `builtin:scenario:lib:${id}`, name, description, platforms: [p], steps: steps.map(([t, c, note]) => step(t, c, 'switch', note, undefined, p)), builtin: true, favorite: false };
}

/** OSNOVO: сценарии из команд TXT-заметок (синтаксис настройки OSNOVO отличается от Cisco). */
const OSNOVO_SCENARIOS: ScenarioInput[] = [
  SW('osnovo-port', 'osnovo', 'Порт подробно — OSNOVO (по TXT-заметкам)', 'Информация, статистика и MAC-адреса порта командами из TXT-заметок. Только просмотр.', [['Информация о порте', 'show interface {{INTERFACE}}'], ['Статистика порта', 'show interface statistics {{INTERFACE}}'], ['MAC на порту', 'show bridge fdb interface {{INTERFACE}}']]),
  SW('osnovo-overview', 'osnovo', 'Обзор коммутатора — OSNOVO', 'Модель, MAC и серийный номер, сводка по портам. Только просмотр.', [['Модель и версия', 'show version'], ['MAC и серийный номер', 'show switch'], ['Сводка по портам', 'show interface brief L2']]),
  SW('osnovo-vlan-mac', 'osnovo', 'Кто есть во VLAN — OSNOVO', 'MAC-адреса устройств в VLAN. Только просмотр.', [['MAC в VLAN', 'show bridge fdb vlan {{VLAN}}']]),
  SW('osnovo-sntp', 'osnovo', 'Синхронизация времени — OSNOVO (по TXT-заметкам)', 'SNTP-сервер, часовой пояс +3 и включение SNTP.', [['Настройка SNTP', 'configure terminal\nsntp server {{IP}}\nsntp time-zone +3.00\nsntp enable\nexit']]),
  SW('osnovo-security', 'osnovo', 'Отключить Telnet — OSNOVO (по TXT-заметкам)', 'Оставить доступ только по SSH/веб.', [['Отключить Telnet', 'configure terminal\nsecurity-manage telnet disable\nexit', 'Убедитесь, что вы подключены по SSH, а не по Telnet.']])
];

/**
 * UserGate NGFW 7.x: сценарии по документации CLI. Команды режима диагностики (Admin@узел>) идут
 * отдельными шагами; команды режима конфигурации — в шаге вместе с configure и exit.
 */
const UG = 'usergate';
const UG_REVIEW = ' Синтаксис взят из документации UserGate 7.x и требует проверки на вашей версии.';
const ugConf = (...lines: string[]) => ['configure', ...lines, 'exit'].join('\n');
const USERGATE_SCENARIOS: ScenarioInput[] = [
  SW('ug-overview', UG, 'Обзор межсетевого экрана — UserGate', 'Версия, время, интерфейсы, маршруты и сессии — первое знакомство с устройством. Только просмотр.' + UG_REVIEW, [['Версия ПО', 'show system version'], ['Дата и время', 'date'], ['Интерфейсы', 'show network interface'], ['Маршруты', 'show network route'], ['Активные сессии', 'show system sessions']]),
  SW('ug-host-down', UG, 'Не открывается узел за межсетевым экраном — UserGate', 'По шагам: маршрут до адреса, ARP, ping с UserGate, соединения и блокировка СОВ. Укажите IP-адрес узла. Только просмотр.' + UG_REVIEW, [['Маршрут до адреса', 'show network route ip {{IP}}'], ['ARP-запись (узел в подключённой сети?)', 'show network arp host {{IP}}', 'Нет записи — узел не отвечает на ARP: выключен, другой VLAN или неверная маска.'], ['Ping с UserGate', 'ping hostname {{IP}} count 4', 'Ping может быть запрещён на самом узле — это не всегда значит, что он недоступен.'], ['Соединения к узлу', 'show traffic connections dest-ip {{IP}}', 'UNREPLIED — запрос ушёл, ответа нет; соединений нет — трафик не доходит до UserGate или запрещён правилом.'], ['Не заблокирован ли СОВ', 'show blocked-ip']]),
  SW('ug-no-internet', UG, 'Нет интернета у пользователей — UserGate', 'Шлюз, маршрут по умолчанию, DNS и доступ к внешнему сайту с самого межсетевого экрана. Только просмотр.' + UG_REVIEW, [['Маршрут в интернет', 'show network route ip 8.8.8.8'], ['Ping внешнего адреса', 'ping hostname 8.8.8.8 count 4'], ['DNS на UserGate', 'dig hostname ya.ru'], ['Сайт по HTTPS', 'netcheck address https://ya.ru'], ['Трассировка', 'traceroute hostname 8.8.8.8']]),
  SW('ug-cluster', UG, 'Проверка кластера отказоустойчивости — UserGate', 'Какой узел ведущий, состояние узлов, история переключений. Только просмотр.' + UG_REVIEW, [['Состояние кластера', 'show ha-cluster state'], ['Состояние узлов', 'show ha-cluster tablestat'], ['История переключений', 'show ha-cluster failover']]),
  SW('ug-blocked', UG, 'Компьютер «пропал» — не заблокирован ли он СОВ — UserGate', 'Проверить таблицу блокировок и при необходимости снять блокировку с адреса. Укажите IP-адрес.' + UG_REVIEW, [['Заблокированные адреса', 'show blocked-ip'], ['Соединения от адреса', 'show traffic connections source-ip {{IP}}'], ['Снять блокировку', 'clear blocked-ip ips [ {{IP}} ]', 'Выполняйте, только если адрес есть в таблице и причина блокировки понятна — иначе он заблокируется снова.']]),
  SW('ug-mgmt-access', UG, 'Проверить доступ к управлению (зоны) — UserGate', 'Какие службы разрешены в зонах: веб-консоль, CLI по SSH, SNMP, ping. Только просмотр.' + UG_REVIEW, [['Зоны и службы', ugConf('show network zone')], ['Интерфейсы и их зоны', ugConf('show network interface adapter')]]),
  SW('ug-snmp-check', UG, 'Проверить SNMP для мониторинга — UserGate', 'Правила SNMP (опрос и трапы), параметры агента и разрешение службы SNMP в зонах — для раздела «Мониторинг». Только просмотр.' + UG_REVIEW, [['Правила SNMP', ugConf('show monitoring snmp')], ['Параметры агента', ugConf('show monitoring snmp-parameter')], ['Служба SNMP в зонах', ugConf('show network zone')]]),
  SW('ug-firewall-review', UG, 'Посмотреть правила межсетевого экрана и NAT — UserGate', 'Все правила в порядке применения. Только просмотр.' + UG_REVIEW, [['Правила межсетевого экрана', ugConf('show network-policy firewall all')], ['Правила NAT и маршрутизации', ugConf('show network-policy nat-routing all')]]),
  SW('ug-trace', UG, 'Куда попадает трафик узла (трассировка по правилам) — UserGate', 'Создаёт правило трассировки для адреса, показывает пакеты и удаляет правило. Укажите IP-адрес. Остановить вывод трассировки — Ctrl+C.' + UG_REVIEW, [['Создать правило трассировки', ugConf('create network trace-rules enabled on name "NAD trace" source-ip-addresses [ {{IP}} ]')], ['Смотреть пакеты (Ctrl+C — стоп)', 'show network trace', 'Вывод идёт, пока не нажать Ctrl+C в терминале.'], ['Удалить правило трассировки', ugConf('delete network trace-rules "NAD trace"')]]),
  SW('ug-time', UG, 'Синхронизация времени — UserGate', 'Включить NTP и задать сервер времени. Укажите адрес NTP-сервера.' + UG_REVIEW, [['Время сейчас', 'date'], ['Включить NTP и задать сервер', ugConf('set settings general server-time ntp-enabled on', 'set settings general server-time primary-ntp-server {{HOST}}')], ['Проверить', 'date']])
];

export const LIBRARY_SCENARIOS: ScenarioInput[] = [...buildSwitchScenarios(), ...OSNOVO_SCENARIOS, ...USERGATE_SCENARIOS, ...LINUX_SCENARIOS];
