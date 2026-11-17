import { L } from './_helpers';

export const SYSTEMD_LOGS = [
  // ===== Службы systemd =====
  L({
    id: 'systemctl-status', cat: 'systemd', title: 'Состояние службы', cmd: 'systemctl status nginx',
    desc: 'Показывает, активна ли служба, с какого времени, PID, потребление памяти и последние строки журнала.',
    out: 'Active: active (running) — работает; failed — завершилась с ошибкой; inactive (dead) — остановлена. Loaded: …; enabled — включён автозапуск.',
    ex: [['systemctl status ssh --no-pager -l', 'без пейджера и без обрезки строк'], ['systemctl is-active nginx', 'только состояние (для скриптов)'], ['systemctl is-enabled nginx', 'включён ли автозапуск']],
    rel: ['journalctl -u', 'systemctl list-units'], docs: 'man 1 systemctl', tags: ['служба', 'проверка служб'], tpl: 'systemctl status {{SERVICE}} --no-pager'
  }),
  L({
    id: 'systemctl-start', cat: 'systemd', title: 'Запуск службы', cmd: 'sudo systemctl start nginx', desc: 'Запускает службу (без включения автозапуска).', root: true,
    verify: 'systemctl is-active nginx', rel: ['systemctl enable --now'], docs: 'man 1 systemctl', tpl: 'sudo systemctl start {{SERVICE}}'
  }),
  L({
    id: 'systemctl-stop', cat: 'systemd', title: 'Остановка службы', cmd: 'sudo systemctl stop nginx', desc: 'Останавливает службу. Служба перестаёт обслуживать клиентов.', root: true,
    warn: ['Остановка ssh/sshd на удалённом сервере прервёт новые подключения. Остановка сети или firewall может отрезать доступ.'],
    verify: 'systemctl is-active nginx', rel: ['systemctl disable'], docs: 'man 1 systemctl', tpl: 'sudo systemctl stop {{SERVICE}}'
  }),
  L({
    id: 'systemctl-restart', cat: 'systemd', title: 'Перезапуск службы', cmd: 'sudo systemctl restart nginx',
    desc: 'Останавливает и снова запускает службу (кратковременный простой). Если служба умеет перечитывать конфигурацию — используйте reload.',
    root: true, warn: ['Перед перезапуском проверяйте конфигурацию (nginx -t, apachectl configtest, sshd -t) — иначе служба может не подняться.'],
    verify: 'systemctl status nginx --no-pager', rel: ['systemctl reload', 'systemctl reload-or-restart'], docs: 'man 1 systemctl', tpl: 'sudo systemctl restart {{SERVICE}}'
  }),
  L({
    id: 'systemctl-reload', cat: 'systemd', title: 'Перечитать конфигурацию службы', cmd: 'sudo systemctl reload nginx',
    desc: 'Просит службу перечитать конфигурацию без остановки (если служба это поддерживает). reload-or-restart — reload, а если не поддерживается, то restart.',
    root: true, rel: ['systemctl restart'], docs: 'man 1 systemctl', tpl: 'sudo systemctl reload {{SERVICE}}'
  }),
  L({
    id: 'systemctl-enable', cat: 'systemd', title: 'Включить автозапуск службы', cmd: 'sudo systemctl enable --now nginx',
    desc: 'Включает запуск службы при загрузке; --now — сразу и запустить.', root: true,
    verify: 'systemctl is-enabled nginx', rel: ['systemctl disable'], docs: 'man 1 systemctl', tpl: 'sudo systemctl enable --now {{SERVICE}}'
  }),
  L({
    id: 'systemctl-disable', cat: 'systemd', title: 'Отключить автозапуск службы', cmd: 'sudo systemctl disable nginx',
    desc: 'Отключает запуск при загрузке (служба продолжит работать до остановки; --now — остановить сразу). mask — полностью запретить запуск.',
    root: true, risk: 'danger', ex: [['sudo systemctl disable --now cups', 'отключить и остановить'], ['sudo systemctl mask bluetooth', 'запретить запуск вообще (unmask — отменить)']],
    rel: ['systemctl enable'], docs: 'man 1 systemctl', tpl: 'sudo systemctl disable {{SERVICE}}'
  }),
  L({
    id: 'systemctl-failed', cat: 'systemd', title: 'Службы, завершившиеся с ошибкой', cmd: 'systemctl --failed',
    desc: 'Список юнитов в состоянии failed — первое, что стоит проверить при диагностике сервера.',
    ex: [['sudo systemctl reset-failed', 'сбросить отметки failed после устранения причины']], rel: ['journalctl -p err -b'], docs: 'man 1 systemctl', tags: ['ошибки запуска']
  }),
  L({
    id: 'systemctl-list', cat: 'systemd', title: 'Список служб', cmd: 'systemctl list-units --type=service --state=running',
    desc: 'Работающие службы. list-unit-files --state=enabled — службы с автозапуском.',
    ex: [['systemctl list-unit-files --type=service --state=enabled', 'что запускается при загрузке'], ['systemctl list-units --type=service --all', 'все службы, включая неактивные']],
    rel: ['systemctl status'], docs: 'man 1 systemctl', tags: ['автозагрузка']
  }),
  L({
    id: 'systemctl-cat', cat: 'systemd', title: 'Файл юнита и переопределения', cmd: 'systemctl cat nginx',
    desc: 'Показывает итоговый unit-файл с drop-in переопределениями. edit — создать переопределение в /etc/systemd/system/<юнит>.d/override.conf.',
    ex: [['sudo systemctl edit nginx', 'добавить переопределение (например, LimitNOFILE)'], ['systemctl show nginx -p Restart,MainPID', 'отдельные свойства']],
    rel: ['systemctl daemon-reload'], docs: 'man 1 systemctl'
  }),
  L({
    id: 'daemon-reload', cat: 'systemd', title: 'Перечитать unit-файлы', cmd: 'sudo systemctl daemon-reload',
    desc: 'Нужно после ручного изменения unit-файлов в /etc/systemd/system.', root: true, rel: ['systemctl edit'], docs: 'man 1 systemctl'
  }),
  L({
    id: 'list-dependencies', cat: 'systemd', title: 'Зависимости службы', cmd: 'systemctl list-dependencies nginx',
    desc: 'Дерево зависимостей юнита. --reverse — кто зависит от этого юнита.', rel: ['systemd-analyze critical-chain'], docs: 'man 1 systemctl', tags: ['анализ зависимостей']
  }),
  L({
    id: 'systemd-analyze', cat: 'systemd', title: 'Анализ времени загрузки', cmd: 'systemd-analyze blame | head -20',
    desc: 'Сколько времени запускалась каждая служба; critical-chain — цепочка, определившая время загрузки.',
    ex: [['systemd-analyze', 'общее время загрузки'], ['systemd-analyze critical-chain', 'критическая цепочка'], ['systemd-analyze verify /etc/systemd/system/app.service', 'проверить unit-файл']],
    rel: ['journalctl -b'], docs: 'man 1 systemd-analyze', tags: ['анализ загрузки системы']
  }),
  L({
    id: 'systemd-timers', cat: 'cron', title: 'Таймеры systemd', cmd: 'systemctl list-timers --all',
    desc: 'Запланированные задачи systemd (замена cron): когда запускались и когда запустятся.', rel: ['crontab -l', 'systemd-run --on-calendar'], docs: 'man 5 systemd.timer'
  }),
  L({
    id: 'systemd-run', cat: 'cron', title: 'Разовый запуск в фоне или по таймеру', cmd: 'sudo systemd-run --on-active=30min /usr/local/bin/cleanup.sh',
    desc: 'Запускает команду как временный юнит systemd: в фоне, через заданное время или по календарю. Журнал — journalctl -u <имя юнита>.',
    root: true, rel: ['at', 'systemctl list-timers'], docs: 'man 1 systemd-run'
  }),

  // ===== Логи и диагностика =====
  L({
    id: 'journalctl-unit', cat: 'logs', title: 'Журнал службы', cmd: 'journalctl -u nginx -n 100 --no-pager',
    desc: 'Сообщения конкретной службы из журнала systemd.',
    params: [['-u ЮНИТ', 'служба'], ['-n N', 'последние N строк'], ['-f', 'следить в реальном времени'], ['--since "1 hour ago"', 'за последний час'], ['-b', 'с текущей загрузки'], ['-p err', 'только ошибки и важнее'], ['-o cat', 'только текст сообщений']],
    ex: [['journalctl -u ssh --since today', 'события SSH за сегодня'], ['journalctl -u nginx -f', 'следить за журналом службы'], ['journalctl -u app --since "2024-05-01 10:00" --until "2024-05-01 11:00"', 'за интервал']],
    root: 'partial', rel: ['systemctl status', 'journalctl -p'], docs: 'man 1 journalctl', tags: ['логи', 'журнал', 'поиск ошибок служб'], tpl: 'journalctl -u {{SERVICE}} -n 100 --no-pager'
  }),
  L({
    id: 'journalctl-err', cat: 'logs', title: 'Ошибки с момента загрузки', cmd: 'journalctl -p err -b --no-pager',
    desc: 'Все сообщения уровня err и выше (crit, alert, emerg) с текущей загрузки.',
    ex: [['journalctl -p warning --since "1 hour ago"', 'предупреждения за час'], ['journalctl -b -1 -p err', 'ошибки предыдущей загрузки (нужен постоянный журнал)']],
    root: 'partial', rel: ['dmesg', 'systemctl --failed'], docs: 'man 1 journalctl', tags: ['проверка системных ошибок']
  }),
  L({
    id: 'journalctl-boots', cat: 'logs', title: 'Список загрузок в журнале', cmd: 'journalctl --list-boots',
    desc: 'Загрузки, записи о которых есть в журнале. Если видна только текущая — журнал не сохраняется на диск (создайте /var/log/journal).', rel: ['last reboot'], docs: 'man 1 journalctl'
  }),
  L({
    id: 'journalctl-disk', cat: 'logs', title: 'Размер журнала и очистка', cmd: 'journalctl --disk-usage',
    desc: 'Сколько места занимает журнал. Очистка — --vacuum-size / --vacuum-time. Постоянное ограничение — SystemMaxUse в /etc/systemd/journald.conf.',
    ex: [['sudo journalctl --vacuum-size=500M', 'оставить не более 500 МБ'], ['sudo journalctl --vacuum-time=14d', 'удалить записи старше 14 дней']],
    rel: ['du -sh /var/log/journal'], docs: 'man 1 journalctl'
  }),
  L({
    id: 'journalctl-ssh', cat: 'logs', title: 'События SSH и авторизации', cmd: 'journalctl -u ssh --since today --no-pager',
    desc: 'Входы, неудачные попытки и ошибки SSH. В Debian служба называется ssh, в некоторых дистрибутивах — sshd.',
    ex: [['journalctl -u ssh | grep -i "failed password"', 'неудачные пароли'], ['journalctl _COMM=sshd -n 50', 'по имени процесса']],
    root: 'partial', rel: ['last', 'grep auth.log', 'fail2ban-client status sshd'], docs: 'man 1 journalctl', tags: ['проверка ssh-событий', 'проверка авторизаций']
  }),
  L({
    id: 'auth-log', cat: 'logs', title: 'Журнал авторизаций (auth.log)', cmd: 'sudo grep -Ei "failed|invalid|accepted" /var/log/auth.log | tail -50',
    desc: 'Файл rsyslog с событиями входа, sudo и SSH.', root: true,
    compat: 'Есть, если установлен rsyslog. В Debian 12+ по умолчанию rsyslog может отсутствовать — используйте journalctl.',
    rel: ['journalctl -u ssh', 'last', 'lastb'], docs: 'man 8 rsyslogd'
  }),
  L({
    id: 'var-log', cat: 'logs', title: 'Обзор каталога журналов', cmd: 'sudo ls -lh /var/log',
    desc: 'Основные файлы: syslog/messages, auth.log, kern.log, dpkg.log, apt/history.log, журналы приложений (nginx, apache2, mysql).',
    ex: [['sudo tail -n 50 /var/log/dpkg.log', 'последние операции с пакетами'], ['zgrep "error" /var/log/syslog.2.gz', 'поиск в сжатых ротированных журналах']],
    rel: ['journalctl', 'logrotate'], docs: 'man 7 hier', tags: ['/var/log', 'анализ логов приложений']
  }),
  L({
    id: 'dmesg', cat: 'logs', title: 'Сообщения ядра', cmd: 'sudo dmesg -T --level=err,warn | tail -50',
    desc: 'Кольцевой буфер ядра: ошибки дисков, драйверов, OOM killer, сетевые карты. -T — человеко-читаемое время.',
    root: true, ex: [['sudo dmesg -T | grep -i -E "oom|killed process"', 'не убивал ли ядро процессы из-за нехватки памяти'], ['sudo dmesg -T | grep -i -E "i/o error|ata|nvme"', 'ошибки дисков'], ['sudo dmesg -w', 'следить в реальном времени']],
    compat: 'В Debian обычному пользователю доступ к dmesg закрыт (kernel.dmesg_restrict=1).', rel: ['journalctl -k'], docs: 'man 1 dmesg'
  }),
  L({
    id: 'logrotate', cat: 'logs', title: 'Проверка ротации журналов', cmd: 'sudo logrotate -d /etc/logrotate.d/nginx',
    desc: 'logrotate сжимает и удаляет старые журналы по правилам из /etc/logrotate.d. -d — пробный прогон без изменений, -f — принудительная ротация.',
    root: true, rel: ['du -sh /var/log'], docs: 'man 8 logrotate'
  }),
  L({
    id: 'logger', cat: 'logs', title: 'Записать сообщение в системный журнал', cmd: 'logger -t backup "Резервное копирование завершено"',
    desc: 'Пишет сообщение в syslog/journald — удобно для скриптов.', rel: ['journalctl -t backup'], docs: 'man 1 logger'
  })
];
