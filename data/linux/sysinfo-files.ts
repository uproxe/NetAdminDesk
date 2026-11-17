import { L } from './_helpers';

export const SYSINFO_FILES = [
  // ===== Общая информация о системе =====
  L({
    id: 'os-release', cat: 'sysinfo', title: 'Версия дистрибутива Linux', cmd: 'cat /etc/os-release',
    desc: 'Показывает название и версию дистрибутива (NAME, VERSION, VERSION_ID, VERSION_CODENAME). Стандартный файл systemd, есть во всех современных дистрибутивах.',
    ex: [['cat /etc/os-release', 'полная информация о дистрибутиве'], ['grep PRETTY_NAME /etc/os-release', 'только название с версией'], ['cat /etc/debian_version', 'точная версия Debian (в Ubuntu — база Debian)']],
    out: 'Строки ключ=значение. VERSION_CODENAME — кодовое имя релиза (bookworm, jammy, noble).',
    rel: ['lsb_release', 'hostnamectl', 'uname'], docs: 'man 5 os-release', tags: ['версия linux', 'дистрибутив']
  }),
  L({
    id: 'lsb-release', cat: 'sysinfo', title: 'Версия дистрибутива (lsb_release)', cmd: 'lsb_release -a',
    desc: 'Выводит идентификатор дистрибутива, описание, номер релиза и кодовое имя.',
    params: [['-a', 'вся информация'], ['-d', 'только описание'], ['-c', 'кодовое имя'], ['-r', 'номер релиза']],
    pkg: 'lsb-release', compat: 'В Ubuntu установлен по умолчанию; в минимальном Debian может отсутствовать (пакет lsb-release).',
    rel: ['cat /etc/os-release'], docs: 'man 1 lsb_release'
  }),
  L({
    id: 'uname', cat: 'sysinfo', title: 'Информация о ядре', cmd: 'uname -a',
    syntax: 'uname [-a|-r|-m|-n]', desc: 'Показывает версию ядра, имя узла, архитектуру.',
    params: [['-a', 'всё сразу'], ['-r', 'версия ядра (release)'], ['-m', 'архитектура (x86_64, aarch64)'], ['-n', 'сетевое имя узла']],
    ex: [['uname -r', 'только версия ядра, например 6.1.0-18-amd64'], ['uname -m', 'архитектура процессора']],
    rel: ['hostnamectl', 'cat /proc/version', 'dpkg -l linux-image*'], docs: 'man 1 uname', tags: ['ядро', 'kernel']
  }),
  L({
    id: 'hostnamectl', cat: 'sysinfo', title: 'Имя хоста, ОС, ядро, тип виртуализации', cmd: 'hostnamectl',
    desc: 'Сводка: статическое имя хоста, тип машины (vm/physical), виртуализация, ОС, ядро, архитектура. Установка имени — hostnamectl set-hostname.',
    ex: [['hostnamectl', 'сводная информация'], ['sudo hostnamectl set-hostname srv-app01', 'сменить имя хоста (изменяет /etc/hostname)']],
    warn: ['После смены имени проверьте /etc/hosts — имя должно разрешаться локально, иначе sudo будет выдавать предупреждения.'],
    rel: ['hostname', 'uname'], docs: 'man 1 hostnamectl', tags: ['hostname', 'виртуализация']
  }),
  L({
    id: 'hostname', cat: 'sysinfo', title: 'Имя хоста и IP-адреса хоста', cmd: 'hostname -I',
    desc: 'hostname без параметров — имя узла; -f — полное (FQDN); -I — все IP-адреса узла через пробел.',
    params: [['-f', 'полное доменное имя'], ['-I', 'все адреса узла'], ['-s', 'короткое имя']],
    rel: ['hostnamectl', 'ip -br addr'], docs: 'man 1 hostname'
  }),
  L({
    id: 'uptime', cat: 'sysinfo', title: 'Время работы и средняя нагрузка', cmd: 'uptime',
    desc: 'Сколько система работает без перезагрузки, число пользователей и load average за 1, 5 и 15 минут.',
    ex: [['uptime -p', 'время работы в читаемом виде'], ['uptime -s', 'дата и время последней загрузки']],
    out: 'Load average сравнивайте с числом ядер (nproc): значение стабильно выше числа ядер — признак перегрузки или ожидания ввода-вывода.',
    rel: ['nproc', 'top', 'cat /proc/loadavg'], docs: 'man 1 uptime', tags: ['нагрузка', 'load average']
  }),
  L({
    id: 'lscpu', cat: 'sysinfo', title: 'Информация о процессоре', cmd: 'lscpu',
    desc: 'Модель CPU, число сокетов, ядер и потоков, частоты, кэш, флаги виртуализации.',
    ex: [['nproc', 'число доступных процессоров (потоков)'], ['grep -c ^processor /proc/cpuinfo', 'то же через /proc']],
    rel: ['nproc', 'cat /proc/cpuinfo', 'top'], docs: 'man 1 lscpu', tags: ['cpu', 'процессор', 'ядра']
  }),
  L({
    id: 'free', cat: 'sysinfo', title: 'Оперативная память и swap', cmd: 'free -h',
    desc: 'Объём, использование и доступная память, swap.',
    params: [['-h', 'в удобных единицах'], ['-m', 'в мегабайтах'], ['-s N', 'обновлять каждые N секунд']],
    out: 'Ориентируйтесь на столбец available — сколько памяти можно выделить без вытеснения в swap. Большой buff/cache — норма: это кэш, освобождаемый при нехватке.',
    rel: ['vmstat', 'top', 'cat /proc/meminfo'], docs: 'man 1 free', tags: ['память', 'ram', 'озу', 'проверка памяти']
  }),
  L({
    id: 'meminfo', cat: 'sysinfo', title: 'Подробная статистика памяти', cmd: 'cat /proc/meminfo',
    desc: 'Детальные счётчики памяти ядра: MemTotal, MemAvailable, Cached, Dirty, SwapTotal, HugePages и др.',
    rel: ['free', 'vmstat'], docs: 'man 5 proc'
  }),
  L({
    id: 'lsblk-info', cat: 'sysinfo', title: 'Диски и разделы (обзор)', cmd: 'lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL',
    desc: 'Дерево блочных устройств: диски, разделы, LVM, RAID, точки монтирования.',
    compat: 'Столбец MOUNTPOINTS есть в util-linux 2.37+ (Debian 12, Ubuntu 22.04+); в старых версиях используйте MOUNTPOINT.',
    rel: ['df -h', 'blkid', 'fdisk -l'], docs: 'man 8 lsblk', tags: ['диски', 'информация о дисках']
  }),
  L({
    id: 'lshw', cat: 'sysinfo', title: 'Сводка оборудования', cmd: 'sudo lshw -short',
    desc: 'Список оборудования: процессор, память, диски, сетевые карты, контроллеры.',
    root: true, pkg: 'lshw', params: [['-short', 'краткая таблица'], ['-class network', 'только сетевые устройства'], ['-html', 'отчёт в HTML']],
    rel: ['dmidecode', 'lspci', 'lsusb'], docs: 'man 1 lshw'
  }),
  L({
    id: 'dmidecode', cat: 'sysinfo', title: 'Модель сервера, серийный номер, модули памяти (DMI)', cmd: 'sudo dmidecode -t system',
    desc: 'Читает таблицы DMI/SMBIOS: производитель, модель и серийный номер сервера, BIOS, слоты и модули памяти.',
    root: true, pkg: 'dmidecode', params: [['-t system', 'платформа и серийный номер'], ['-t memory', 'модули памяти'], ['-t bios', 'версия BIOS'], ['-s system-serial-number', 'только серийный номер']],
    compat: 'На виртуальных машинах показывает данные гипервизора.', rel: ['lshw'], docs: 'man 8 dmidecode', tags: ['серийный номер']
  }),
  L({
    id: 'lspci', cat: 'sysinfo', title: 'Устройства PCI', cmd: 'lspci',
    desc: 'Список PCI-устройств: сетевые карты, RAID-контроллеры, видео. -k показывает используемый драйвер.',
    pkg: 'pciutils', ex: [['lspci -k | grep -A3 -i ethernet', 'сетевые карты и их драйверы']],
    rel: ['lsusb', 'lshw'], docs: 'man 8 lspci'
  }),
  L({
    id: 'lsusb', cat: 'sysinfo', title: 'Устройства USB', cmd: 'lsusb', desc: 'Список подключённых USB-устройств.',
    pkg: 'usbutils', rel: ['lspci', 'dmesg'], docs: 'man 8 lsusb'
  }),
  L({
    id: 'env', cat: 'sysinfo', title: 'Переменные окружения', cmd: 'env',
    desc: 'Список переменных окружения текущего сеанса. printenv ИМЯ — значение одной переменной.',
    ex: [['printenv PATH', 'значение PATH'], ['echo "$HOME"', 'домашний каталог'], ['export HTTP_PROXY=http://proxy:3128', 'задать переменную для текущего сеанса и дочерних процессов']],
    rel: ['export', 'set'], docs: 'man 1 env', tags: ['переменные окружения']
  }),
  L({
    id: 'timedatectl', cat: 'sysinfo', title: 'Дата, время, часовой пояс, синхронизация NTP', cmd: 'timedatectl',
    desc: 'Показывает локальное время, UTC, часовой пояс и статус синхронизации времени (systemd-timesyncd/chrony).',
    ex: [['timedatectl', 'текущее состояние'], ['sudo timedatectl set-timezone Europe/Moscow', 'задать часовой пояс'], ['timedatectl timesync-status', 'подробности синхронизации (только systemd-timesyncd)']],
    rel: ['date', 'chronyc tracking'], docs: 'man 1 timedatectl', tags: ['время', 'ntp', 'часовой пояс']
  }),
  L({
    id: 'last-reboot', cat: 'sysinfo', title: 'История перезагрузок', cmd: 'last -x reboot shutdown | head -20',
    desc: 'Читает /var/log/wtmp и показывает перезагрузки и выключения.',
    compat: 'В Debian 13 last входит в пакет wtmpdb (при необходимости: apt install wtmpdb). Альтернатива: journalctl --list-boots.',
    rel: ['journalctl --list-boots', 'uptime -s'], docs: 'man 1 last'
  }),

  // ===== Файлы и каталоги =====
  L({
    id: 'ls', cat: 'files', title: 'Список файлов и каталогов', cmd: 'ls -lah',
    syntax: 'ls [ПАРАМЕТРЫ] [ПУТЬ…]', desc: 'Показывает содержимое каталога.',
    params: [['-l', 'подробный формат: права, владелец, размер, дата'], ['-a', 'включая скрытые (начинаются с точки)'], ['-h', 'размеры в K/M/G'], ['-t', 'сортировка по времени изменения'], ['-r', 'обратный порядок'], ['-S', 'сортировка по размеру'], ['-d', 'сведения о самом каталоге, а не о содержимом']],
    ex: [['ls -lah /var/log', 'все файлы журнала с размерами'], ['ls -lt /etc | head', 'последние изменённые файлы в /etc'], ['ls -ld /srv/data', 'права самого каталога']],
    out: 'Первый символ прав: - файл, d каталог, l ссылка. Далее права владельца, группы и остальных.',
    rel: ['tree', 'stat', 'find'], docs: 'man 1 ls', tags: ['файлы']
  }),
  L({
    id: 'cd-pwd', cat: 'files', title: 'Переход по каталогам и текущий каталог', cmd: 'pwd',
    desc: 'pwd — текущий каталог; cd — сменить каталог (встроенная команда оболочки).',
    ex: [['cd /etc/nginx', 'перейти в каталог'], ['cd -', 'вернуться в предыдущий каталог'], ['cd ~', 'в домашний каталог']],
    rel: ['ls'], docs: 'man 1 pwd'
  }),
  L({
    id: 'find', cat: 'files', title: 'Поиск файлов', cmd: 'find /etc -name "*.conf"',
    syntax: 'find [ПУТЬ…] [УСЛОВИЯ] [ДЕЙСТВИЯ]', desc: 'Рекурсивный поиск файлов по имени, типу, размеру, времени, владельцу с возможностью выполнить действие.',
    params: [['-name / -iname', 'по имени (с учётом/без учёта регистра), шаблоны в кавычках'], ['-type f|d|l', 'файлы, каталоги, ссылки'], ['-size +100M', 'больше 100 МБ'], ['-mtime -1', 'изменённые за последние сутки'], ['-user ИМЯ', 'по владельцу'], ['-maxdepth N', 'глубина поиска'], ['-exec КОМАНДА {} \\;', 'выполнить команду для каждого найденного'], ['-delete', 'удалить найденное (опасно)']],
    ex: [['find / -xdev -type f -size +500M 2>/dev/null', 'большие файлы на корневой ФС'], ['find /var/log -name "*.gz" -mtime +30', 'старые архивы журналов'], ['find /srv -type f -perm -o+w', 'файлы, доступные на запись всем'], ['find /etc -newer /etc/hostname -type f', 'файлы новее указанного']],
    warn: ['С -delete и -exec rm сначала запустите ту же команду без действия и проверьте список.'],
    rel: ['locate', 'grep -r', 'du'], docs: 'man 1 find', tags: ['поиск файлов', 'найти файл'], tpl: 'find {{DIRECTORY}} -name "{{FILE}}"'
  }),
  L({
    id: 'locate', cat: 'files', title: 'Быстрый поиск по базе имён файлов', cmd: 'locate nginx.conf',
    desc: 'Ищет по заранее построенной базе — очень быстро, но не видит файлы, созданные после последнего обновления базы (updatedb).',
    pkg: 'plocate (или mlocate)', ex: [['sudo updatedb', 'обновить базу'], ['locate -i ssh_config', 'без учёта регистра']],
    rel: ['find'], docs: 'man 1 locate'
  }),
  L({
    id: 'cat', cat: 'files', title: 'Вывод содержимого файла', cmd: 'cat /etc/hosts',
    desc: 'Выводит файл целиком. Для больших файлов используйте less, head, tail.',
    params: [['-n', 'нумерация строк'], ['-A', 'показать непечатаемые символы (табуляции, CR в конце строк)']],
    ex: [['cat -A file.txt | head', 'проверить окончания строк (^M — Windows CRLF)']],
    rel: ['less', 'head', 'tail'], docs: 'man 1 cat'
  }),
  L({
    id: 'less', cat: 'files', title: 'Постраничный просмотр', cmd: 'less /var/log/syslog',
    desc: 'Просмотр с прокруткой и поиском. Клавиши: / — поиск вперёд, n — следующее совпадение, G — в конец, F — следить за ростом файла, q — выход.',
    compat: 'В Debian 12+ и Ubuntu 22.04+ файл /var/log/syslog может отсутствовать, если rsyslog не установлен — используйте journalctl.',
    rel: ['cat', 'tail -f', 'journalctl'], docs: 'man 1 less'
  }),
  L({
    id: 'head', cat: 'files', title: 'Начало файла', cmd: 'head -n 20 /etc/passwd', desc: 'Первые N строк (по умолчанию 10).',
    params: [['-n N', 'число строк'], ['-c N', 'число байт']], rel: ['tail'], docs: 'man 1 head'
  }),
  L({
    id: 'tail', cat: 'files', title: 'Конец файла и слежение за журналом', cmd: 'tail -f /var/log/nginx/error.log',
    desc: 'Последние строки файла; -f — выводить новые строки по мере записи (Ctrl+C для выхода).',
    params: [['-n N', 'число строк'], ['-f', 'следить за файлом'], ['-F', 'следить даже после ротации файла']],
    ex: [['tail -n 100 /var/log/auth.log', 'последние 100 строк журнала авторизаций'], ['tail -F /var/log/nginx/access.log | grep " 500 "', 'следить за ошибками 500']],
    rel: ['journalctl -f', 'less'], docs: 'man 1 tail', tpl: 'tail -n 100 {{FILE}}'
  }),
  L({
    id: 'cp', cat: 'files', title: 'Копирование файлов и каталогов', cmd: 'cp -a /etc/nginx /root/nginx.bak',
    syntax: 'cp [ПАРАМЕТРЫ] ИСТОЧНИК… НАЗНАЧЕНИЕ', desc: 'Копирует файлы и каталоги.',
    params: [['-a', 'архивный режим: рекурсивно с сохранением прав, владельцев, времени и ссылок'], ['-r', 'рекурсивно'], ['-i', 'спрашивать перед перезаписью'], ['-v', 'показывать копируемые файлы'], ['--backup=numbered', 'сохранять перезаписываемые файлы с номерами']],
    ex: [['cp file.conf file.conf.$(date +%F)', 'резервная копия конфига с датой'], ['cp -a /srv/site /srv/site.bak', 'копия каталога с сохранением атрибутов']],
    warn: ['Без -i существующий файл назначения перезаписывается без вопроса.'],
    rel: ['rsync', 'mv'], docs: 'man 1 cp'
  }),
  L({
    id: 'mv', cat: 'files', title: 'Перемещение и переименование', cmd: 'mv old.conf new.conf',
    desc: 'Перемещает или переименовывает файлы и каталоги.', params: [['-i', 'спрашивать перед перезаписью'], ['-n', 'не перезаписывать существующие'], ['-v', 'показывать действия']],
    warn: ['Перемещение поверх существующего файла уничтожает его содержимое.'], rel: ['cp', 'rename'], docs: 'man 1 mv'
  }),
  L({
    id: 'rm', cat: 'files', title: 'Удаление файлов', cmd: 'rm -i file.txt',
    syntax: 'rm [ПАРАМЕТРЫ] ФАЙЛ…', desc: 'Удаляет файлы (и каталоги с -r). Корзины нет — восстановление обычно невозможно.',
    params: [['-i', 'подтверждать каждое удаление'], ['-r', 'рекурсивно (каталоги)'], ['-f', 'без вопросов и без ошибок для несуществующих'], ['-I', 'один вопрос при удалении более трёх файлов']],
    ex: [['rm -i *.tmp', 'удалить временные файлы с подтверждением'], ['rm -rf /tmp/build-123', 'удалить каталог целиком (проверьте путь!)']],
    warn: ['rm -rf с переменной в пути (rm -rf "$DIR"/*) при пустой переменной может удалить не то. Всегда проверяйте путь командой ls.', 'Удалённые файлы, открытые процессом, продолжают занимать место до перезапуска процесса (см. lsof +L1).'],
    risk: 'danger', rel: ['find -delete', 'trash-cli'], docs: 'man 1 rm'
  }),
  L({
    id: 'mkdir', cat: 'files', title: 'Создание каталогов', cmd: 'mkdir -p /srv/backup/daily',
    desc: 'Создаёт каталоги. -p — создать все промежуточные и не выдавать ошибку, если каталог уже есть.',
    params: [['-p', 'с родительскими каталогами'], ['-m 750', 'сразу задать права']], rel: ['rmdir', 'install -d'], docs: 'man 1 mkdir', tpl: 'mkdir -p {{DIRECTORY}}'
  }),
  L({
    id: 'touch', cat: 'files', title: 'Создать пустой файл / обновить время', cmd: 'touch /tmp/test.flag',
    desc: 'Создаёт пустой файл, если его нет, или обновляет время изменения существующего.', rel: ['stat'], docs: 'man 1 touch'
  }),
  L({
    id: 'stat', cat: 'files', title: 'Подробные атрибуты файла', cmd: 'stat /etc/passwd',
    desc: 'Размер, права (в символьном и числовом виде), владелец, inode, время доступа/изменения.',
    ex: [['stat -c "%a %U:%G %n" /etc/shadow', 'права числом и владелец']], rel: ['ls -l', 'file'], docs: 'man 1 stat'
  }),
  L({
    id: 'file', cat: 'files', title: 'Определить тип файла', cmd: 'file /usr/bin/ls',
    desc: 'Определяет тип по содержимому: текст (и кодировку), исполняемый файл, архив, образ и т. д.',
    ex: [['file -i report.txt', 'MIME-тип и кодировка']], rel: ['stat'], docs: 'man 1 file'
  }),
  L({
    id: 'diff', cat: 'files', title: 'Сравнение файлов', cmd: 'diff -u nginx.conf.bak nginx.conf',
    desc: 'Показывает различия между файлами или каталогами. -u — унифицированный формат (как в патчах).',
    params: [['-u', 'унифицированный формат'], ['-r', 'рекурсивно для каталогов'], ['-q', 'только факт различия'], ['-w', 'игнорировать пробелы']],
    out: 'Строки с - есть только в первом файле, с + — только во втором.', rel: ['cmp', 'vimdiff'], docs: 'man 1 diff'
  }),
  L({
    id: 'tree', cat: 'files', title: 'Дерево каталогов', cmd: 'tree -L 2 /etc/nginx',
    desc: 'Показывает структуру каталогов деревом.', pkg: 'tree', params: [['-L N', 'глубина'], ['-a', 'со скрытыми'], ['-d', 'только каталоги'], ['-h', 'с размерами']],
    rel: ['ls', 'find'], docs: 'man 1 tree'
  }),
  L({
    id: 'ln', cat: 'files', title: 'Символические и жёсткие ссылки', cmd: 'ln -s /etc/nginx/sites-available/site.conf /etc/nginx/sites-enabled/',
    desc: 'Создаёт ссылки. -s — символическая (указатель на путь), без -s — жёсткая.',
    params: [['-s', 'символическая ссылка'], ['-f', 'заменить существующую'], ['-n', 'не разыменовывать ссылку-каталог назначения']],
    rel: ['readlink -f', 'ls -l'], docs: 'man 1 ln'
  }),
  L({
    id: 'readlink', cat: 'files', title: 'Куда указывает ссылка', cmd: 'readlink -f /usr/bin/python3',
    desc: 'Показывает конечный путь, на который указывает символическая ссылка.', rel: ['ln', 'realpath'], docs: 'man 1 readlink'
  }),
  L({
    id: 'du', cat: 'files', title: 'Размер каталогов', cmd: 'du -sh /var/* 2>/dev/null | sort -h',
    desc: 'Оценивает занимаемое место. Удобен для поиска, что «съело» диск.',
    params: [['-s', 'итог по каждому аргументу'], ['-h', 'в удобных единицах'], ['-x', 'не переходить на другие ФС'], ['-d N / --max-depth=N', 'глубина']],
    ex: [['du -xh / --max-depth=1 2>/dev/null | sort -h', 'крупные каталоги корневой ФС'], ['du -sh /var/log/journal', 'размер журнала systemd']],
    rel: ['df', 'ncdu', 'find -size'], docs: 'man 1 du', tags: ['место на диске', 'проверка дисков'], tpl: 'du -sh {{DIRECTORY}}'
  }),
  L({
    id: 'ncdu', cat: 'files', title: 'Интерактивный анализ занятого места', cmd: 'ncdu -x /',
    desc: 'Псевдографический анализатор места: навигация стрелками, удаление клавишей d (с подтверждением).',
    pkg: 'ncdu', rel: ['du'], docs: 'man 1 ncdu'
  }),
  L({
    id: 'chattr-lsattr', cat: 'files', title: 'Атрибуты файлов ext4 (неизменяемость)', cmd: 'lsattr /etc/resolv.conf',
    desc: 'lsattr показывает атрибуты; chattr +i делает файл неизменяемым даже для root (снять — chattr -i).',
    ex: [['sudo chattr +i /etc/resolv.conf', 'запретить изменение файла']], warn: ['Неизменяемый файл не смогут изменить и пакетный менеджер, и службы — не забывайте снимать атрибут.'],
    rel: ['stat'], docs: 'man 1 chattr'
  }),

  // ===== Поиск и обработка текста =====
  L({
    id: 'grep', cat: 'text', title: 'Поиск строк по шаблону', cmd: 'grep -rn "listen" /etc/nginx/',
    syntax: 'grep [ПАРАМЕТРЫ] ШАБЛОН [ФАЙЛ…]', desc: 'Ищет строки, соответствующие шаблону (регулярному выражению).',
    params: [['-i', 'без учёта регистра'], ['-r', 'рекурсивно'], ['-n', 'номера строк'], ['-v', 'инвертировать (строки без совпадения)'], ['-E', 'расширенные регулярные выражения'], ['-c', 'только количество'], ['-l', 'только имена файлов'], ['-A/-B/-C N', 'N строк после/до/вокруг совпадения'], ['-w', 'целое слово']],
    ex: [['grep -i "failed password" /var/log/auth.log | tail', 'неудачные входы по SSH'], ['grep -Ev "^\\s*(#|$)" /etc/ssh/sshd_config', 'конфиг без комментариев и пустых строк'], ['ps aux | grep -i [n]ginx', 'процессы nginx (без самого grep)']],
    rel: ['awk', 'sed', 'find'], docs: 'man 1 grep', tags: ['поиск текста'], tpl: 'grep -rn "{{VALUE}}" {{DIRECTORY}}'
  }),
  L({
    id: 'sed', cat: 'text', title: 'Потоковое редактирование текста', cmd: "sed -n '1,20p' /etc/fstab",
    desc: 'Замена и фильтрация текста. С -i изменяет файл на месте.',
    params: [['-n', 'не выводить строки автоматически'], ["'s/старое/новое/g'", 'замена всех вхождений'], ['-i', 'редактировать файл на месте'], ['-i.bak', 'на месте с резервной копией'], ["'/шаблон/d'", 'удалить строки']],
    ex: [["sed 's/^#Port 22/Port 2222/' /etc/ssh/sshd_config | grep Port", 'проверить замену без изменения файла'], ["sudo sed -i.bak 's/old.example.com/new.example.com/g' /etc/app.conf", 'замена в файле с копией .bak']],
    warn: ['sed -i без резервной копии необратим. Сначала проверьте результат без -i.'], rel: ['awk', 'grep'], docs: 'man 1 sed'
  }),
  L({
    id: 'awk', cat: 'text', title: 'Обработка столбцов текста', cmd: "awk -F: '{print $1, $7}' /etc/passwd",
    desc: 'Язык обработки текста по полям. $1, $2… — поля, NR — номер строки, -F — разделитель.',
    ex: [["df -P | awk 'NR>1 && $5+0 > 80 {print $6, $5}'", 'файловые системы, заполненные более чем на 80%'], ["awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head", 'топ IP-адресов по запросам']],
    rel: ['cut', 'sed', 'grep'], docs: 'man 1 awk', compat: 'В Debian/Ubuntu по умолчанию mawk; для расширений GNU установите gawk.'
  }),
  L({
    id: 'sort-uniq', cat: 'text', title: 'Сортировка и подсчёт повторов', cmd: 'sort file.txt | uniq -c | sort -rn',
    desc: 'sort сортирует строки, uniq убирает или считает соседние повторы (поэтому сначала sort).',
    params: [['sort -n', 'числовая'], ['sort -h', 'по размерам 1K, 2M'], ['sort -k2', 'по второму полю'], ['uniq -c', 'с количеством']],
    rel: ['awk', 'wc'], docs: 'man 1 sort'
  }),
  L({
    id: 'cut', cat: 'text', title: 'Выделение полей', cmd: 'cut -d: -f1 /etc/passwd', desc: 'Вырезает поля по разделителю или символы по позициям.',
    params: [['-d', 'разделитель'], ['-f', 'номера полей'], ['-c', 'позиции символов']], rel: ['awk'], docs: 'man 1 cut'
  }),
  L({
    id: 'wc', cat: 'text', title: 'Подсчёт строк, слов, байт', cmd: 'wc -l /var/log/auth.log', desc: 'Считает строки (-l), слова (-w), байты (-c).', rel: ['grep -c'], docs: 'man 1 wc'
  }),
  L({
    id: 'tee', cat: 'text', title: 'Вывод одновременно на экран и в файл', cmd: 'echo "nameserver 1.1.1.1" | sudo tee -a /etc/resolv.conf',
    desc: 'Копирует ввод в файл и на экран. Удобно для записи в файлы с правами root через sudo (sudo echo > файл не работает).',
    params: [['-a', 'дописать, а не перезаписать']], warn: ['Без -a файл перезаписывается.'], rel: ['sudo', 'echo'], docs: 'man 1 tee'
  }),
  L({
    id: 'xargs', cat: 'text', title: 'Передача списка аргументов команде', cmd: 'find /tmp -name "*.log" -print0 | xargs -0 ls -lh',
    desc: 'Формирует командную строку из входного списка. С -0 корректно работает с именами, содержащими пробелы.',
    params: [['-0', 'разделитель — нулевой байт (с find -print0)'], ['-n N', 'по N аргументов'], ['-P N', 'N параллельных процессов'], ['-r', 'не запускать при пустом вводе']],
    rel: ['find -exec'], docs: 'man 1 xargs'
  }),
  L({
    id: 'jq', cat: 'text', title: 'Разбор JSON', cmd: "curl -s http://localhost:9200/_cluster/health | jq .",
    desc: 'Форматирует и фильтрует JSON.', pkg: 'jq', ex: [["jq -r '.items[].name' file.json", 'извлечь поля из массива']], rel: ['curl'], docs: 'man 1 jq'
  }),
  L({
    id: 'iconv', cat: 'text', title: 'Перекодирование текста (CP1251 ↔ UTF-8)', cmd: 'iconv -f cp1251 -t utf-8 in.txt > out.txt',
    desc: 'Преобразует кодировку текста. Полезно для файлов из Windows.', rel: ['file -i', 'dos2unix'], docs: 'man 1 iconv'
  }),
  L({
    id: 'dos2unix', cat: 'text', title: 'Окончания строк Windows → Unix', cmd: 'dos2unix script.sh',
    desc: 'Убирает символы CR (\\r) — частая причина ошибки «/bin/bash^M: bad interpreter» у скриптов, созданных в Windows.',
    pkg: 'dos2unix', rel: ['cat -A', "sed -i 's/\\r$//'"], docs: 'man 1 dos2unix'
  })
];
