// Простые команды коммутаторов по платформам: вход и режимы CLI, просмотр, VLAN, порты, PoE,
// управление, сохранение. Для всех платформ, кроме Cisco IOS, записи помечаются
// «Требует проверки» — синтаксис зависит от модели и прошивки.
// Команда задаётся шаблоном {{…}}; пример для карточки подставляется автоматически.
import type { CommandInput } from '../../src/shared/types';
import { S, type SDef } from './builtin';
import { getPlatform } from '../../src/shared/platforms';
import { formatMac } from '../../src/shared/mac';

const SAMPLE_IF: Record<string, string> = {
  'cisco-ios': 'GigabitEthernet1/0/5',
  'cisco-sg300': 'gi1/1/5',
  'hp-procurve': '5',
  linksys: 'g5',
  'at-8000s': 'e5',
  alliedware: '5',
  qtech: '1/0/5',
  osnovo: 'ge1/5',
  tplink: '1/0/5'
};

function sample(p: string, tpl: string): string {
  const values: Record<string, string> = {
    INTERFACE: SAMPLE_IF[p] ?? 'Gi1/0/5',
    VLAN: '10',
    VLAN_LIST: '10,20,30',
    MAC: formatMac('001122334455', getPlatform(p).macFormat),
    IP: '192.168.1.10',
    HOST: '192.168.1.1',
    DEVICE: 'SW-FLOOR2',
    VALUE: 'PC-USER',
    USERNAME: 'admin2',
    PASSWORD: 'СЛОЖНЫЙ_ПАРОЛЬ',
    FILE: 'sw-floor2.cfg',
    PORT_CHANNEL: '1'
  };
  return tpl.replace(/\{\{([A-Z_]+)(?::([^}]*))?\}\}/g, (_m, name: string, def?: string) => values[name] ?? def ?? name);
}

type TDef = Omit<SDef, 'p' | 'cmd' | 'tpl' | 'id'> & { id: string; c: string };

