// Встроенные команды коммутаторов (дополнение к TXT-заметкам).
// Cisco IOS — широко документированный синтаксис. Для остальных платформ добавлены только
// распространённые команды; они помечены «Требует проверки на вашей модели/прошивке».
import type { CommandInput } from '../../src/shared/types';
import { classifyCommand } from '../../src/shared/risk';
import { getPlatform } from '../../src/shared/platforms';

export interface SDef {
  id: string;
  /** Режим CLI, если его нельзя определить по команде. */
  mode?: 'exec' | 'config';
  tags?: string[];
  /** Простая базовая команда — показывается выше в поиске. */
  basic?: boolean;
  /** Уровень риска вручную, если автоматическая оценка не подходит. */
  risk?: import('../../src/shared/types').RiskLevel;
  p: string;
  cat: string;
  title: string;
  cmd: string;
  desc: string;
  ex?: [string, string][];
  warn?: string[];
  tpl?: string;
  out?: string;
  verify?: string;
  /** false — синтаксис не подтверждён для всех моделей платформы. */
  sure?: boolean;
  docs?: string;
}

export function S(d: SDef): CommandInput {
  const p = getPlatform(d.p);
  const sure = d.sure ?? d.p === 'cisco-ios';
  const config = /^(conf|interface|vlan |switchport|spanning-tree|description|shutdown|no shutdown|channel-group|ip |no |username|logging|ntp|clock|snmp|power inline)/i.test(d.cmd);
  return {
    uid: `builtin:switch:${d.p}:${d.id}`,
    kind: 'switch',
    entryType: d.cmd.includes('\n') ? 'sequence' : 'command',
    platform: d.p,
    vendorLabel: p.name,
    category: d.cat,
    title: d.title,
    command: d.cmd,
    description: d.desc,
    details: {
      examples: d.ex?.map(([cmd, desc]) => ({ cmd, desc })),
      warnings: d.warn,
      output: d.out,
      verify: d.verify,
      docs: d.docs
    },
    template: d.tpl ?? null,
    risk: d.risk ?? classifyCommand(d.cmd, 'switch').level,
    riskManual: false,
    mode: d.mode ?? (config ? 'config' : 'exec'),
    source: 'builtin',
    verified: false,
    needsReview: !sure,
    reviewNote: sure ? undefined : 'Встроенная запись: синтаксис может отличаться в зависимости от модели и версии прошивки — проверьте на своём оборудовании.',
    vendorUnknown: false,
    sensitive: false,
    favorite: false,
    userModified: false,
    tags: [...(d.tags ?? []), ...(d.basic ? ['основы'] : [])]
  };
}

const IOS = 'cisco-ios';

