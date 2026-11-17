import { L } from './_helpers';

export const SECURITY_CRON_BACKUP = [
  // ===== Firewall и безопасность =====
  L({
    id: 'ufw-status', cat: 'firewall', title: 'UFW: состояние и правила', cmd: 'sudo ufw status verbose',
    desc: 'Включён ли UFW, политики по умолчанию и правила. status numbered — с номерами для удаления.',
    root: true, pkg: 'ufw', compat: 'UFW установлен в Ubuntu по умолчанию (но выключен); в Debian — отдельный пакет.',
    rel: ['ufw allow', 'nft list ruleset'], docs: 'man 8 ufw', tags: ['firewall', 'состояние firewall']
  }),
  L({
    id: 'ufw-allow', cat: 'firewall', title: 'UFW: разрешить порт', cmd: 'sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp',
    desc: 'Добавляет разрешающее правило. Перед ufw enable обязательно разрешите SSH, иначе потеряете доступ.',
    root: true, pkg: 'ufw', ex: [['sudo ufw allow 443/tcp', 'HTTPS для всех'], ['sudo ufw allow OpenSSH', 'по профилю приложения'], ['sudo ufw delete 3', 'удалить правило по номеру (см. status numbered)'], ['sudo ufw enable', 'включить UFW']],
    warn: ['Изменение правил firewall на удалённом сервере может отрезать доступ.'], risk: 'danger', verify: 'sudo ufw status numbered', rel: ['ufw status'], docs: 'man 8 ufw', tags: ['настройка сетевых правил'], tpl: 'sudo ufw allow from {{IP}} to any port {{PORT}} proto tcp'
  }),
  L({
    id: 'nft-list', cat: 'firewall', title: 'nftables: текущие правила', cmd: 'sudo nft list ruleset',
    desc: 'Все таблицы, цепочки и правила nftables (основной firewall в Debian 10+). Постоянные правила — /etc/nftables.conf.',
    root: true, ex: [['sudo nft list table inet filter', 'одна таблица'], ['sudo nft -c -f /etc/nftables.conf', 'проверить файл без применения'], ['sudo systemctl status nftables', 'загружаются ли правила при старте']],
    rel: ['iptables -L', 'ufw status'], docs: 'man 8 nft'
  }),
  L({
    id: 'iptables-list', cat: 'firewall', title: 'iptables: просмотр правил', cmd: 'sudo iptables -L -n -v --line-numbers',
    desc: 'Правила таблицы filter со счётчиками. -t nat — таблица NAT. iptables-save — все правила в виде команд.',
    root: true, ex: [['sudo iptables -t nat -L -n -v', 'правила NAT'], ['sudo iptables-save > /root/iptables.$(date +%F).rules', 'сохранить текущие правила']],
    compat: 'В современных Debian/Ubuntu iptables работает поверх nftables (iptables-nft).', rel: ['nft list ruleset'], docs: 'man 8 iptables'
  }),
  L({
    id: 'iptables-add', cat: 'firewall', title: 'iptables: добавить правило', cmd: 'sudo iptables -I INPUT -s 192.168.0.0/16 -p tcp --dport 22 -j ACCEPT',
    desc: '-I — вставить в начало цепочки, -A — в конец, -D — удалить. Правила не сохраняются после перезагрузки без iptables-persistent.',
    root: true, warn: ['Ошибочное правило DROP для SSH отрежет доступ. Тестируйте с запланированным откатом: echo "iptables-restore < /root/saved.rules" | at now + 5 min.'],
    risk: 'danger', rel: ['iptables-save', 'netfilter-persistent'], docs: 'man 8 iptables'
  }),
  L({
    id: 'fail2ban', cat: 'firewall', title: 'Fail2ban: заблокированные адреса', cmd: 'sudo fail2ban-client status sshd',
    desc: 'Статус «тюрьмы» sshd: число неудачных попыток и заблокированные IP.', root: true, pkg: 'fail2ban',
    ex: [['sudo fail2ban-client status', 'список активных тюрем'], ['sudo fail2ban-client set sshd unbanip 192.168.1.50', 'разблокировать адрес']],
    compat: 'В Debian 12 для чтения журнала systemd задайте backend = systemd в jail.local.', rel: ['journalctl -u ssh'], docs: 'man 1 fail2ban-client'
  }),
  L({
    id: 'apparmor', cat: 'firewall', title: 'AppArmor: профили и режимы', cmd: 'sudo aa-status',
    desc: 'Загруженные профили AppArmor и режимы enforce/complain. Отказы видны в журнале как apparmor="DENIED".',
    root: true, pkg: 'apparmor-utils (для aa-complain/aa-enforce)', ex: [['sudo journalctl -k | grep -i apparmor', 'отказы AppArmor']], rel: ['dmesg'], docs: 'man 8 aa-status'
  }),
  L({
    id: 'sudo-log', cat: 'firewall', title: 'Кто и что выполнял через sudo', cmd: 'sudo journalctl _COMM=sudo --since "7 days ago" --no-pager',
    desc: 'Журнал команд, выполненных через sudo.', root: true, rel: ['last', 'auth.log'], docs: 'man 8 sudo'
  }),
  L({
    id: 'users-audit', cat: 'firewall', title: 'Пользователи с UID 0 и с оболочкой входа', cmd: "awk -F: '$3==0 || $7 !~ /(nologin|false)$/ {print $1, $3, $7}' /etc/passwd",
    desc: 'Аудит: учётные записи с правами root (UID 0) и все, кто может войти в оболочку.', rel: ['getent passwd', 'last'], docs: 'man 5 passwd', tags: ['проверка пользователей']
  }),
  L({
    id: 'listening-audit', cat: 'firewall', title: 'Службы, слушающие на всех адресах', cmd: "sudo ss -tulpn | grep -vE '127\\.0\\.0\\.1|\\[::1\\]'",
    desc: 'Порты, доступные извне (не только на localhost) — кандидаты на закрытие в firewall.', root: true, rel: ['ss'], docs: 'man 8 ss', tags: ['проверка открытых портов']
  }),
  L({
    id: 'authorized-keys', cat: 'firewall', title: 'Ключи доступа пользователей', cmd: 'sudo find /home /root -name authorized_keys -exec sh -c \'echo "== $1"; cat "$1"\' _ {} \\;',
    desc: 'Все authorized_keys на сервере — проверка, у кого есть доступ по ключам.', root: true, rel: ['ssh-keygen -lf'], docs: 'man 8 sshd'
  }),

  // ===== Cron и автоматизация =====
  L({
    id: 'crontab-l', cat: 'cron', title: 'Задания cron пользователя', cmd: 'crontab -l',
    desc: 'Задания текущего пользователя. sudo crontab -l -u ИМЯ — другого пользователя. Системные задания — /etc/crontab и /etc/cron.d/.',
    ex: [['sudo crontab -l -u www-data', 'задания пользователя www-data'], ['ls /etc/cron.d /etc/cron.daily', 'системные задания']],
    rel: ['crontab -e', 'systemctl list-timers'], docs: 'man 1 crontab', tags: ['cron', 'планирование задач']
  }),
  L({
    id: 'crontab-e', cat: 'cron', title: 'Редактирование заданий cron', cmd: 'crontab -e',
    desc: 'Формат: минута час день месяц день_недели команда. Пример: 30 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1',
    warn: ['В cron минимальное окружение (PATH, переменные) — указывайте полные пути. crontab -r удаляет все задания без подтверждения.'],
    rel: ['crontab -l', 'journalctl -u cron'], docs: 'man 5 crontab'
  }),
  L({
    id: 'cron-log', cat: 'cron', title: 'Журнал запусков cron', cmd: 'journalctl -u cron --since today --no-pager',
    desc: 'Когда и какие задания cron запускались.', rel: ['crontab -l'], docs: 'man 8 cron'
  }),
  L({
    id: 'at', cat: 'cron', title: 'Разовый запуск в заданное время', cmd: 'echo "systemctl restart app" | sudo at 03:00',
    desc: 'Однократное выполнение. atq — очередь, atrm N — удалить задание.', pkg: 'at',
    ex: [['echo "/root/restore-fw.sh" | sudo at now + 10 minutes', 'страховка: откат firewall через 10 минут'], ['atq', 'очередь заданий']], rel: ['systemd-run', 'cron'], docs: 'man 1 at'
  }),
  L({
    id: 'systemd-timer-unit', cat: 'cron', title: 'Создание таймера systemd', cmd: 'systemctl cat logrotate.timer',
    desc: 'Таймер = юнит .service (что делать) + .timer (когда). Пример [Timer]: OnCalendar=*-*-* 02:30:00, Persistent=true. Включение: systemctl enable --now имя.timer.',
    rel: ['systemctl list-timers'], docs: 'man 5 systemd.timer'
  }),

  // ===== Скрипты Bash =====
  L({
    id: 'bash-shebang', cat: 'bash', title: 'Каркас надёжного скрипта', cmd: 'head -5 /usr/local/bin/backup.sh',
    desc: 'Рекомендуемое начало скрипта:\n#!/usr/bin/env bash\nset -euo pipefail\n-e — выход при ошибке, -u — ошибка при неопределённой переменной, -o pipefail — ошибка в любом звене конвейера.',
    ex: [['bash -n script.sh', 'проверить синтаксис без выполнения'], ['bash -x script.sh', 'выполнить с трассировкой команд'], ['shellcheck script.sh', 'статический анализ (пакет shellcheck)']],
    rel: ['shellcheck'], docs: 'man 1 bash'
  }),
  L({
    id: 'bash-vars', cat: 'bash', title: 'Переменные и подстановки', cmd: 'echo "${HOSTNAME} $(date +%F)"',
    desc: 'VAR=значение (без пробелов вокруг =), "$VAR" — всегда в кавычках, $(команда) — подстановка вывода, ${VAR:-по_умолчанию}.',
    ex: [['TS=$(date +%Y%m%d-%H%M); echo "$TS"', 'метка времени для имён файлов'], ['echo "${DIR:?переменная DIR не задана}"', 'ошибка, если переменная пуста']], rel: ['env', 'export'], docs: 'man 1 bash'
  }),
  L({
    id: 'bash-if', cat: 'bash', title: 'Условия', cmd: 'if [ -f /etc/nginx/nginx.conf ]; then echo "есть"; else echo "нет"; fi',
    desc: 'Проверки: -f файл, -d каталог, -z пустая строка, -n непустая, = равенство строк, -eq/-lt/-gt числа. [[ … ]] — расширенный вариант bash.',
    ex: [['[[ $(df --output=pcent / | tail -1 | tr -d " %") -gt 90 ]] && echo "Мало места"', 'проверка заполнения диска'], ['systemctl is-active --quiet nginx || systemctl restart nginx', 'перезапуск, если служба не активна']],
    rel: ['test'], docs: 'man 1 test'
  }),
  L({
    id: 'bash-loops', cat: 'bash', title: 'Циклы', cmd: 'for h in 10.0.0.5 10.0.0.6; do ping -c1 -W1 "$h" >/dev/null && echo "$h up" || echo "$h down"; done',
    desc: 'for … in …; do …; done — по списку; while read -r line; do …; done < файл — по строкам файла.',
    ex: [['while read -r ip; do nc -zv -w2 "$ip" 22; done < hosts.txt', 'проверить порт 22 у списка адресов'], ['for f in /var/log/*.log; do echo "$f: $(wc -l < "$f")"; done', 'число строк в журналах']],
    rel: ['xargs'], docs: 'man 1 bash'
  }),
  L({
    id: 'bash-redirect', cat: 'bash', title: 'Перенаправление вывода и конвейеры', cmd: 'command > out.log 2>&1',
    desc: '> — в файл (перезапись), >> — дописать, 2> — поток ошибок, 2>&1 — ошибки туда же, | — передать вывод следующей команде, < — ввод из файла.',
    ex: [['./script.sh >> /var/log/script.log 2>&1', 'дописывать вывод и ошибки в журнал'], ['cmd 2>/dev/null', 'скрыть ошибки']],
    rel: ['tee'], docs: 'man 1 bash', tags: ['конвейеры', 'перенаправление вывода']
  }),
  L({
    id: 'bash-exit', cat: 'bash', title: 'Код завершения команды', cmd: 'echo $?',
    desc: '$? — код завершения последней команды: 0 — успех, иное — ошибка. && — выполнить при успехе, || — при ошибке.',
    ex: [['grep -q "^PermitRootLogin no" /etc/ssh/sshd_config && echo OK || echo "Проверьте настройку"', 'проверка с выводом результата'], ['set -o pipefail', 'учитывать ошибки внутри конвейера']],
    rel: ['test'], docs: 'man 1 bash', tags: ['exit code']
  }),
  L({
    id: 'bash-functions', cat: 'bash', title: 'Функции и журналирование в скриптах', cmd: 'log() { echo "$(date "+%F %T") $*" | tee -a /var/log/myscript.log; }',
    desc: 'Объявление функции и вызов: log "Начало резервного копирования". local VAR — локальная переменная функции.', rel: ['logger'], docs: 'man 1 bash'
  }),
  L({
    id: 'bash-trap', cat: 'bash', title: 'Очистка при выходе (trap)', cmd: 'trap \'rm -f "$TMP"\' EXIT',
    desc: 'Выполняет команду при завершении скрипта (в том числе по ошибке или Ctrl+C) — удобно для удаления временных файлов и lock-файлов.',
    ex: [['TMP=$(mktemp); trap \'rm -f "$TMP"\' EXIT', 'временный файл с гарантированным удалением'], ['exec 9>/run/lock/backup.lock; flock -n 9 || exit 1', 'защита от параллельного запуска']],
    rel: ['mktemp', 'flock'], docs: 'man 1 bash'
  }),

  // ===== Резервное копирование =====
  L({
    id: 'tar-create', cat: 'backup', title: 'Архивирование каталога (tar.gz)', cmd: 'sudo tar -czpf /backup/etc-$(date +%F).tar.gz /etc',
    syntax: 'tar -c[z|J]f АРХИВ ФАЙЛЫ…', desc: 'Создаёт сжатый архив: -c создать, -z gzip, -J xz, -p сохранить права, -f имя архива, -v подробно.',
    params: [['-c', 'создать архив'], ['-z / -J', 'сжатие gzip / xz'], ['-p', 'сохранить права'], ['--exclude=ШАБЛОН', 'исключить'], ['-C КАТАЛОГ', 'перейти в каталог перед архивированием']],
    ex: [['tar -czf site.tgz -C /var/www site', 'архив без полного пути'], ['sudo tar -cJf /backup/srv.tar.xz --exclude="*.log" /srv', 'xz с исключениями']],
    rel: ['tar -x', 'rsync'], docs: 'man 1 tar', tags: ['архивирование каталогов']
  }),
  L({
    id: 'tar-list', cat: 'backup', title: 'Просмотр содержимого архива', cmd: 'tar -tzvf backup.tar.gz | head',
    desc: 'Список файлов в архиве без распаковки — проверка, что архив читается.', rel: ['tar -x'], docs: 'man 1 tar'
  }),
  L({
    id: 'tar-extract', cat: 'backup', title: 'Распаковка архива / восстановление файлов', cmd: 'tar -xzf backup.tar.gz -C /tmp/restore',
    desc: '-x распаковать, -C куда. Можно извлечь отдельный файл, указав путь внутри архива.',
    ex: [['tar -xzf etc-2024-05-01.tar.gz -C /tmp/restore etc/nginx/nginx.conf', 'восстановить один файл во временный каталог']],
    warn: ['Распаковка в / перезапишет существующие файлы. Сначала распакуйте во временный каталог и сравните.'], rel: ['tar -t'], docs: 'man 1 tar', tags: ['восстановление файлов']
  }),
  L({
    id: 'gzip', cat: 'backup', title: 'Сжатие gzip', cmd: 'gzip -k big.log',
    desc: 'Сжимает файл (по умолчанию заменяет его на .gz; -k — сохранить исходный). gunzip/zcat — распаковать/прочитать.',
    ex: [['zcat access.log.2.gz | grep 404', 'поиск в сжатом журнале'], ['gzip -t file.gz', 'проверить целостность']], rel: ['xz', 'tar'], docs: 'man 1 gzip'
  }),
  L({
    id: 'xz', cat: 'backup', title: 'Сжатие xz (сильнее gzip)', cmd: 'xz -T0 -k dump.sql',
    desc: 'Лучшее сжатие ценой времени. -T0 — все ядра, -d — распаковать, -9 — максимальное сжатие.', rel: ['gzip', 'zstd'], docs: 'man 1 xz'
  }),
  L({
    id: 'backup-config-dirs', cat: 'backup', title: 'Резервная копия конфигурации сервера', cmd: 'sudo tar -czpf /root/config-$(hostname)-$(date +%F).tgz /etc /var/spool/cron /usr/local/bin',
    desc: 'Типовой набор для восстановления конфигурации: /etc, задания cron, свои скрипты. Плюс список пакетов: dpkg --get-selections > packages.list.',
    ex: [['dpkg --get-selections > /root/packages-$(date +%F).list', 'список установленных пакетов'], ['scp /root/config-*.tgz backup@10.0.0.6:/backup/', 'вынести копию на другой сервер']],
    rel: ['tar', 'rsync'], docs: 'man 1 tar'
  }),
  L({
    id: 'sha256sum', cat: 'backup', title: 'Контрольные суммы', cmd: 'sha256sum backup.tar.gz > backup.tar.gz.sha256',
    desc: 'Вычисляет SHA-256. Проверка: sha256sum -c файл.sha256.', ex: [['sha256sum -c backup.tar.gz.sha256', 'проверить целостность после копирования']], rel: ['md5sum'], docs: 'man 1 sha256sum'
  })
];