/** Набор команд одной платформы. */
function platform(p: string, defs: TDef[]): CommandInput[] {
  return defs.map(({ c, id, ...d }) => {
    const hasParams = /\{\{/.test(c);
    // Вход в режимы и справка ничего не меняют; снятие питания PoE — опасное действие.
    const risk = d.risk ?? (d.cat === 'cli-basics' && id !== 'no' ? 'info' : /poe-(off|cycle)/.test(id) ? 'danger' : undefined);
    return S({ ...d, risk, id: `b-${id}`, p, cmd: hasParams ? sample(p, c) : c, tpl: hasParams ? c : undefined });
  });
}

const IOS_LIKE_HELP =
  'Подсказка: ? после команды показывает возможные продолжения, Tab дополняет слово. Команды можно сокращать, если сокращение однозначно (sh run = show running-config).';

export const SWITCH_BASICS: CommandInput[] = [
  // ======================= Cisco IOS / IOS XE =======================
  ...platform('cisco-ios', [
    { id: 'enable', cat: 'cli-basics', basic: true, title: 'Войти в привилегированный режим (enable)', c: 'enable', mode: 'exec', desc: 'После входа приглашение заканчивается на > (ограниченный режим, можно почти только смотреть). enable переводит в привилегированный режим (#), где доступны все show, сохранение и вход в настройку. Может спросить enable-пароль.' },
    { id: 'modes', cat: 'cli-basics', basic: true, title: 'Режимы CLI и выход из них (exit, end)', c: 'end', mode: 'exec', desc: 'SW> — пользовательский режим; SW# — привилегированный; SW(config)# — глобальная настройка (configure terminal); SW(config-if)# — настройка порта. exit — на уровень выше; end или Ctrl+Z — сразу в SW#; disable — из # в >; exit в SW# — закрыть сеанс.' },
    { id: 'help', cat: 'cli-basics', basic: true, title: 'Подсказка по командам (?)', c: 'show ?', mode: 'exec', desc: IOS_LIKE_HELP },
    { id: 'no', cat: 'cli-basics', basic: true, title: 'Отменить настройку (no …)', c: 'configure terminal\ninterface {{INTERFACE}}\nno description\nend', desc: 'Почти любую настройку отменяют той же командой с no впереди: no shutdown — включить порт, no description — убрать описание, no vlan 10 — удалить VLAN.' },
    { id: 'filter', cat: 'cli-basics', basic: true, title: 'Отфильтровать вывод (| include, | section, | begin)', c: 'show running-config | include hostname', mode: 'exec', desc: '| include текст — только строки с текстом; | exclude — без него; | section interface — блоки целиком; | begin текст — с первой строки с текстом. Регистр важен.' },
    { id: 'int-brief', cat: 'port-check', basic: true, title: 'Краткая таблица портов с IP-адресами', c: 'show ip interface brief', mode: 'exec', desc: 'Все интерфейсы, их IP-адреса и состояние (Status — физический линк, Protocol — канальный уровень). administratively down — порт выключен командой shutdown.' },
    { id: 'int-desc', cat: 'port-check', basic: true, title: 'Описания (подписи) всех портов', c: 'show interfaces description', mode: 'exec', desc: 'Порт, состояние и описание — удобно найти «куда подключена касса или камера».' },
    { id: 'int-range', cat: 'port-config', title: 'Настроить несколько портов сразу (interface range)', c: 'configure terminal\ninterface range GigabitEthernet1/0/1 - 12\nswitchport mode access\nswitchport access vlan {{VLAN}}\nend', desc: 'Одинаковые настройки для диапазона портов. Пробелы вокруг дефиса обязательны. Можно перечислять через запятую: Gi1/0/1 - 4 , Gi1/0/10.' },
    { id: 'default-int', cat: 'port-config', title: 'Сбросить настройки порта к заводским', c: 'configure terminal\ndefault interface {{INTERFACE}}\nend', desc: 'Удаляет все настройки порта (VLAN, описание, режим). Полезно перед настройкой порта «с чистого листа».', warn: ['Порт потеряет VLAN и режим — подключённое устройство может пропасть из сети.'] },
    { id: 'speed', cat: 'port-config', title: 'Скорость и дуплекс порта', c: 'configure terminal\ninterface {{INTERFACE}}\nspeed 100\nduplex full\nend', desc: 'Жёстко задаёт скорость и дуплекс (обычно оставляют auto). Задавать вручную нужно на обеих сторонах кабеля, иначе будут ошибки и низкая скорость. Вернуть авто — speed auto, duplex auto.' },
    { id: 'hostname', cat: 'management', basic: true, title: 'Задать имя коммутатора (hostname)', c: 'configure terminal\nhostname {{DEVICE}}\nend', desc: 'Имя отображается в приглашении и в журналах. Не забудьте сохранить конфигурацию.' },
    { id: 'mgmt-ip', cat: 'management', basic: true, title: 'IP-адрес управления и шлюз', c: 'configure terminal\ninterface vlan {{VLAN}}\nip address {{IP}} 255.255.255.0\nno shutdown\nexit\nip default-gateway {{HOST}}\nend', desc: 'Адрес, по которому к коммутатору подключаются по SSH и веб. VLAN управления должен быть разрешён на аплинке (trunk). ip default-gateway — для коммутаторов без маршрутизации (L2).', warn: ['Неверный адрес или VLAN управления лишат вас удалённого доступа. Используйте reload in 10 как страховку.'] },
    { id: 'user', cat: 'users', basic: true, title: 'Создать локального пользователя', c: 'configure terminal\nusername {{USERNAME}} privilege 15 secret {{PASSWORD}}\nend', desc: 'privilege 15 — полные права; secret хранит пароль в виде хеша. Удалить — no username имя.' },
    { id: 'enable-secret', cat: 'users', title: 'Задать enable-пароль', c: 'configure terminal\nenable secret {{PASSWORD}}\nend', desc: 'Пароль для перехода в привилегированный режим командой enable.' },
    { id: 'ssh-on', cat: 'security', basic: true, title: 'Включить SSH и запретить Telnet', c: 'configure terminal\nip domain-name local.lan\ncrypto key generate rsa modulus 2048\nip ssh version 2\nline vty 0 15\ntransport input ssh\nlogin local\nend', desc: 'Создаёт ключ SSH, включает SSHv2 и разрешает удалённый вход только по SSH с локальными пользователями. Перед этим создайте пользователя (username … secret …).', warn: ['Если вы подключены по Telnet, после transport input ssh новая сессия по Telnet не откроется.'] },
    { id: 'exec-timeout', cat: 'security', title: 'Тайм-аут бездействия сессии', c: 'configure terminal\nline vty 0 15\nexec-timeout 15 0\nend', desc: 'Закрывать неактивные SSH-сессии через 15 минут.' },
    { id: 'pw-encrypt', cat: 'security', title: 'Не показывать пароли открытым текстом в конфигурации', c: 'configure terminal\nservice password-encryption\nend', desc: 'Скрывает пароли типа password в show running-config (слабое шифрование, но защищает от случайного просмотра).' },
    { id: 'banner', cat: 'security', title: 'Предупреждение при входе (баннер)', c: 'configure terminal\nbanner motd # Доступ только для авторизованного персонала #\nend', desc: 'Текст, который показывается при подключении. Символ # — ограничитель текста.' },
    { id: 'vlan-create', cat: 'vlan', basic: true, title: 'Создать VLAN с именем', c: 'configure terminal\nvlan {{VLAN}}\nname {{VALUE}}\nend', desc: 'Создаёт VLAN. Имя без пробелов. Проверка — show vlan brief.', verify: 'show vlan brief' },
    { id: 'vlan-delete', cat: 'vlan', title: 'Удалить VLAN', c: 'configure terminal\nno vlan {{VLAN}}\nend', desc: 'Удаляет VLAN. Порты, которые были в нём в режиме access, перестанут передавать трафик, пока их не переведут в другой VLAN.', warn: ['Устройства в этом VLAN потеряют связь.'] },
    { id: 'vlan-id', cat: 'vlan', basic: true, title: 'Какие порты в VLAN', c: 'show vlan id {{VLAN}}', mode: 'exec', desc: 'Состояние VLAN и его access-порты. Trunk-порты здесь не показываются — смотрите show interfaces trunk.' },
    { id: 'trunk', cat: 'access-trunk', basic: true, title: 'Настроить trunk-порт (аплинк)', c: 'configure terminal\ninterface {{INTERFACE}}\nswitchport mode trunk\nswitchport trunk allowed vlan {{VLAN_LIST}}\nend', desc: 'Trunk передаёт несколько VLAN (с метками 802.1Q) — используется между коммутаторами и к серверам виртуализации. На некоторых моделях сначала нужно switchport trunk encapsulation dot1q.', warn: ['allowed vlan БЕЗ add заменяет весь список разрешённых VLAN. Чтобы добавить VLAN к существующим — switchport trunk allowed vlan add N.'] },
    { id: 'trunk-remove', cat: 'access-trunk', title: 'Убрать VLAN с trunk-порта', c: 'configure terminal\ninterface {{INTERFACE}}\nswitchport trunk allowed vlan remove {{VLAN}}\nend', desc: 'Удаляет VLAN из списка разрешённых на trunk, остальные остаются.' },
    { id: 'native', cat: 'access-trunk', title: 'Native VLAN (нетегированный) на trunk', c: 'configure terminal\ninterface {{INTERFACE}}\nswitchport trunk native vlan {{VLAN}}\nend', desc: 'Трафик этого VLAN передаётся по trunk без метки. Native VLAN должен совпадать на обоих концах линка, иначе CDP предупредит о native VLAN mismatch.' },
    { id: 'access-vlan-remove', cat: 'access-trunk', title: 'Вернуть порт в VLAN 1 (убрать access VLAN)', c: 'configure terminal\ninterface {{INTERFACE}}\nno switchport access vlan\nend', desc: 'Порт вернётся в VLAN по умолчанию (1).' },
    { id: 'bpduguard', cat: 'stp', title: 'Защита от петель на пользовательских портах (BPDU Guard)', c: 'configure terminal\ninterface {{INTERFACE}}\nspanning-tree portfast\nspanning-tree bpduguard enable\nend', desc: 'Если в порт включат коммутатор или сделают петлю, порт уйдёт в err-disabled вместо того, чтобы положить сеть.' },
    { id: 'errdisable', cat: 'errors', title: 'Автоматически поднимать порты после err-disabled', c: 'configure terminal\nerrdisable recovery cause all\nerrdisable recovery interval 300\nend', desc: 'Порт, отключённый защитой (bpduguard, port-security и т. п.), будет включён через 5 минут. Причины отключений — show errdisable recovery.' },
    { id: 'port-security', cat: 'security', title: 'Ограничить число MAC-адресов на порту', c: 'configure terminal\ninterface {{INTERFACE}}\nswitchport mode access\nswitchport port-security\nswitchport port-security maximum 2\nswitchport port-security violation restrict\nend', desc: 'Не больше двух устройств на порту (например, телефон и ПК). restrict — лишние кадры отбрасываются, порт работает; shutdown — порт отключается.' },
    { id: 'storm', cat: 'security', title: 'Ограничение широковещательного шторма', c: 'configure terminal\ninterface {{INTERFACE}}\nstorm-control broadcast level 5.00\nend', desc: 'Если широковещательный трафик превысит 5% полосы порта, лишнее будет отброшено.' },
    { id: 'poe-cycle', cat: 'poe', basic: true, title: 'Перезагрузить PoE-устройство (камеру, точку, телефон)', c: 'configure terminal\ninterface {{INTERFACE}}\npower inline never\nend', desc: 'Снимает питание с порта. Подождите 10–15 секунд и включите снова: configure terminal → interface … → power inline auto → end. Так перезагружают зависшую камеру удалённо.', warn: ['Устройство на порту выключится.'] },
    { id: 'poe-on', cat: 'poe', basic: true, title: 'Включить PoE на порту', c: 'configure terminal\ninterface {{INTERFACE}}\npower inline auto\nend', desc: 'Возвращает автоматическую подачу питания на порт.' },
    { id: 'ntp-set', cat: 'ntp', basic: true, title: 'Часовой пояс и сервер времени', c: 'configure terminal\nclock timezone MSK 3 0\nntp server {{IP}}\nend', desc: 'Правильное время нужно для журналов. Проверка — show clock detail и show ntp status.' },
    { id: 'syslog', cat: 'logs', title: 'Отправлять журнал на syslog-сервер', c: 'configure terminal\nlogging host {{IP}}\nlogging trap informational\nend', desc: 'Журнал будет храниться на сервере и не потеряется при перезагрузке коммутатора.' },
    { id: 'term-mon', cat: 'logs', basic: true, title: 'Показывать сообщения журнала в SSH-сессии', c: 'terminal monitor', mode: 'exec', desc: 'По SSH сообщения (порт поднялся/упал) по умолчанию не видны. terminal monitor включает их до конца сессии; выключить — terminal no monitor.' },
    { id: 'clear-log', cat: 'logs', title: 'Очистить журнал', c: 'clear logging', mode: 'exec', desc: 'Очищает буфер журнала коммутатора (спросит подтверждение).' },
    { id: 'cdp-brief', cat: 'cdp', basic: true, title: 'Соседние устройства Cisco (кратко)', c: 'show cdp neighbors', mode: 'exec', desc: 'Какие устройства Cisco подключены и в какие порты (Local Intrfce — ваш порт, Port ID — порт соседа).' },
    { id: 'lldp-run', cat: 'lldp', title: 'Включить LLDP', c: 'configure terminal\nlldp run\nend', desc: 'LLDP — стандартный протокол обнаружения соседей (в отличие от CDP понимают все производители).' },
    { id: 'flash', cat: 'firmware', title: 'Файлы во флеш-памяти (прошивки, конфигурации)', c: 'dir flash:', mode: 'exec', desc: 'Список файлов и свободное место во флеш-памяти.' },
    { id: 'copy-fw', cat: 'firmware', title: 'Скопировать прошивку с TFTP-сервера', c: 'copy tftp://{{IP}}/{{FILE}} flash:', mode: 'exec', desc: 'Загружает файл прошивки во флеш. Затем: boot system flash:имя_файла, сохранить конфигурацию, перезагрузить.', warn: ['Проверьте, что прошивка подходит к модели и хватает места во флеш-памяти.'] },
    { id: 'restore-cfg', cat: 'backup', title: 'Загрузить конфигурацию с TFTP', c: 'copy tftp://{{IP}}/{{FILE}} running-config', mode: 'exec', desc: 'Объединяет файл с текущей конфигурацией (команды из файла применяются поверх). Для полной замены используют configure replace (на поддерживаемых платформах).', warn: ['Команды из файла сразу применяются к работающему коммутатору.'] },
    { id: 'reload', cat: 'reboot', basic: true, title: 'Перезагрузить коммутатор', c: 'reload', mode: 'exec', desc: 'Перезагрузка. Если есть несохранённые изменения, коммутатор спросит, сохранить ли их. Сеть через коммутатор пропадёт на 2–10 минут.', warn: ['Все устройства, подключённые к коммутатору, потеряют связь до окончания загрузки.'] },
    { id: 'factory', cat: 'reboot', title: 'Сброс к заводским настройкам', c: 'write erase\nreload', mode: 'exec', desc: 'Стирает сохранённую конфигурацию и перезагружает. После загрузки коммутатор будет без настроек (без IP, пользователей и VLAN).', warn: ['Полная потеря настроек и удалённого доступа. Сначала сохраните резервную копию конфигурации.'] },
    { id: 'ip-routing', cat: 'routing', title: 'Включить маршрутизацию между VLAN (L3)', c: 'configure terminal\nip routing\nend', desc: 'На L3-коммутаторе включает маршрутизацию между интерфейсами VLAN (SVI).' },
    { id: 'static-route', cat: 'routing', title: 'Маршрут по умолчанию (L3)', c: 'configure terminal\nip route 0.0.0.0 0.0.0.0 {{IP}}\nend', desc: 'Весь трафик в неизвестные сети отправлять на указанный маршрутизатор.' }
  ]),

  // ======================= Cisco SG300 / Small Business =======================
  ...platform('cisco-sg300', [
    { id: 'modes', cat: 'cli-basics', basic: true, title: 'Режимы CLI и выход (configure, exit, end)', c: 'configure', mode: 'exec', desc: 'После входа обычно сразу привилегированный режим (#). configure (или configure terminal) — режим настройки; interface … — настройка порта; exit — на уровень выше; end — в #. ' + IOS_LIKE_HELP },
    { id: 'int-status', cat: 'port-check', basic: true, title: 'Состояние одного порта', c: 'show interfaces status {{INTERFACE}}', mode: 'exec', desc: 'Линк (Up/Down), скорость, дуплекс порта.' },
    { id: 'int-cfg', cat: 'port-check', basic: true, title: 'Конфигурация порта', c: 'show running-config interface {{INTERFACE}}', mode: 'exec', desc: 'Настройки порта: режим, VLAN, описание.' },
    { id: 'mac-find', cat: 'mac', basic: true, title: 'Найти устройство по MAC', c: 'show mac address-table address {{MAC}}', mode: 'exec', desc: 'VLAN и порт, за которым виден MAC-адрес.' },
    { id: 'mac-port', cat: 'mac', basic: true, title: 'MAC-адреса на порту', c: 'show mac address-table interface {{INTERFACE}}', mode: 'exec', desc: 'Какие устройства видны за портом.' },
    { id: 'arp', cat: 'arp', title: 'ARP-таблица', c: 'show arp', mode: 'exec', desc: 'Соответствие IP и MAC, известное коммутатору.' },
    { id: 'clock', cat: 'ntp', basic: true, title: 'Время на коммутаторе', c: 'show clock', mode: 'exec', desc: 'Текущее время и источник (SNTP).' },
    { id: 'stp', cat: 'stp', title: 'Spanning Tree', c: 'show spanning-tree', mode: 'exec', desc: 'Корневой мост и роли портов.' },
    { id: 'cpu', cat: 'hardware', title: 'Загрузка процессора', c: 'show cpu utilization', mode: 'exec', desc: 'Загрузка CPU за 5 секунд, минуту и 5 минут.' },
    { id: 'clear-cnt', cat: 'counters', title: 'Сбросить счётчики портов', c: 'clear counters', mode: 'exec', desc: 'Обнуляет счётчики пакетов и ошибок, чтобы увидеть, растут ли ошибки сейчас.' },
    { id: 'hostname', cat: 'management', basic: true, title: 'Задать имя коммутатора', c: 'configure\nhostname {{DEVICE}}\nend', desc: 'Имя в приглашении и журналах.' },
    { id: 'mgmt-ip', cat: 'management', title: 'IP-адрес управления и шлюз', c: 'configure\ninterface vlan {{VLAN}}\nip address {{IP}} 255.255.255.0\nexit\nip default-gateway {{HOST}}\nend', desc: 'Адрес для подключения по SSH и веб.', warn: ['Неверные параметры лишат удалённого доступа.'] },
    { id: 'vlan-create', cat: 'vlan', basic: true, title: 'Создать VLAN с именем', c: 'configure\nvlan database\nvlan {{VLAN}}\nexit\ninterface vlan {{VLAN}}\nname {{VALUE}}\nend', desc: 'VLAN создаётся в vlan database, имя задаётся в interface vlan.' },
    { id: 'vlan-delete', cat: 'vlan', title: 'Удалить VLAN', c: 'configure\nvlan database\nno vlan {{VLAN}}\nend', desc: 'Удаляет VLAN.', warn: ['Устройства в этом VLAN потеряют связь.'] },
    { id: 'access', cat: 'access-trunk', basic: true, title: 'Настроить access-порт', c: 'configure\ninterface {{INTERFACE}}\nswitchport mode access\nswitchport access vlan {{VLAN}}\nend', desc: 'Порт для компьютера, камеры, принтера — один VLAN без меток.' },
    { id: 'trunk-add', cat: 'access-trunk', basic: true, title: 'Добавить VLAN на trunk-порт', c: 'configure\ninterface {{INTERFACE}}\nswitchport mode trunk\nswitchport trunk allowed vlan add {{VLAN}}\nend', desc: 'Добавляет VLAN к разрешённым на trunk (аплинке).' },
    { id: 'trunk-remove', cat: 'access-trunk', title: 'Убрать VLAN с trunk-порта', c: 'configure\ninterface {{INTERFACE}}\nswitchport trunk allowed vlan remove {{VLAN}}\nend', desc: 'Удаляет VLAN из разрешённых на trunk.' },
    { id: 'desc', cat: 'port-config', basic: true, title: 'Описание (подпись) порта', c: 'configure\ninterface {{INTERFACE}}\ndescription {{VALUE}}\nend', desc: 'Подпись видна в конфигурации и show interfaces description.' },
    { id: 'shut', cat: 'port-config', basic: true, title: 'Выключить / включить порт', c: 'configure\ninterface {{INTERFACE}}\nshutdown\nend', desc: 'Выключает порт. Включить — no shutdown в том же режиме.', warn: ['Устройство на порту потеряет связь.'] },
    { id: 'poe-off', cat: 'poe', basic: true, title: 'Выключить PoE на порту (перезагрузить камеру)', c: 'configure\ninterface {{INTERFACE}}\npower inline never\nend', desc: 'Снимает питание. Вернуть — power inline auto.', warn: ['Устройство на порту выключится.'] },
    { id: 'poe-on', cat: 'poe', basic: true, title: 'Включить PoE на порту', c: 'configure\ninterface {{INTERFACE}}\npower inline auto\nend', desc: 'Автоматическая подача питания.' },
    { id: 'user', cat: 'users', title: 'Создать пользователя', c: 'configure\nusername {{USERNAME}} privilege 15 password {{PASSWORD}}\nend', desc: 'Пользователь с полными правами.' },
    { id: 'ssh', cat: 'security', title: 'Включить SSH-сервер', c: 'configure\nip ssh server\nend', desc: 'Включает вход по SSH (ключ генерируется автоматически на большинстве прошивок).' },
    { id: 'tftp', cat: 'backup', basic: true, title: 'Выгрузить конфигурацию на TFTP', c: 'copy running-config tftp://{{IP}}/{{FILE}}', mode: 'exec', desc: 'Резервная копия текущей конфигурации на TFTP-сервер.' },
    { id: 'ping', cat: 'other', basic: true, title: 'Ping с коммутатора', c: 'ping {{IP}}', mode: 'exec', desc: 'Проверка доступности узла из сети коммутатора.' },
    { id: 'reload', cat: 'reboot', basic: true, title: 'Перезагрузить коммутатор', c: 'reload', mode: 'exec', desc: 'Перезагрузка. Перед ней сохраните конфигурацию.', warn: ['Связь через коммутатор пропадёт на время загрузки.'] }
  ]),

  // ======================= HP ProCurve / Aruba =======================
  ...platform('hp-procurve', [
    { id: 'modes', cat: 'cli-basics', basic: true, title: 'Режимы CLI и выход (configure, exit)', c: 'configure', mode: 'exec', desc: 'Приглашение HP> — оператор, HP# — менеджер (enable), HP(config)# — настройка (configure или conf t). exit — на уровень выше. Подсказка — ?; Tab дополняет.' },
    { id: 'int-brief', cat: 'port-check', basic: true, title: 'Состояние всех портов', c: 'show interfaces brief', mode: 'exec', desc: 'Порт, тип, включён ли, линк (Status Up/Down), скорость и дуплекс.' },
    { id: 'int-cnt', cat: 'errors', basic: true, title: 'Ошибки и счётчики порта', c: 'show interfaces {{INTERFACE}}', mode: 'exec', desc: 'Счётчики байт и пакетов, ошибки (FCS, Drops, Collisions).' },
    { id: 'clear-cnt', cat: 'counters', title: 'Сбросить счётчики порта', c: 'clear statistics {{INTERFACE}}', mode: 'exec', desc: 'Обнуляет счётчики, чтобы проверить, растут ли ошибки.' },
    { id: 'mac-find', cat: 'mac', basic: true, title: 'Найти устройство по MAC', c: 'show mac-address {{MAC}}', mode: 'exec', desc: 'Порт и VLAN, где виден MAC (формат xxxxxx-xxxxxx).' },
    { id: 'mac-port', cat: 'mac', basic: true, title: 'MAC-адреса на порту', c: 'show mac-address {{INTERFACE}}', mode: 'exec', desc: 'Какие устройства видны за портом.' },
    { id: 'vlan-create', cat: 'vlan', basic: true, title: 'Создать VLAN с именем', c: 'configure\nvlan {{VLAN}} name "{{VALUE}}"\nexit', desc: 'Создаёт VLAN и задаёт имя.' },
    { id: 'vlan-delete', cat: 'vlan', title: 'Удалить VLAN', c: 'configure\nno vlan {{VLAN}}\nexit', desc: 'Удаляет VLAN.', warn: ['Устройства в этом VLAN потеряют связь.'] },
    { id: 'untagged', cat: 'access-trunk', basic: true, title: 'Порт в VLAN без метки (access)', c: 'configure\nvlan {{VLAN}} untagged {{INTERFACE}}\nexit', desc: 'Делает порт нетегированным членом VLAN — для компьютера, камеры, принтера. Порт автоматически удаляется из прежнего untagged VLAN.' },
    { id: 'tagged', cat: 'access-trunk', basic: true, title: 'Добавить VLAN на порт с меткой (trunk)', c: 'configure\nvlan {{VLAN}} tagged {{INTERFACE}}\nexit', desc: 'Порт передаёт VLAN с меткой 802.1Q — для аплинков между коммутаторами. Для агрегированного канала указывают trk1, trk2…' },
    { id: 'untag-remove', cat: 'access-trunk', title: 'Убрать VLAN с порта', c: 'configure\nno vlan {{VLAN}} tagged {{INTERFACE}}\nexit', desc: 'Удаляет tagged-членство VLAN на порту.' },
    { id: 'name', cat: 'port-config', basic: true, title: 'Описание (подпись) порта', c: 'configure\ninterface {{INTERFACE}} name "{{VALUE}}"\nexit', desc: 'Подпись порта видна в show interfaces brief и конфигурации.' },
    { id: 'disable', cat: 'port-config', basic: true, title: 'Выключить порт', c: 'configure\ninterface {{INTERFACE}} disable\nexit', desc: 'Выключает порт. Включить — interface N enable.', warn: ['Устройство на порту потеряет связь.'] },
    { id: 'enable', cat: 'port-config', basic: true, title: 'Включить порт', c: 'configure\ninterface {{INTERFACE}} enable\nexit', desc: 'Включает ранее выключенный порт.' },
    { id: 'poe-off', cat: 'poe', basic: true, title: 'Выключить PoE на порту (перезагрузить устройство)', c: 'configure\nno interface {{INTERFACE}} power-over-ethernet\nexit', desc: 'Снимает питание с порта. Вернуть — interface N power-over-ethernet.', warn: ['Устройство на порту выключится.'] },
    { id: 'poe-on', cat: 'poe', basic: true, title: 'Включить PoE на порту', c: 'configure\ninterface {{INTERFACE}} power-over-ethernet\nexit', desc: 'Возвращает подачу питания.' },
    { id: 'save', cat: 'backup', basic: true, title: 'Сохранить конфигурацию', c: 'write memory', mode: 'exec', desc: 'Записывает текущую конфигурацию, чтобы она сохранилась после перезагрузки.' },
    { id: 'hostname', cat: 'management', basic: true, title: 'Задать имя коммутатора', c: 'configure\nhostname "{{DEVICE}}"\nexit', desc: 'Имя в приглашении.' },
    { id: 'mgmt-ip', cat: 'management', title: 'IP-адрес управления и шлюз', c: 'configure\nvlan {{VLAN}} ip address {{IP}} 255.255.255.0\nip default-gateway {{HOST}}\nexit', desc: 'Адрес коммутатора в VLAN управления.', warn: ['Неверные параметры лишат удалённого доступа.'] },
    { id: 'manager', cat: 'users', title: 'Задать пароль администратора (manager)', c: 'configure\npassword manager user-name {{USERNAME}}\nexit', desc: 'Команда спросит новый пароль дважды.' },
    { id: 'ssh', cat: 'security', title: 'Включить SSH и выключить Telnet', c: 'configure\ncrypto key generate ssh\nip ssh\nno telnet-server\nexit', desc: 'Создаёт ключ и включает SSH; Telnet отключается.' },
    { id: 'sntp', cat: 'ntp', title: 'Синхронизация времени (SNTP) и пояс', c: 'configure\nsntp server priority 1 {{IP}}\ntimesync sntp\nsntp unicast\ntime timezone 180\nexit', desc: 'time timezone задаётся в минутах (180 = UTC+3).' },
    { id: 'time', cat: 'ntp', basic: true, title: 'Время на коммутаторе', c: 'show time', mode: 'exec', desc: 'Текущие дата и время.' },
    { id: 'cpu', cat: 'hardware', title: 'Загрузка процессора', c: 'show cpu', mode: 'exec', desc: 'Средняя загрузка CPU.' },
    { id: 'lacp', cat: 'lacp', title: 'Объединить порты в канал LACP', c: 'configure\ntrunk 23-24 trk1 lacp\nexit', desc: 'Порты 23–24 объединяются в trk1 по LACP. VLAN затем назначаются на trk1. Вторая сторона тоже должна быть настроена на LACP.', warn: ['Неправильная агрегация может создать петлю или разорвать аплинк.'] },
    { id: 'tftp', cat: 'backup', basic: true, title: 'Выгрузить конфигурацию на TFTP', c: 'copy running-config tftp {{IP}} {{FILE}}', mode: 'exec', desc: 'Резервная копия конфигурации.' },
    { id: 'ping', cat: 'other', basic: true, title: 'Ping с коммутатора', c: 'ping {{IP}}', mode: 'exec', desc: 'Проверка доступности узла.' },
    { id: 'reload', cat: 'reboot', basic: true, title: 'Перезагрузить коммутатор', c: 'reload', mode: 'exec', desc: 'Перезагрузка (спросит о сохранении изменений).', warn: ['Связь через коммутатор пропадёт на время загрузки.'] }
  ]),

  // ======================= Linksys (SRW, CLI типа Radlan) =======================
  ...platform('linksys', [
    { id: 'modes', cat: 'cli-basics', basic: true, title: 'Режим настройки и выход', c: 'configure', mode: 'exec', desc: 'configure — режим настройки, interface ethernet g5 — настройка порта, exit — на уровень выше, end — в привилегированный режим. Подсказка — ?.' },
    { id: 'status', cat: 'port-check', basic: true, title: 'Состояние портов', c: 'show interfaces status', mode: 'exec', desc: 'Линк, скорость и дуплекс портов.' },
    { id: 'counters', cat: 'errors', basic: true, title: 'Счётчики и ошибки порта', c: 'show interfaces counters ethernet {{INTERFACE}}', mode: 'exec', desc: 'Пакеты и ошибки порта.' },
    { id: 'vlan', cat: 'vlan', basic: true, title: 'Список VLAN', c: 'show vlan', mode: 'exec', desc: 'VLAN и их порты.' },
    { id: 'mac-find', cat: 'mac', basic: true, title: 'Найти устройство по MAC', c: 'show bridge address-table address {{MAC}}', mode: 'exec', desc: 'Порт и VLAN, где виден MAC.' },
    { id: 'access', cat: 'access-trunk', basic: true, title: 'Настроить access-порт', c: 'configure\ninterface ethernet {{INTERFACE}}\nswitchport mode access\nswitchport access vlan {{VLAN}}\nend', desc: 'Один VLAN без меток — для конечного устройства.' },
    { id: 'trunk-add', cat: 'access-trunk', basic: true, title: 'Добавить VLAN на trunk-порт', c: 'configure\ninterface ethernet {{INTERFACE}}\nswitchport mode trunk\nswitchport trunk allowed vlan add {{VLAN}}\nend', desc: 'Добавляет VLAN к разрешённым на аплинке.' },
    { id: 'desc', cat: 'port-config', basic: true, title: 'Описание порта', c: 'configure\ninterface ethernet {{INTERFACE}}\ndescription {{VALUE}}\nend', desc: 'Подпись порта.' },
    { id: 'shut', cat: 'port-config', basic: true, title: 'Выключить / включить порт', c: 'configure\ninterface ethernet {{INTERFACE}}\nshutdown\nend', desc: 'Выключить порт; включить — no shutdown.', warn: ['Устройство на порту потеряет связь.'] },
    { id: 'save', cat: 'backup', basic: true, title: 'Сохранить конфигурацию', c: 'copy running-config startup-config', mode: 'exec', desc: 'Сохраняет настройки после перезагрузки.' },
    { id: 'run', cat: 'general', basic: true, title: 'Текущая конфигурация', c: 'show running-config', mode: 'exec', desc: 'Действующие настройки.' },
    { id: 'ver', cat: 'hardware', basic: true, title: 'Версия прошивки', c: 'show version', mode: 'exec', desc: 'Версия ПО и загрузчика.' },
    { id: 'log', cat: 'logs', basic: true, title: 'Журнал', c: 'show logging', mode: 'exec', desc: 'Последние события.' },
    { id: 'tftp', cat: 'backup', title: 'Выгрузить конфигурацию на TFTP', c: 'copy running-config tftp://{{IP}}/{{FILE}}', mode: 'exec', desc: 'Резервная копия на TFTP.' },
    { id: 'reload', cat: 'reboot', basic: true, title: 'Перезагрузить коммутатор', c: 'reload', mode: 'exec', desc: 'Перезагрузка.', warn: ['Связь через коммутатор пропадёт на время загрузки.'] }
  ]),

  // ======================= Allied Telesis AT-8000S =======================
  ...platform('at-8000s', [
    { id: 'modes', cat: 'cli-basics', basic: true, title: 'Режим настройки и выход', c: 'configure', mode: 'exec', desc: 'configure — режим настройки, interface ethernet e5 — порт, exit — выше, end — в привилегированный режим. Подсказка — ?.' },
    { id: 'status', cat: 'port-check', basic: true, title: 'Состояние портов', c: 'show interfaces status', mode: 'exec', desc: 'Линк, скорость и дуплекс портов.' },
    { id: 'counters', cat: 'errors', basic: true, title: 'Счётчики и ошибки порта', c: 'show interfaces counters ethernet {{INTERFACE}}', mode: 'exec', desc: 'Пакеты и ошибки порта.' },
    { id: 'vlan', cat: 'vlan', basic: true, title: 'Список VLAN', c: 'show vlan', mode: 'exec', desc: 'VLAN и их порты.' },
    { id: 'access', cat: 'access-trunk', basic: true, title: 'Настроить access-порт', c: 'configure\ninterface ethernet {{INTERFACE}}\nswitchport mode access\nswitchport access vlan {{VLAN}}\nend', desc: 'Один VLAN без меток.' },
    { id: 'trunk-add', cat: 'access-trunk', basic: true, title: 'Добавить VLAN на trunk-порт', c: 'configure\ninterface ethernet {{INTERFACE}}\nswitchport mode trunk\nswitchport trunk allowed vlan add {{VLAN}}\nend', desc: 'Добавляет VLAN на аплинк.' },
    { id: 'vlan-create', cat: 'vlan', basic: true, title: 'Создать VLAN', c: 'configure\nvlan database\nvlan {{VLAN}}\nend', desc: 'Создаёт VLAN.' },
    { id: 'desc', cat: 'port-config', basic: true, title: 'Описание порта', c: 'configure\ninterface ethernet {{INTERFACE}}\ndescription {{VALUE}}\nend', desc: 'Подпись порта.' },
    { id: 'shut', cat: 'port-config', basic: true, title: 'Выключить / включить порт', c: 'configure\ninterface ethernet {{INTERFACE}}\nshutdown\nend', desc: 'Выключить порт; включить — no shutdown.', warn: ['Устройство на порту потеряет связь.'] },
    { id: 'system', cat: 'general', basic: true, title: 'Сведения о системе', c: 'show system', mode: 'exec', desc: 'Модель, MAC, время работы.' },
    { id: 'ver', cat: 'hardware', title: 'Версия прошивки', c: 'show version', mode: 'exec', desc: 'Версия ПО.' },
    { id: 'run', cat: 'general', title: 'Текущая конфигурация', c: 'show running-config', mode: 'exec', desc: 'Действующие настройки.' },
    { id: 'log', cat: 'logs', basic: true, title: 'Журнал', c: 'show logging', mode: 'exec', desc: 'Последние события.' },
    { id: 'tftp', cat: 'backup', title: 'Выгрузить конфигурацию на TFTP', c: 'copy running-config tftp://{{IP}}/{{FILE}}', mode: 'exec', desc: 'Резервная копия.' },
    { id: 'reload', cat: 'reboot', basic: true, title: 'Перезагрузить коммутатор', c: 'reload', mode: 'exec', desc: 'Перезагрузка.', warn: ['Связь через коммутатор пропадёт на время загрузки.'] }
  ]),

  // ======================= Allied Telesis AlliedWare (show switch / create vlan=) =======================
  ...platform('alliedware', [
    { id: 'help', cat: 'cli-basics', basic: true, title: 'Как устроены команды AlliedWare', c: 'help', mode: 'exec', desc: 'Команды вида ДЕЙСТВИЕ ОБЪЕКТ параметр=значение: show switch port=5, add vlan=10 port=5. Настройка применяется сразу, без режима configure. Сохранение — create config=имя.cfg (имя — см. show config). help — справка.' },
    { id: 'switch', cat: 'general', basic: true, title: 'Сводка по коммутатору и портам', c: 'show switch', mode: 'exec', desc: 'Общие сведения о коммутаторе.' },
    { id: 'port', cat: 'port-check', basic: true, title: 'Состояние и настройки порта', c: 'show switch port={{INTERFACE}}', mode: 'exec', desc: 'Линк, скорость, VLAN порта.' },
    { id: 'port-cnt', cat: 'errors', basic: true, title: 'Счётчики и ошибки порта', c: 'show switch port={{INTERFACE}} counter', mode: 'exec', desc: 'Пакеты и ошибки порта.' },
    { id: 'reset-cnt', cat: 'counters', title: 'Сбросить счётчики порта', c: 'reset switch port={{INTERFACE}} counter', mode: 'exec', desc: 'Обнуляет счётчики.' },
    { id: 'fdb-mac', cat: 'mac', basic: true, title: 'Найти устройство по MAC', c: 'show switch fdb address={{MAC}}', mode: 'exec', desc: 'Порт и VLAN по MAC (формат xx-xx-xx-xx-xx-xx).' },
    { id: 'fdb-port', cat: 'mac', basic: true, title: 'MAC-адреса на порту', c: 'show switch fdb port={{INTERFACE}}', mode: 'exec', desc: 'Устройства за портом.' },
    { id: 'vlan-create', cat: 'vlan', basic: true, title: 'Создать VLAN', c: 'create vlan={{VALUE}} vid={{VLAN}}', mode: 'exec', desc: 'Создаёт VLAN с именем и номером.' },
    { id: 'add-untagged', cat: 'access-trunk', basic: true, title: 'Добавить порт в VLAN без метки (access)', c: 'add vlan={{VLAN}} port={{INTERFACE}}', mode: 'exec', desc: 'Порт становится нетегированным членом VLAN. Предварительно уберите его из прежнего untagged VLAN (delete vlan=… port=…).' },
    { id: 'add-tagged', cat: 'access-trunk', basic: true, title: 'Добавить VLAN на порт с меткой (trunk)', c: 'add vlan={{VLAN}} port={{INTERFACE}} frame=tagged', mode: 'exec', desc: 'Порт передаёт VLAN с меткой.' },
    { id: 'delete', cat: 'access-trunk', title: 'Убрать VLAN с порта', c: 'delete vlan={{VLAN}} port={{INTERFACE}}', mode: 'exec', desc: 'Удаляет порт из VLAN.' },
    { id: 'disable', cat: 'port-config', basic: true, title: 'Выключить порт', c: 'disable switch port={{INTERFACE}}', mode: 'exec', desc: 'Выключает порт; включить — enable switch port=N.', warn: ['Устройство на порту потеряет связь.'] },
    { id: 'enable', cat: 'port-config', basic: true, title: 'Включить порт', c: 'enable switch port={{INTERFACE}}', mode: 'exec', desc: 'Включает порт.' },
    { id: 'arp', cat: 'arp', title: 'ARP-таблица', c: 'show ip arp', mode: 'exec', desc: 'IP и MAC известных устройств.' },
    { id: 'save', cat: 'backup', basic: true, title: 'Сохранить конфигурацию', c: 'create config=boot.cfg', mode: 'exec', desc: 'Записывает конфигурацию в файл загрузки. Имя файла смотрите в show config (Boot configuration file).' },
    { id: 'sysname', cat: 'management', title: 'Задать имя коммутатора', c: 'set system name="{{DEVICE}}"', mode: 'exec', desc: 'Имя в приглашении.' },
    { id: 'ping', cat: 'other', basic: true, title: 'Ping с коммутатора', c: 'ping {{IP}}', mode: 'exec', desc: 'Проверка доступности узла.' },
    { id: 'restart', cat: 'reboot', basic: true, title: 'Перезагрузить коммутатор', c: 'restart reboot', mode: 'exec', desc: 'Перезагрузка. Несохранённые изменения пропадут.', warn: ['Связь через коммутатор пропадёт на время загрузки.'] }
  ]),

  // ======================= Qtech =======================
  ...platform('qtech', [
    { id: 'modes', cat: 'cli-basics', basic: true, title: 'Режимы CLI и выход', c: 'config', mode: 'exec', desc: 'enable — привилегированный режим (#), config — режим настройки, interface ethernet 1/0/5 — порт, exit — выше, end — в #. Подсказка — ?.' },
    { id: 'pager', cat: 'general', title: 'Отключить постраничный вывод', c: 'terminal length 0', mode: 'exec', desc: 'Вывод без остановок --More--.' },
    { id: 'port', cat: 'port-check', basic: true, title: 'Подробно о порте', c: 'show interface ethernet {{INTERFACE}}', mode: 'exec', desc: 'Состояние, скорость, счётчики и ошибки порта.' },
    { id: 'vlan', cat: 'vlan', basic: true, title: 'Список VLAN', c: 'show vlan', mode: 'exec', desc: 'VLAN и порты.' },
    { id: 'mac', cat: 'mac', basic: true, title: 'Таблица MAC-адресов', c: 'show mac-address-table', mode: 'exec', desc: 'Все изученные MAC-адреса.' },
    { id: 'mac-find', cat: 'mac', basic: true, title: 'Найти устройство по MAC', c: 'show mac-address-table address {{MAC}}', mode: 'exec', desc: 'Порт и VLAN по MAC.' },
    { id: 'mac-port', cat: 'mac', title: 'MAC-адреса на порту', c: 'show mac-address-table interface ethernet {{INTERFACE}}', mode: 'exec', desc: 'Устройства за портом.' },
    { id: 'vlan-create', cat: 'vlan', basic: true, title: 'Создать VLAN', c: 'config\nvlan {{VLAN}}\nname {{VALUE}}\nend', desc: 'Создаёт VLAN с именем.' },
    { id: 'access', cat: 'access-trunk', basic: true, title: 'Настроить access-порт', c: 'config\ninterface ethernet {{INTERFACE}}\nswitchport mode access\nswitchport access vlan {{VLAN}}\nend', desc: 'Один VLAN без меток.' },
    { id: 'trunk', cat: 'access-trunk', basic: true, title: 'Настроить trunk-порт', c: 'config\ninterface ethernet {{INTERFACE}}\nswitchport mode trunk\nswitchport trunk allowed vlan {{VLAN_LIST}}\nend', desc: 'Порт передаёт несколько VLAN с метками.', warn: ['Команда может заменить список разрешённых VLAN — проверьте синтаксис добавления (add) на своей прошивке.'] },
    { id: 'desc', cat: 'port-config', basic: true, title: 'Описание порта', c: 'config\ninterface ethernet {{INTERFACE}}\ndescription {{VALUE}}\nend', desc: 'Подпись порта.' },
    { id: 'shut', cat: 'port-config', basic: true, title: 'Выключить / включить порт', c: 'config\ninterface ethernet {{INTERFACE}}\nshutdown\nend', desc: 'Выключить; включить — no shutdown.', warn: ['Устройство на порту потеряет связь.'] },
    { id: 'save', cat: 'backup', basic: true, title: 'Сохранить конфигурацию', c: 'write', mode: 'exec', desc: 'Сохраняет текущие настройки.' },
    { id: 'run', cat: 'general', basic: true, title: 'Текущая конфигурация', c: 'show running-config', mode: 'exec', desc: 'Действующие настройки.' },
    { id: 'log', cat: 'logs', basic: true, title: 'Журнал', c: 'show logging buffered', mode: 'exec', desc: 'События в памяти коммутатора.' },
    { id: 'lldp', cat: 'lldp', title: 'Соседи LLDP', c: 'show lldp neighbors', mode: 'exec', desc: 'Подключённые соседние устройства.' },
    { id: 'reload', cat: 'reboot', basic: true, title: 'Перезагрузить коммутатор', c: 'reload', mode: 'exec', desc: 'Перезагрузка.', warn: ['Связь через коммутатор пропадёт на время загрузки.'] }
  ]),

  // ======================= OSNOVO =======================
  ...platform('osnovo', [
    { id: 'modes', cat: 'cli-basics', basic: true, title: 'Режим настройки и выход', c: 'configure terminal', mode: 'exec', desc: 'Режим настройки; interface ge1/5 — настройка порта; exit — на уровень выше. Синтаксис OSNOVO отличается от Cisco — уточняйте команды подсказкой ? прямо на коммутаторе.' },
    { id: 'brief', cat: 'port-check', basic: true, title: 'Сводка по всем портам', c: 'show interface brief L2', mode: 'exec', desc: 'Активность и статистика портов (команда из TXT-заметок).' },
    { id: 'port', cat: 'port-check', basic: true, title: 'Информация о порте', c: 'show interface {{INTERFACE}}', mode: 'exec', desc: 'Состояние, скорость, режим порта.' },
    { id: 'stat', cat: 'errors', basic: true, title: 'Статистика и ошибки порта', c: 'show interface statistics {{INTERFACE}}', mode: 'exec', desc: 'Счётчики пакетов и ошибок порта.' },
    { id: 'fdb-port', cat: 'mac', basic: true, title: 'MAC-адреса на порту', c: 'show bridge fdb interface {{INTERFACE}}', mode: 'exec', desc: 'Устройства за портом.' },
    { id: 'fdb-vlan', cat: 'mac', title: 'MAC-адреса в VLAN', c: 'show bridge fdb vlan {{VLAN}}', mode: 'exec', desc: 'Устройства в VLAN.' },
    { id: 'switch', cat: 'general', basic: true, title: 'MAC и серийный номер коммутатора', c: 'show switch', mode: 'exec', desc: 'Сведения об устройстве (из TXT-заметок).' },
    { id: 'ver', cat: 'hardware', basic: true, title: 'Модель и версия', c: 'show version', mode: 'exec', desc: 'Модель коммутатора и версия прошивки.' },
    { id: 'run', cat: 'general', basic: true, title: 'Текущая конфигурация', c: 'show running-config', mode: 'exec', desc: 'Действующие настройки.' },
    { id: 'desc', cat: 'port-config', title: 'Описание порта', c: 'configure terminal\ninterface {{INTERFACE}}\ndescription {{VALUE}}\nexit', desc: 'Подпись порта. Синтаксис не подтверждён для всех прошивок OSNOVO.' },
    { id: 'shut', cat: 'port-config', title: 'Выключить / включить порт', c: 'configure terminal\ninterface {{INTERFACE}}\nshutdown\nexit', desc: 'Выключить порт; включить — no shutdown. Проверьте синтаксис подсказкой ? на своей модели.', warn: ['Устройство на порту потеряет связь.'] },
    { id: 'sntp', cat: 'ntp', title: 'Синхронизация времени', c: 'configure terminal\nsntp server {{IP}}\nsntp time-zone +3.00\nsntp enable\nexit', desc: 'По образцу TXT-заметок: сервер, часовой пояс, включение SNTP.' },
    { id: 'telnet-off', cat: 'security', title: 'Отключить Telnet', c: 'configure terminal\nsecurity-manage telnet disable\nexit', desc: 'Из TXT-заметок: оставить только SSH/веб.' }
  ]),

  // ======================= TP-Link JetStream =======================
  ...platform('tplink', [
    { id: 'modes', cat: 'cli-basics', basic: true, title: 'Режимы CLI и выход', c: 'configure', mode: 'exec', desc: 'enable — привилегированный режим (#); configure — настройка; interface gigabitEthernet 1/0/5 — порт; exit — выше; end — в #. Подсказка — ?.' },
    { id: 'cnt', cat: 'errors', basic: true, title: 'Счётчики и ошибки порта', c: 'show interface counters gigabitEthernet {{INTERFACE}}', mode: 'exec', desc: 'Пакеты и ошибки порта.' },
    { id: 'mac-find', cat: 'mac', basic: true, title: 'Найти устройство по MAC', c: 'show mac address-table address {{MAC}}', mode: 'exec', desc: 'Порт и VLAN по MAC.' },
    { id: 'mac-port', cat: 'mac', basic: true, title: 'MAC-адреса на порту', c: 'show mac address-table interface gigabitEthernet {{INTERFACE}}', mode: 'exec', desc: 'Устройства за портом.' },
    { id: 'vlan-create', cat: 'vlan', basic: true, title: 'Создать VLAN', c: 'configure\nvlan {{VLAN}}\nname {{VALUE}}\nend', desc: 'Создаёт VLAN с именем.' },
    { id: 'access', cat: 'access-trunk', basic: true, title: 'Порт в VLAN без метки (access)', c: 'configure\ninterface gigabitEthernet {{INTERFACE}}\nswitchport general allowed vlan {{VLAN}} untagged\nswitchport pvid {{VLAN}}\nend', desc: 'У TP-Link порт «general»: VLAN разрешается untagged и задаётся PVID. Уберите порт из VLAN 1, если он не нужен: no switchport general allowed vlan 1.' },
    { id: 'tagged', cat: 'access-trunk', basic: true, title: 'Добавить VLAN на порт с меткой (trunk)', c: 'configure\ninterface gigabitEthernet {{INTERFACE}}\nswitchport general allowed vlan {{VLAN}} tagged\nend', desc: 'Порт передаёт VLAN с меткой.' },
    { id: 'remove', cat: 'access-trunk', title: 'Убрать VLAN с порта', c: 'configure\ninterface gigabitEthernet {{INTERFACE}}\nno switchport general allowed vlan {{VLAN}}\nend', desc: 'Удаляет VLAN с порта.' },
    { id: 'desc', cat: 'port-config', basic: true, title: 'Описание порта', c: 'configure\ninterface gigabitEthernet {{INTERFACE}}\ndescription {{VALUE}}\nend', desc: 'Подпись порта.' },
    { id: 'shut', cat: 'port-config', basic: true, title: 'Выключить / включить порт', c: 'configure\ninterface gigabitEthernet {{INTERFACE}}\nshutdown\nend', desc: 'Выключить; включить — no shutdown.', warn: ['Устройство на порту потеряет связь.'] },
    { id: 'sysinfo', cat: 'general', basic: true, title: 'Сведения о системе', c: 'show system-info', mode: 'exec', desc: 'Модель, MAC, версия, время работы.' },
    { id: 'lldp', cat: 'lldp', title: 'Соседи LLDP', c: 'show lldp neighbor-information', mode: 'exec', desc: 'Подключённые соседние устройства.' },
    { id: 'tftp', cat: 'backup', basic: true, title: 'Выгрузить конфигурацию на TFTP', c: 'copy startup-config tftp ip-address {{IP}} filename {{FILE}}', mode: 'exec', desc: 'По образцу TXT-заметок: резервная копия сохранённой конфигурации.' },
    { id: 'ping', cat: 'other', basic: true, title: 'Ping с коммутатора', c: 'ping {{IP}}', mode: 'exec', desc: 'Проверка доступности узла.' },
    { id: 'reboot', cat: 'reboot', basic: true, title: 'Перезагрузить коммутатор', c: 'reboot', mode: 'exec', desc: 'Перезагрузка.', warn: ['Связь через коммутатор пропадёт на время загрузки.'] }
  ])
];