export const SWITCH_BUILTIN: CommandInput[] = [
  // ---------- Cisco IOS / IOS XE ----------
  S({ id: 'term-len', p: IOS, cat: 'general', title: 'Отключить постраничный вывод в текущей сессии', cmd: 'terminal length 0', desc: 'Вывод команд без остановки на --More--. Действует до конца сессии.' }),
  S({ id: 'show-ver', p: IOS, cat: 'hardware', title: 'Версия ПО, модель, время работы', cmd: 'show version', desc: 'Версия IOS, модель, серийный номер платформы, uptime, причина последней перезагрузки, регистр конфигурации.' }),
  S({ id: 'show-inv', p: IOS, cat: 'hardware', title: 'Модули, трансиверы и серийные номера', cmd: 'show inventory', desc: 'PID, VID и серийные номера шасси, модулей, блоков питания и SFP.' }),
  S({ id: 'show-env', p: IOS, cat: 'hardware', title: 'Вентиляторы, температура, блоки питания', cmd: 'show environment all', desc: 'Состояние датчиков. На части платформ — show env all или show environment.' }),
  S({ id: 'show-cpu', p: IOS, cat: 'hardware', title: 'Загрузка процессора', cmd: 'show processes cpu sorted', desc: 'Загрузка CPU за 5 секунд, 1 и 5 минут и самые нагружающие процессы.', ex: [['show processes cpu history', 'график загрузки за 60 минут и 72 часа']] }),
  S({ id: 'show-mem', p: IOS, cat: 'hardware', title: 'Использование памяти', cmd: 'show memory statistics', desc: 'Объём и использование памяти процессора и ввода-вывода.' }),
  S({ id: 'show-run', p: IOS, cat: 'general', title: 'Текущая конфигурация', cmd: 'show running-config', desc: 'Действующая конфигурация в оперативной памяти.', ex: [['show running-config | section interface', 'только интерфейсы'], ['show running-config | include hostname|snmp', 'строки по шаблону']] }),
  S({ id: 'show-start', p: IOS, cat: 'general', title: 'Сохранённая конфигурация', cmd: 'show startup-config', desc: 'Конфигурация, которая загрузится после перезагрузки.' }),
  S({ id: 'show-clock', p: IOS, cat: 'ntp', title: 'Время на коммутаторе', cmd: 'show clock detail', desc: 'Текущее время и источник синхронизации.' }),
  S({ id: 'show-ntp', p: IOS, cat: 'ntp', title: 'Состояние синхронизации NTP', cmd: 'show ntp status', desc: 'Синхронизирован ли коммутатор и с каким stratum.', ex: [['show ntp associations', 'серверы NTP и их состояние']] }),
  S({ id: 'int-status', p: IOS, cat: 'port-check', title: 'Состояние всех портов', cmd: 'show interfaces status', desc: 'Статус (connected/notconnect/err-disabled), VLAN, дуплекс, скорость, тип порта.' }),
  S({ id: 'int-errdis', p: IOS, cat: 'port-check', title: 'Порты в состоянии err-disabled', cmd: 'show interfaces status err-disabled', desc: 'Порты, отключённые защитными механизмами, и причина.', ex: [['show errdisable recovery', 'настройки автоматического восстановления']] }),
  S({ id: 'int-detail', p: IOS, cat: 'port-check', title: 'Подробно об интерфейсе', cmd: 'show interfaces GigabitEthernet1/0/1', tpl: 'show interfaces {{INTERFACE}}', desc: 'Состояние линка, скорость, счётчики ввода/вывода, CRC, input errors, collisions, время последнего сброса счётчиков.', out: 'Растущие CRC и input errors обычно указывают на кабель, патч-корд или трансивер; late collisions — на несовпадение дуплекса.' }),
  S({ id: 'int-errors', p: IOS, cat: 'errors', title: 'Ошибки на портах', cmd: 'show interfaces counters errors', desc: 'Align-Err, FCS-Err, Xmit-Err, Rcv-Err, UnderSize, OutDiscards по всем портам.' }),
  S({ id: 'int-run', p: IOS, cat: 'port-check', title: 'Конфигурация порта', cmd: 'show running-config interface GigabitEthernet1/0/1', tpl: 'show running-config interface {{INTERFACE}}', desc: 'Настройки одного интерфейса.' }),
  S({ id: 'int-switchport', p: IOS, cat: 'access-trunk', title: 'Режим порта: access/trunk, VLAN', cmd: 'show interfaces GigabitEthernet1/0/1 switchport', tpl: 'show interfaces {{INTERFACE}} switchport', desc: 'Административный и фактический режим, access VLAN, native VLAN, разрешённые VLAN на trunk.' }),
  S({ id: 'int-trunk', p: IOS, cat: 'access-trunk', title: 'Trunk-порты', cmd: 'show interfaces trunk', desc: 'Trunk-порты, инкапсуляция, native VLAN, разрешённые и активные VLAN.' }),
  S({ id: 'transceiver', p: IOS, cat: 'hardware', title: 'Уровни сигнала SFP (DOM)', cmd: 'show interfaces transceiver detail', desc: 'Температура, напряжение, мощность Tx/Rx оптических модулей с поддержкой DOM.' }),
  S({ id: 'tdr', p: IOS, cat: 'port-check', title: 'Диагностика медного кабеля (TDR)', cmd: 'test cable-diagnostics tdr interface GigabitEthernet1/0/1', tpl: 'test cable-diagnostics tdr interface {{INTERFACE}}', desc: 'Запуск TDR-теста; результат — show cable-diagnostics tdr interface. Поддерживается не на всех моделях.', warn: ['На время теста линк на порту может пропасть.'], sure: false }),
  S({ id: 'vlan-brief', p: IOS, cat: 'vlan', title: 'Список VLAN и порты', cmd: 'show vlan brief', desc: 'VLAN, их имена, состояние и access-порты.' }),
  S({ id: 'mac-addr', p: IOS, cat: 'mac', title: 'Найти устройство по MAC', cmd: 'show mac address-table address 0011.2233.4455', tpl: 'show mac address-table address {{MAC}}', desc: 'VLAN и порт, за которым виден MAC-адрес. Формат MAC — xxxx.xxxx.xxxx.' }),
  S({ id: 'mac-int', p: IOS, cat: 'mac', title: 'MAC-адреса на порту', cmd: 'show mac address-table interface GigabitEthernet1/0/1', tpl: 'show mac address-table interface {{INTERFACE}}', desc: 'Какие MAC-адреса изучены на порту.' }),
  S({ id: 'mac-count', p: IOS, cat: 'mac', title: 'Количество MAC-адресов', cmd: 'show mac address-table count', desc: 'Число записей таблицы MAC по VLAN.' }),
  S({ id: 'mac-clear', p: IOS, cat: 'mac', title: 'Очистить динамические MAC на порту', cmd: 'clear mac address-table dynamic interface GigabitEthernet1/0/1', tpl: 'clear mac address-table dynamic interface {{INTERFACE}}', desc: 'Удаляет изученные адреса на порту — они будут изучены заново.' }),
  S({ id: 'arp-ip', p: IOS, cat: 'arp', title: 'ARP-запись по IP', cmd: 'show ip arp 10.0.0.5', tpl: 'show ip arp {{IP}}', desc: 'MAC-адрес и интерфейс для IP (на коммутаторах L3 и для адресов, известных коммутатору).' }),
  S({ id: 'ip-int-brief', p: IOS, cat: 'ip-interfaces', title: 'IP-интерфейсы', cmd: 'show ip interface brief', desc: 'Интерфейсы с IP-адресами и их состояние (Status/Protocol).' }),
  S({ id: 'ip-route', p: IOS, cat: 'routing', title: 'Таблица маршрутизации', cmd: 'show ip route', desc: 'Маршруты коммутатора L3. show ip route 10.0.0.5 — маршрут к адресу.', ex: [['show ip route 10.0.0.5', 'маршрут к конкретному адресу']] }),
  S({ id: 'cdp-detail', p: IOS, cat: 'cdp', title: 'Соседи CDP подробно', cmd: 'show cdp neighbors detail', desc: 'Имя, IP-адрес управления, платформа, локальный и удалённый порт соседних устройств Cisco.' }),
  S({ id: 'lldp-nei', p: IOS, cat: 'lldp', title: 'Соседи LLDP', cmd: 'show lldp neighbors detail', desc: 'Соседи по LLDP (работает с оборудованием разных производителей). LLDP включается командой lldp run.', ex: [['show lldp neighbors', 'кратко']] }),
  S({ id: 'stp', p: IOS, cat: 'stp', title: 'Spanning Tree', cmd: 'show spanning-tree', desc: 'Корневой мост, роли и состояния портов по VLAN.', ex: [['show spanning-tree vlan 10', 'для одного VLAN'], ['show spanning-tree summary', 'сводка и режим STP'], ['show spanning-tree detail | include ieee|occur|from|is exec', 'где и когда менялась топология']] }),
  S({ id: 'etherchannel', p: IOS, cat: 'etherchannel', title: 'Агрегированные каналы (EtherChannel)', cmd: 'show etherchannel summary', desc: 'Port-channel и их участники. Флаги: P — в канале, s — приостановлен, D — down.' }),
  S({ id: 'lacp', p: IOS, cat: 'lacp', title: 'Соседи LACP', cmd: 'show lacp neighbor', desc: 'Партнёры LACP на портах агрегата.' }),
  S({ id: 'poe', p: IOS, cat: 'poe', title: 'PoE по портам', cmd: 'show power inline', desc: 'Бюджет PoE и потребление по портам, класс устройства.', ex: [['show power inline GigabitEthernet1/0/5 detail', 'подробно по порту']] }),
  S({ id: 'logging', p: IOS, cat: 'logs', title: 'Журнал коммутатора', cmd: 'show logging', desc: 'Буфер журнала и настройки логирования.', ex: [['show logging | include GigabitEthernet1/0/5', 'события порта']] }),
  S({ id: 'users', p: IOS, cat: 'security', title: 'Кто подключён к коммутатору', cmd: 'show users', desc: 'Активные сессии (консоль, VTY).' }),
  S({ id: 'ssh-show', p: IOS, cat: 'security', title: 'SSH-сессии и версия', cmd: 'show ip ssh', desc: 'Версия SSH, тайм-ауты, используемые алгоритмы.' }),
  S({ id: 'port-sec', p: IOS, cat: 'security', title: 'Port Security', cmd: 'show port-security', desc: 'Порты с Port Security, число адресов, нарушения.' }),
  S({ id: 'ping', p: IOS, cat: 'general', title: 'Ping с коммутатора', cmd: 'ping 10.0.0.5', tpl: 'ping {{IP}}', desc: 'Проверка доступности из коммутатора (с L3 можно указать source).' }),
  S({ id: 'traceroute', p: IOS, cat: 'routing', title: 'Трассировка с коммутатора', cmd: 'traceroute 10.0.0.5', tpl: 'traceroute {{IP}}', desc: 'Путь до узла.' }),
  S({ id: 'conf-t', p: IOS, cat: 'general', title: 'Режим конфигурации', cmd: 'configure terminal', desc: 'Вход в глобальный режим конфигурации. Выход — end.' }),
  S({ id: 'access-port', p: IOS, cat: 'access-trunk', title: 'Настроить access-порт', cmd: 'configure terminal\ninterface GigabitEthernet1/0/5\ndescription PC-USER\nswitchport mode access\nswitchport access vlan 10\nspanning-tree portfast\nend', tpl: 'configure terminal\ninterface {{INTERFACE}}\ndescription {{VALUE}}\nswitchport mode access\nswitchport access vlan {{VLAN}}\nspanning-tree portfast\nend', desc: 'Типовая настройка порта доступа для конечного устройства.', verify: 'show running-config interface {{INTERFACE}}' }),
  S({ id: 'trunk-add', p: IOS, cat: 'access-trunk', title: 'Добавить VLAN на trunk', cmd: 'configure terminal\ninterface GigabitEthernet1/0/48\nswitchport trunk allowed vlan add 108\nend', tpl: 'configure terminal\ninterface {{INTERFACE}}\nswitchport trunk allowed vlan add {{VLAN}}\nend', desc: 'Добавляет VLAN в список разрешённых, не трогая остальные.', warn: ['Без слова add команда заменит весь список VLAN на trunk.'], verify: 'show interfaces trunk' }),
  S({ id: 'shut', p: IOS, cat: 'port-config', title: 'Отключить / включить порт', cmd: 'configure terminal\ninterface GigabitEthernet1/0/5\nshutdown\nend', tpl: 'configure terminal\ninterface {{INTERFACE}}\nshutdown\nend', desc: 'Административно отключает порт. Включение — no shutdown.', warn: ['Не отключайте порт, через который вы подключены к коммутатору (uplink).'] }),
  S({ id: 'bounce', p: IOS, cat: 'port-config', title: 'Перезапуск порта (shutdown / no shutdown)', cmd: 'configure terminal\ninterface GigabitEthernet1/0/5\nshutdown\nno shutdown\nend', tpl: 'configure terminal\ninterface {{INTERFACE}}\nshutdown\nno shutdown\nend', desc: 'Кратковременно отключает и включает порт (например, чтобы перезапустить PoE-устройство или вывести порт из err-disabled).' }),
  S({ id: 'desc', p: IOS, cat: 'port-config', title: 'Описание порта', cmd: 'configure terminal\ninterface GigabitEthernet1/0/5\ndescription CAM-ENTRANCE-01\nend', tpl: 'configure terminal\ninterface {{INTERFACE}}\ndescription {{VALUE}}\nend', desc: 'Подпись порта — видна в show interfaces status и description.' }),
  S({ id: 'wr', p: IOS, cat: 'backup', title: 'Сохранить конфигурацию', cmd: 'copy running-config startup-config', desc: 'Сохраняет текущую конфигурацию, чтобы она применилась после перезагрузки. Аналог — write memory.' }),
  S({ id: 'copy-tftp', p: IOS, cat: 'backup', title: 'Выгрузить конфигурацию на TFTP', cmd: 'copy running-config tftp://192.168.1.100/sw-config.cfg', tpl: 'copy running-config tftp://{{IP}}/{{FILE}}', desc: 'Копирует конфигурацию на TFTP-сервер (коммутатор запросит подтверждение имени).' }),
  S({ id: 'reload-in', p: IOS, cat: 'reboot', title: 'Отложенная перезагрузка (страховка при изменениях)', cmd: 'reload in 10', tpl: 'reload in {{MINUTES}}', desc: 'Перезагрузит коммутатор через N минут — если изменения отрежут доступ, коммутатор вернётся к сохранённой конфигурации. Отмена — reload cancel.', warn: ['Не сохраняйте конфигурацию (write) до проверки изменений, иначе перезагрузка не откатит их.'] }),
  S({ id: 'clear-cnt', p: IOS, cat: 'counters', title: 'Сбросить счётчики порта', cmd: 'clear counters GigabitEthernet1/0/5', tpl: 'clear counters {{INTERFACE}}', desc: 'Обнуляет счётчики, чтобы увидеть, растут ли ошибки прямо сейчас.' }),

  // ---------- Cisco SG300 ----------
  S({ id: 'datadump', p: 'cisco-sg300', cat: 'general', title: 'Отключить постраничный вывод', cmd: 'terminal datadump', desc: 'Вывод без пауз в текущей сессии (Cisco Small Business).' }),
  S({ id: 'sg-int-status', p: 'cisco-sg300', cat: 'port-check', title: 'Состояние портов', cmd: 'show interfaces status', desc: 'Тип, дуплекс, скорость, состояние линка портов.' }),
  S({ id: 'sg-counters', p: 'cisco-sg300', cat: 'counters', title: 'Счётчики портов', cmd: 'show interfaces counters', desc: 'Счётчики пакетов и ошибок; для порта: show interfaces counters gi1/1/5.' }),
  S({ id: 'sg-switchport', p: 'cisco-sg300', cat: 'access-trunk', title: 'VLAN на порту', cmd: 'show interfaces switchport gi1/1/5', tpl: 'show interfaces switchport {{INTERFACE}}', desc: 'Режим порта и членство в VLAN.' }),
  S({ id: 'sg-vlan', p: 'cisco-sg300', cat: 'vlan', title: 'Список VLAN', cmd: 'show vlan', desc: 'VLAN и порты-участники (tagged/untagged).' }),
  S({ id: 'sg-mac', p: 'cisco-sg300', cat: 'mac', title: 'Таблица MAC-адресов', cmd: 'show mac address-table', desc: 'Изученные MAC-адреса, VLAN и порты.', ex: [['show mac address-table interface gi1/1/5', 'на порту']] }),
  S({ id: 'sg-lldp', p: 'cisco-sg300', cat: 'lldp', title: 'Соседи LLDP', cmd: 'show lldp neighbors', desc: 'Соседние устройства по LLDP.' }),
  S({ id: 'sg-poe', p: 'cisco-sg300', cat: 'poe', title: 'PoE', cmd: 'show power inline', desc: 'Бюджет и потребление PoE по портам (для PoE-моделей).' }),
  S({ id: 'sg-log', p: 'cisco-sg300', cat: 'logs', title: 'Журнал', cmd: 'show logging', desc: 'Журнал событий в оперативной памяти.' }),
  S({ id: 'sg-system', p: 'cisco-sg300', cat: 'hardware', title: 'Сведения о системе', cmd: 'show system', desc: 'Модель, время работы, состояние вентиляторов и температура (на поддерживаемых моделях).' }),
  S({ id: 'sg-ver', p: 'cisco-sg300', cat: 'hardware', title: 'Версия прошивки', cmd: 'show version', desc: 'Версия ПО и загрузчика.' }),
  S({ id: 'sg-run', p: 'cisco-sg300', cat: 'general', title: 'Текущая конфигурация', cmd: 'show running-config', desc: 'Действующая конфигурация.' }),
  S({ id: 'sg-save', p: 'cisco-sg300', cat: 'backup', title: 'Сохранить конфигурацию', cmd: 'copy running-config startup-config', desc: 'Сохранить изменения.' }),

  // ---------- HP ProCurve ----------
  S({ id: 'hp-nopage', p: 'hp-procurve', cat: 'general', title: 'Отключить постраничный вывод', cmd: 'no page', desc: 'Вывод без пауз в текущей сессии.' }),
  S({ id: 'hp-system', p: 'hp-procurve', cat: 'hardware', title: 'Сведения о системе', cmd: 'show system', desc: 'Имя, модель, серийный номер, версия ПО, время работы, загрузка CPU и памяти.' }),
  S({ id: 'hp-ver', p: 'hp-procurve', cat: 'hardware', title: 'Версия прошивки', cmd: 'show version', desc: 'Версия ПО и образ загрузки.' }),
  S({ id: 'hp-int', p: 'hp-procurve', cat: 'port-check', title: 'Подробно о порте', cmd: 'show interfaces A1', tpl: 'show interfaces {{INTERFACE}}', desc: 'Состояние, счётчики и ошибки порта.' }),
  S({ id: 'hp-vlans', p: 'hp-procurve', cat: 'vlan', title: 'Список VLAN', cmd: 'show vlans', desc: 'Все VLAN; show vlans <номер> — порты VLAN.' }),
  S({ id: 'hp-vlan-port', p: 'hp-procurve', cat: 'access-trunk', title: 'VLAN на порту', cmd: 'show vlans ports A1 detail', tpl: 'show vlans ports {{INTERFACE}} detail', desc: 'Членство порта в VLAN (tagged/untagged).' }),
  S({ id: 'hp-arp', p: 'hp-procurve', cat: 'arp', title: 'ARP-таблица', cmd: 'show arp', desc: 'ARP-записи коммутатора.' }),
  S({ id: 'hp-lldp', p: 'hp-procurve', cat: 'lldp', title: 'Соседи LLDP', cmd: 'show lldp info remote-device', desc: 'Соседние устройства по портам.', ex: [['show lldp info remote-device A1', 'подробно по порту']] }),
  S({ id: 'hp-trunks', p: 'hp-procurve', cat: 'port-channel', title: 'Агрегированные каналы (trunk)', cmd: 'show trunks', desc: 'Порты в группах Trk и тип агрегации (LACP/Trunk).' }),
  S({ id: 'hp-lacp', p: 'hp-procurve', cat: 'lacp', title: 'LACP', cmd: 'show lacp', desc: 'Состояние LACP по портам.' }),
  S({ id: 'hp-poe', p: 'hp-procurve', cat: 'poe', title: 'PoE', cmd: 'show power-over-ethernet brief', desc: 'Потребление и состояние PoE по портам.' }),
  S({ id: 'hp-stp', p: 'hp-procurve', cat: 'stp', title: 'Spanning Tree', cmd: 'show spanning-tree', desc: 'Корневой мост и состояние портов.' }),
  S({ id: 'hp-log', p: 'hp-procurve', cat: 'logs', title: 'Журнал (новые сверху)', cmd: 'show logging -r', desc: 'Журнал событий в обратном порядке.' }),
  S({ id: 'hp-run', p: 'hp-procurve', cat: 'general', title: 'Текущая конфигурация', cmd: 'show running-config', desc: 'Действующая конфигурация.' }),

  // ---------- Allied Telesis (AlliedWare) ----------
  S({ id: 'aw-system', p: 'alliedware', cat: 'hardware', title: 'Сведения о системе', cmd: 'show system', desc: 'Модель, версия ПО, время работы, состояние питания и вентиляторов.' }),
  S({ id: 'aw-log', p: 'alliedware', cat: 'logs', title: 'Журнал', cmd: 'show log', desc: 'Журнал событий.' }),
  S({ id: 'aw-stp', p: 'alliedware', cat: 'stp', title: 'Spanning Tree', cmd: 'show stp', desc: 'Состояние STP.' }),
  S({ id: 'aw-port-cnt', p: 'alliedware', cat: 'counters', title: 'Счётчики порта', cmd: 'show switch port=1 counter', tpl: 'show switch port={{PORT}} counter', desc: 'Счётчики пакетов и ошибок порта.' }),

  // ---------- TP-Link ----------
  S({ id: 'tp-int', p: 'tplink', cat: 'port-check', title: 'Состояние портов', cmd: 'show interface status', desc: 'Состояние линка, скорость и дуплекс портов.' }),
  S({ id: 'tp-vlan', p: 'tplink', cat: 'vlan', title: 'Список VLAN', cmd: 'show vlan', desc: 'VLAN и порты.' }),
  S({ id: 'tp-mac', p: 'tplink', cat: 'mac', title: 'Таблица MAC-адресов', cmd: 'show mac address-table all', desc: 'Все записи таблицы MAC.' }),
  S({ id: 'tp-run', p: 'tplink', cat: 'general', title: 'Текущая конфигурация', cmd: 'show running-config', desc: 'Действующая конфигурация.' }),
  S({ id: 'tp-save', p: 'tplink', cat: 'backup', title: 'Сохранить конфигурацию', cmd: 'copy running-config startup-config', desc: 'Сохранить изменения.' })
];
