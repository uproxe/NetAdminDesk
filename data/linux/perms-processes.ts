import { L } from './_helpers';

export const PERMS_PROCESSES = [
  // ===== Права и пользователи =====
  L({
    id: 'chmod', cat: 'perms', title: 'Изменение прав доступа', cmd: 'chmod 640 /etc/app/secret.conf',
    syntax: 'chmod [ПАРАМЕТРЫ] РЕЖИМ ФАЙЛ…', desc: 'Меняет права: числом (r=4, w=2, x=1 для владельца, группы, остальных) или символьно (u+x, g-w, o=).',
    params: [['755', 'rwxr-xr-x — каталоги, скрипты'], ['644', 'rw-r--r-- — обычные файлы'], ['600', 'rw------- — ключи, секреты'], ['u+x', 'добавить владельцу право выполнения'], ['-R', 'рекурсивно (опасно)']],
    ex: [['chmod 600 ~/.ssh/id_ed25519', 'правильные права приватного ключа'], ['chmod +x deploy.sh', 'сделать скрипт исполняемым'], ['find /srv/site -type d -exec chmod 755 {} +', 'права только каталогам, без рекурсии по файлам']],
    warn: ['chmod -R 777 — грубая ошибка безопасности. Права каталогам и файлам задавайте раздельно через find.'],
    verify: 'stat -c "%a %n" ФАЙЛ', rel: ['chown', 'umask', 'stat'], docs: 'man 1 chmod', tags: ['права']
  }),
  L({
    id: 'chown', cat: 'perms', title: 'Смена владельца и группы', cmd: 'sudo chown www-data:www-data /var/www/site -R',
    desc: 'Меняет владельца и/или группу файлов.', root: true,
    params: [['ВЛАДЕЛЕЦ:ГРУППА', 'оба сразу'], [':ГРУППА', 'только группа'], ['-R', 'рекурсивно'], ['--reference=ФАЙЛ', 'как у другого файла']],
    warn: ['Рекурсивная смена владельца в системных каталогах (/etc, /usr, /var) может сломать систему.'],
    risk: 'danger', verify: 'ls -l', rel: ['chmod', 'chgrp'], docs: 'man 1 chown'
  }),
  L({
    id: 'chgrp', cat: 'perms', title: 'Смена группы файла', cmd: 'chgrp adm /var/log/app.log', desc: 'Меняет группу-владельца файла.', rel: ['chown'], docs: 'man 1 chgrp'
  }),
  L({
    id: 'umask', cat: 'perms', title: 'Маска прав для новых файлов', cmd: 'umask',
    desc: 'Показывает или задаёт маску: какие права убираются у новых файлов. 022 → файлы 644, каталоги 755; 027 → 640/750.',
    ex: [['umask 027', 'для текущего сеанса: новые файлы недоступны «остальным»']], rel: ['chmod'], docs: 'man 1 umask (встроенная bash)'
  }),
  L({
    id: 'id', cat: 'perms', title: 'UID, GID и группы пользователя', cmd: 'id', desc: 'Показывает идентификаторы и группы текущего или указанного пользователя.',
    ex: [['id www-data', 'группы пользователя www-data']], rel: ['groups', 'getent'], docs: 'man 1 id', tpl: 'id {{USERNAME}}'
  }),
  L({
    id: 'who-w', cat: 'perms', title: 'Кто сейчас в системе', cmd: 'w',
    desc: 'w — вошедшие пользователи, откуда, время простоя и что выполняют; who — краткий список.', rel: ['who', 'last'], docs: 'man 1 w', tags: ['проверка пользователей']
  }),
  L({ id: 'whoami', cat: 'perms', title: 'Текущий пользователь', cmd: 'whoami', desc: 'Имя эффективного пользователя (под кем выполняются команды).', rel: ['id'], docs: 'man 1 whoami' }),
  L({
    id: 'last', cat: 'perms', title: 'История входов', cmd: 'last -n 20',
    desc: 'Последние входы пользователей (из /var/log/wtmp). lastb — неудачные попытки (нужен root).',
    compat: 'В Debian 13 last и lastb предоставляются пакетом wtmpdb.', rel: ['lastlog', 'journalctl -u ssh'], docs: 'man 1 last'
  }),
  L({
    id: 'passwd', cat: 'perms', title: 'Смена пароля пользователя', cmd: 'passwd',
    desc: 'Смена своего пароля; от root — пароля любого пользователя. -l/-u — заблокировать/разблокировать вход по паролю, -S — статус.',
    ex: [['sudo passwd ivanov', 'задать пароль пользователю'], ['sudo passwd -S ivanov', 'статус пароля'], ['sudo passwd -l ivanov', 'заблокировать пароль']],
    rel: ['chage', 'usermod'], docs: 'man 1 passwd'
  }),
  L({
    id: 'chage', cat: 'perms', title: 'Срок действия пароля', cmd: 'sudo chage -l ivanov', desc: 'Показывает и задаёт сроки действия пароля и учётной записи.', root: true, rel: ['passwd'], docs: 'man 1 chage'
  }),
  L({
    id: 'useradd', cat: 'perms', title: 'Создание пользователя', cmd: 'sudo useradd -m -s /bin/bash -G sudo ivanov',
    desc: 'Низкоуровневое создание пользователя. В Debian/Ubuntu есть более дружелюбный интерактивный adduser.',
    root: true, params: [['-m', 'создать домашний каталог'], ['-s', 'оболочка входа'], ['-G', 'дополнительные группы'], ['-r', 'системный пользователь'], ['-e ГГГГ-ММ-ДД', 'дата истечения учётной записи']],
    ex: [['sudo adduser ivanov', 'интерактивное создание (Debian/Ubuntu)'], ['sudo useradd -r -s /usr/sbin/nologin svc-backup', 'служебный пользователь без входа']],
    verify: 'id ivanov', rel: ['usermod', 'userdel', 'passwd'], docs: 'man 8 useradd', tpl: 'sudo useradd -m -s /bin/bash {{USERNAME}}'
  }),
  L({
    id: 'usermod', cat: 'perms', title: 'Изменение пользователя (группы, блокировка)', cmd: 'sudo usermod -aG docker ivanov',
    desc: 'Изменяет учётную запись. -aG — добавить в группы, не удаляя из существующих.', root: true,
    params: [['-aG ГРУППЫ', 'добавить в группы (обязательно с -a!)'], ['-L / -U', 'заблокировать / разблокировать'], ['-s', 'сменить оболочку'], ['-e 1', 'отключить учётную запись (срок истёк)']],
    warn: ['-G без -a заменит все дополнительные группы пользователя (можно потерять sudo).', 'Новые группы применяются после повторного входа.'],
    verify: 'id ivanov', rel: ['useradd', 'gpasswd'], docs: 'man 8 usermod', tpl: 'sudo usermod -aG {{VALUE}} {{USERNAME}}'
  }),
  L({
    id: 'userdel', cat: 'perms', title: 'Удаление пользователя', cmd: 'sudo userdel ivanov',
    desc: 'Удаляет учётную запись. -r — вместе с домашним каталогом и почтовым ящиком.', root: true,
    warn: ['С -r данные домашнего каталога будут удалены безвозвратно. Сделайте архив.', 'Файлы пользователя вне домашнего каталога останутся с «осиротевшим» UID.'],
    risk: 'danger', rel: ['deluser', 'find / -nouser'], docs: 'man 8 userdel'
  }),
  L({ id: 'groupadd', cat: 'perms', title: 'Создание группы', cmd: 'sudo groupadd backup-operators', desc: 'Создаёт группу.', root: true, rel: ['groups', 'usermod -aG'], docs: 'man 8 groupadd' }),
  L({ id: 'groups', cat: 'perms', title: 'Группы пользователя', cmd: 'groups', desc: 'Группы текущего (или указанного) пользователя.', rel: ['id'], docs: 'man 1 groups' }),
  L({
    id: 'getent', cat: 'perms', title: 'Записи из баз NSS (passwd, group, hosts)', cmd: 'getent passwd ivanov',
    desc: 'Запрашивает базы NSS с учётом LDAP/SSSD/AD: пользователей, группы, хосты.',
    ex: [['getent group sudo', 'члены группы sudo'], ['getent hosts example.com', 'разрешение имени как у приложений'], ["getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1}'", 'обычные (не системные) пользователи']],
    rel: ['id', 'cat /etc/passwd'], docs: 'man 1 getent'
  }),
  L({
    id: 'sudo', cat: 'perms', title: 'Выполнение от имени root', cmd: 'sudo -l',
    desc: 'Запуск команд с правами другого пользователя (обычно root). -l — какие команды разрешены текущему пользователю.',
    ex: [['sudo -i', 'интерактивная оболочка root'], ['sudo -u postgres psql', 'команда от имени пользователя postgres']],
    rel: ['visudo', 'su'], docs: 'man 8 sudo'
  }),
  L({
    id: 'visudo', cat: 'perms', title: 'Безопасное редактирование sudoers', cmd: 'sudo visudo -c',
    desc: 'Редактирует /etc/sudoers с проверкой синтаксиса. -c — только проверка. Свои правила лучше класть в /etc/sudoers.d/.',
    ex: [['sudo visudo -f /etc/sudoers.d/backup', 'отдельный файл правил'], ['sudo visudo -c', 'проверить все файлы sudoers']],
    warn: ['Ошибка в sudoers может лишить доступа к sudo. Держите открытую root-сессию до проверки.'], root: true, rel: ['sudo'], docs: 'man 8 visudo'
  }),
  L({
    id: 'su', cat: 'perms', title: 'Сменить пользователя', cmd: 'su - postgres', desc: 'Переключается на другого пользователя. «-» — с полной загрузкой его окружения.', rel: ['sudo -i'], docs: 'man 1 su'
  }),
  L({
    id: 'setfacl', cat: 'perms', title: 'ACL файловой системы', cmd: 'getfacl /srv/share',
    desc: 'getfacl показывает, setfacl задаёт расширенные права для отдельных пользователей и групп.',
    pkg: 'acl', ex: [['setfacl -m u:ivanov:rwx /srv/share', 'дать пользователю права на каталог'], ['setfacl -d -m g:devs:rwx /srv/share', 'права по умолчанию для новых файлов']],
    rel: ['chmod'], docs: 'man 1 setfacl'
  }),

  // ===== Процессы и нагрузка =====
  L({
    id: 'ps', cat: 'processes', title: 'Список процессов', cmd: 'ps aux --sort=-%cpu | head -15',
    desc: 'Снимок процессов: пользователь, PID, %CPU, %MEM, состояние, команда.',
    params: [['aux', 'все процессы в BSD-формате'], ['-ef', 'все процессы в стандартном формате, с PPID'], ['--sort=-%mem', 'сортировка по памяти'], ['-o pid,ppid,cmd', 'свои столбцы'], ['-p PID', 'конкретный процесс']],
    ex: [['ps aux --sort=-%mem | head', 'самые «тяжёлые» по памяти'], ['ps -ef --forest', 'дерево процессов'], ['ps -o pid,etime,cmd -p 1234', 'сколько работает процесс']],
    out: 'STAT: R — выполняется, S — спит, D — непрерываемое ожидание (обычно диск/NFS), Z — зомби.',
    rel: ['top', 'pgrep', 'pstree'], docs: 'man 1 ps', tags: ['процессы', 'нагрузка процессора']
  }),
  L({
    id: 'top', cat: 'processes', title: 'Мониторинг процессов в реальном времени', cmd: 'top',
    desc: 'Интерактивная таблица процессов и загрузки. Клавиши: P — по CPU, M — по памяти, 1 — по ядрам, k — завершить процесс, q — выход.',
    ex: [['top -b -n 1 | head -20', 'один снимок в пакетном режиме (для отчётов)']],
    out: 'В строке %Cpu: wa — ожидание ввода-вывода (высокое значение — проблема дисков), st — время, украденное гипервизором.',
    rel: ['htop', 'ps', 'vmstat'], docs: 'man 1 top', tags: ['нагрузка', 'cpu']
  }),
  L({
    id: 'htop', cat: 'processes', title: 'Удобный интерактивный монитор процессов', cmd: 'htop', desc: 'Цветной монитор с деревом процессов, поиском (F3), фильтром (F4) и сортировкой (F6).',
    pkg: 'htop', rel: ['top', 'btop'], docs: 'man 1 htop'
  }),
  L({
    id: 'kill', cat: 'processes', title: 'Отправка сигнала процессу', cmd: 'kill 1234',
    syntax: 'kill [-СИГНАЛ] PID…', desc: 'По умолчанию отправляет SIGTERM (корректное завершение). SIGKILL (-9) — немедленное уничтожение без сохранения данных.',
    params: [['-15 / -TERM', 'корректное завершение (по умолчанию)'], ['-9 / -KILL', 'принудительно'], ['-1 / -HUP', 'перечитать конфигурацию (для многих демонов)'], ['-l', 'список сигналов']],
    warn: ['kill -9 не даёт процессу закрыть файлы и транзакции. Используйте только если TERM не помог.', 'Для служб systemd используйте systemctl stop/restart.'],
    risk: 'danger', rel: ['pkill', 'systemctl'], docs: 'man 1 kill'
  }),
  L({
    id: 'pkill-pgrep', cat: 'processes', title: 'Поиск и завершение процессов по имени', cmd: 'pgrep -a nginx',
    desc: 'pgrep выводит PID процессов по имени/шаблону (-a — с командной строкой); pkill отправляет им сигнал.',
    ex: [['pgrep -u www-data -a', 'процессы пользователя'], ['pkill -HUP rsyslogd', 'перечитать конфигурацию rsyslog']],
    warn: ['pkill по короткому шаблону может задеть посторонние процессы. Сначала проверьте pgrep -a.'], rel: ['ps', 'kill'], docs: 'man 1 pgrep'
  }),
  L({
    id: 'nice-renice', cat: 'processes', title: 'Приоритет процесса', cmd: 'nice -n 10 tar czf /backup/etc.tgz /etc',
    desc: 'nice запускает команду с пониженным (положительное значение) приоритетом CPU; renice меняет приоритет запущенного процесса.',
    ex: [['sudo renice -n 5 -p 1234', 'понизить приоритет процесса'], ['ionice -c3 rsync -a /src /dst', 'низкий приоритет ввода-вывода']],
    rel: ['ionice', 'top'], docs: 'man 1 nice'
  }),
  L({
    id: 'vmstat', cat: 'processes', title: 'Статистика памяти, swap, ввода-вывода и CPU', cmd: 'vmstat 2 5',
    desc: 'Выводит строки статистики каждые N секунд. Первая строка — средние с момента загрузки.',
    out: 'r — процессы в очереди на CPU, b — в ожидании ввода-вывода, si/so — подкачка (ненулевые значения — нехватка памяти), wa — ожидание дисков.',
    rel: ['iostat', 'free', 'top'], docs: 'man 8 vmstat'
  }),
  L({
    id: 'iostat', cat: 'processes', title: 'Нагрузка на диски', cmd: 'iostat -xz 2',
    desc: 'Расширенная статистика дисков: IOPS, задержки (await), загрузка устройства (%util).', pkg: 'sysstat',
    out: '%util около 100% и большой await — диск перегружен.', rel: ['iotop', 'vmstat'], docs: 'man 1 iostat'
  }),
  L({
    id: 'iotop', cat: 'processes', title: 'Какие процессы нагружают диск', cmd: 'sudo iotop -o', desc: 'Процессы, выполняющие ввод-вывод прямо сейчас (-o).', pkg: 'iotop', root: true, rel: ['iostat'], docs: 'man 8 iotop'
  }),
  L({
    id: 'lsof', cat: 'processes', title: 'Открытые файлы и сокеты', cmd: 'sudo lsof -i :443',
    desc: 'Показывает, какие процессы открыли файлы, каталоги, сокеты.', root: 'partial', pkg: 'lsof',
    ex: [['sudo lsof +L1', 'удалённые, но открытые файлы (занимают место на диске)'], ['sudo lsof /var/log/syslog', 'кто держит файл'], ['sudo lsof -u www-data', 'файлы пользователя'], ['sudo lsof +D /mnt/usb', 'почему не размонтируется каталог']],
    rel: ['fuser', 'ss'], docs: 'man 8 lsof'
  }),
  L({
    id: 'fuser', cat: 'processes', title: 'Процессы, использующие файл или порт', cmd: 'sudo fuser -vm /mnt/data',
    desc: 'Показывает PID процессов, использующих файл, ФС или порт. -k — завершить их (опасно).',
    ex: [['sudo fuser -v 80/tcp', 'кто слушает порт 80']], rel: ['lsof'], docs: 'man 1 fuser'
  }),
  L({ id: 'pstree', cat: 'processes', title: 'Дерево процессов', cmd: 'pstree -p', desc: 'Процессы в виде дерева с PID.', pkg: 'psmisc', rel: ['ps -ef --forest'], docs: 'man 1 pstree' }),
  L({
    id: 'loadavg', cat: 'processes', title: 'Средняя нагрузка (load average)', cmd: 'cat /proc/loadavg',
    desc: 'Load average за 1/5/15 мин, число выполняющихся/всех потоков, последний PID.', rel: ['uptime', 'nproc'], docs: 'man 5 proc'
  }),
  L({
    id: 'sar', cat: 'processes', title: 'Исторические данные загрузки', cmd: 'sar -u 1 5',
    desc: 'Сбор и вывод статистики (CPU, память, сеть, диски). Для истории включите сбор: ENABLED="true" в /etc/default/sysstat.',
    pkg: 'sysstat', ex: [['sar -r', 'память за сегодня'], ['sar -n DEV 1 3', 'сетевые интерфейсы']], rel: ['iostat', 'vmstat'], docs: 'man 1 sar'
  }),
  L({
    id: 'watch', cat: 'processes', title: 'Периодический запуск команды', cmd: 'watch -n 2 "ss -s"',
    desc: 'Выполняет команду каждые N секунд и показывает результат на весь экран. -d — подсвечивать изменения.', rel: ['top'], docs: 'man 1 watch'
  }),
  L({
    id: 'timeout', cat: 'processes', title: 'Ограничение времени выполнения', cmd: 'timeout 10 curl -s http://10.0.0.5/health',
    desc: 'Завершает команду, если она работает дольше указанного времени. Код возврата 124 — истекло время.', rel: ['kill'], docs: 'man 1 timeout'
  }),
  L({
    id: 'nohup', cat: 'processes', title: 'Запуск, не зависящий от SSH-сессии', cmd: 'nohup ./long-job.sh > job.log 2>&1 &',
    desc: 'Процесс продолжит работу после закрытия терминала. Для интерактивной работы удобнее tmux или screen.', rel: ['tmux', 'systemd-run'], docs: 'man 1 nohup'
  }),
  L({
    id: 'tmux', cat: 'processes', title: 'Терминальный мультиплексор (сессии переживают обрыв SSH)', cmd: 'tmux new -s work',
    desc: 'Сессии, окна и панели внутри одного SSH-подключения. Отключиться — Ctrl+b d, вернуться — tmux attach -t work.',
    pkg: 'tmux', ex: [['tmux ls', 'список сессий'], ['tmux attach -t work', 'подключиться к сессии']], rel: ['screen', 'nohup'], docs: 'man 1 tmux'
  })
];
