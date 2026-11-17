// Встроенные сценарии. Команды для коммутаторов взяты из TXT-заметок, где это возможно.
import type { ScenarioInput, ScenarioStep } from '../src/shared/types';
import { classifyCommand } from '../src/shared/risk';

let n = 0;
function step(title: string, command: string, kind: 'switch' | 'linux', note?: string): ScenarioStep {
  n++;
  return { id: `s${n}`, title, command, note, risk: classifyCommand(command, kind).level };
}

function sc(uid: string, name: string, description: string, platforms: string[], steps: ScenarioStep[]): ScenarioInput {
  return { uid: `builtin:scenario:${uid}`, name, description, platforms, steps, builtin: true, favorite: false };
}

const sw = 'switch' as const;
const lx = 'linux' as const;

export const BUILTIN_SCENARIOS: ScenarioInput[] = [
  sc('cisco-port', 'Диагностика порта на Cisco', 'Состояние, ошибки, конфигурация, MAC-адреса и PoE одного порта.', ['cisco-ios'], [
    step('Статус порта', 'show interfaces {{INTERFACE}} status', sw),
    step('Подробности и счётчики', 'show interfaces {{INTERFACE}}', sw),
    step('Ошибки', 'show interfaces {{INTERFACE}} counters errors', sw),
    step('Конфигурация порта', 'show running-config interface {{INTERFACE}}', sw),
    step('MAC-адреса на порту', 'show mac address-table interface {{INTERFACE}}', sw),
    step('PoE на порту', 'show power inline {{INTERFACE}}', sw, 'Пропустите шаг на коммутаторах без PoE.')
  ]),
  sc('osnovo-port', 'Диагностика порта на OSNOVO', 'Команды OSNOVO из TXT-заметок: информация, статистика и MAC-адреса порта.', ['osnovo'], [
    step('Информация о порту', 'show interface {{INTERFACE}}', sw),
    step('Статистика порта', 'show interface statistics {{INTERFACE}}', sw),
    step('MAC-адреса на порту', 'show bridge fdb interface {{INTERFACE}}', sw),
    step('Сводка по портам', 'show interface brief L2', sw)
  ]),
  sc('mac-ios', 'Поиск MAC (IOS-подобный синтаксис)', 'Команды из основного раздела TXT-заметок: порт и VLAN по MAC, затем ARP.', ['unknown-ios', 'cisco-ios'], [
    step('Где виден MAC', 'show mac address-table address {{MAC}}', sw),
    step('IP по MAC (ARP)', 'sh ip arp | in {{MAC}}', sw, 'Работает на коммутаторах L3.')
  ]),
  sc('poe-cisco', 'Проверка PoE (Cisco)', 'Бюджет PoE и состояние порта.', ['cisco-ios', 'unknown-ios'], [
    step('Бюджет PoE', 'show power inline', sw),
    step('Потребление по портам', 'show power inline consumption', sw, 'Команда из TXT-заметок; поддерживается не на всех моделях.'),
    step('PoE на порту', 'show power inline {{INTERFACE}} detail', sw)
  ]),
  sc('vlan-access-cisco', 'Настройка VLAN на access-порту (Cisco)', 'Перевод порта в access-режим с указанным VLAN и проверка результата. Конфигурацию сохраните отдельно после проверки.', ['cisco-ios'], [
    step('Текущая конфигурация порта', 'show running-config interface {{INTERFACE}}', sw),
    step('Проверить, что VLAN существует', 'show vlan id {{VLAN}}', sw),
    step('Настроить порт', 'configure terminal\ninterface {{INTERFACE}}\nswitchport mode access\nswitchport access vlan {{VLAN}}\nend', sw),
    step('Проверить результат', 'show running-config interface {{INTERFACE}}', sw),
    step('Сохранить конфигурацию', 'copy running-config startup-config', sw, 'Выполняйте только после проверки.')
  ]),
  sc('hp-vlan-tagged', 'Добавить VLAN на тегированный порт (HP ProCurve)', 'По командам из TXT-заметок для HP ProCurve.', ['hp-procurve'], [
    step('Информация о VLAN', 'sh vlans {{VLAN}}', sw),
    step('Режим конфигурирования', 'conf t', sw),
    step('Добавить VLAN на порт', 'vlan {{VLAN}} tagged ethernet {{INTERFACE}}', sw),
    step('Проверить', 'sh vlans {{VLAN}}', sw),
    step('Записать конфигурацию', 'write memory', sw)
  ]),
  sc('backup-tftp-ios', 'Резервное копирование коммутатора на TFTP (формат из TXT-заметок)', 'Команда из TXT-заметок: копирование startup-config на TFTP-сервер.', ['unknown-ios', 'cisco-ios'], [
    step('Копировать конфигурацию на TFTP', 'copy startup-config tftp://{{IP}}/{{FILE}}', sw, 'Например: tftp://192.168.1.100/<имя>_<дата>')
  ]),
  sc('alliedware-save', 'Сохранение конфигурации Allied Telesis (AlliedWare)', 'По TXT-заметкам: узнать имя загрузочного файла, сохранить конфигурацию и выгрузить на TFTP.', ['alliedware'], [
    step('Имя загрузочного файла', 'sh config', sw),
    step('Сохранить конфигурацию', 'create config=boot.cfg', sw, 'Используйте имя из предыдущего шага.'),
    step('Выгрузить на TFTP', 'upload file=boot.cfg method=tftp server={{IP}} destfile={{FILE}}', sw)
  ]),
  sc('linux-check', 'Проверка Linux-сервера', 'Быстрый осмотр: система, нагрузка, память, диски, службы, ошибки, порты. Только просмотр.', ['linux'], [
    step('Система', 'hostnamectl', lx),
    step('Время работы и нагрузка', 'uptime', lx),
    step('Память', 'free -h', lx),
    step('Диски', 'df -hT -x tmpfs -x devtmpfs', lx),
    step('Службы с ошибками', 'systemctl --failed', lx),
    step('Ошибки в журнале', 'journalctl -p err -b -n 30 --no-pager', lx),
    step('Открытые порты', 'ss -tuln', lx)
  ]),
  sc('linux-restart', 'Перезапуск службы Linux', 'Проверка состояния, перезапуск и контроль журнала.', ['linux'], [
    step('Состояние до', 'systemctl status {{SERVICE}} --no-pager', lx),
    step('Перезапуск', 'sudo systemctl restart {{SERVICE}}', lx, 'Если служба поддерживает reload — используйте его.'),
    step('Состояние после', 'systemctl status {{SERVICE}} --no-pager', lx),
    step('Журнал службы', 'journalctl -u {{SERVICE}} -n 30 --no-pager', lx)
  ]),
  sc('linux-sysinfo', 'Сбор системной информации', 'Версия ОС, ядро, CPU, память, диски, сеть.', ['linux'], [
    step('ОС', 'cat /etc/os-release', lx),
    step('Ядро', 'uname -a', lx),
    step('Процессор', 'lscpu', lx),
    step('Память', 'free -h', lx),
    step('Диски', 'lsblk -f', lx),
    step('Адреса', 'ip -br addr', lx),
    step('Маршруты', 'ip route', lx)
  ]),
  sc('linux-net', 'Проверка сетевого подключения', 'Интерфейсы, маршрут, доступность узла и DNS.', ['linux'], [
    step('Интерфейсы', 'ip -br addr', lx),
    step('Маршруты', 'ip route', lx),
    step('Доступность узла', 'ping -c 4 {{HOST}}', lx),
    step('Маршрут до узла', 'ip route get {{IP}}', lx),
    step('Настройки DNS', 'resolvectl status 2>/dev/null || cat /etc/resolv.conf', lx),
    step('Разрешение имени', 'getent hosts {{HOST}}', lx)
  ]),
  sc('linux-logs', 'Анализ логов', 'Ошибки системы, журнал службы и сообщения ядра.', ['linux'], [
    step('Ошибки с момента загрузки', 'journalctl -p err -b --no-pager -n 50', lx),
    step('Журнал службы за час', 'journalctl -u {{SERVICE}} --since "1 hour ago" --no-pager', lx),
    step('Сообщения ядра', 'sudo dmesg -T --level=err,warn | tail -30', lx)
  ])
];
