import { L } from './_helpers';

export const DISKS_PACKAGES = [
  // ===== Диски и файловые системы =====
  L({
    id: 'df', cat: 'disks', title: 'Свободное место на файловых системах', cmd: 'df -hT -x tmpfs -x devtmpfs',
    desc: 'Размер, занято, свободно и процент заполнения по точкам монтирования. -T — тип ФС, -x — исключить типы.',
    ex: [['df -h /', 'только корневая ФС'], ['df -i', 'заполнение inode (много мелких файлов)'], ['df -P | awk \'NR>1 && $5+0>85\'', 'ФС, заполненные более чем на 85%']],
    out: 'При 100% заполнения службы перестают писать журналы и данные. Если df показывает заполнение, а du — нет, ищите удалённые открытые файлы: lsof +L1.',
    rel: ['du', 'lsblk', 'lsof +L1'], docs: 'man 1 df', tags: ['свободное место', 'проверка свободного пространства', 'проверка дисков']
  }),
  L({
    id: 'lsblk', cat: 'disks', title: 'Блочные устройства', cmd: 'lsblk -f',
    desc: 'Диски и разделы деревом; -f — файловые системы, UUID и точки монтирования.', rel: ['blkid', 'fdisk -l'], docs: 'man 8 lsblk'
  }),
  L({
    id: 'blkid', cat: 'disks', title: 'UUID и тип файловых систем', cmd: 'sudo blkid',
    desc: 'UUID, метки и типы ФС — нужны для /etc/fstab.', root: true, rel: ['lsblk -f'], docs: 'man 8 blkid'
  }),
  L({
    id: 'fdisk-l', cat: 'disks', title: 'Таблицы разделов (просмотр)', cmd: 'sudo fdisk -l',
    desc: 'Показывает диски и разделы. Интерактивный режим fdisk /dev/sdX изменяет таблицу разделов.',
    root: true, warn: ['Изменения в интерактивном fdisk записываются только командой w — до этого можно выйти по q без изменений.'], rel: ['parted -l', 'lsblk'], docs: 'man 8 fdisk'
  }),
  L({
    id: 'parted', cat: 'disks', title: 'Разметка дисков (parted)', cmd: 'sudo parted -l',
    desc: 'Просмотр (-l / print) и изменение разделов, поддержка GPT и дисков >2 ТБ.', root: true,
    ex: [['sudo parted /dev/sdb mklabel gpt', 'создать таблицу GPT (уничтожит существующую!)'], ['sudo parted /dev/sdb mkpart primary ext4 0% 100%', 'раздел на весь диск']],
    warn: ['parted применяет изменения сразу, без отдельной команды записи.'], rel: ['fdisk', 'growpart'], docs: 'man 8 parted'
  }),
  L({
    id: 'mount', cat: 'disks', title: 'Монтирование файловых систем', cmd: 'findmnt',
    desc: 'findmnt — дерево смонтированных ФС с опциями. mount устройство каталог — смонтировать.',
    ex: [['sudo mount /dev/sdb1 /mnt/data', 'смонтировать раздел'], ['sudo mount -a', 'смонтировать всё из /etc/fstab (проверка fstab после правки)'], ['sudo mount -o remount,ro /mnt/data', 'перемонтировать только для чтения'], ['findmnt -T /var/lib/mysql', 'на какой ФС лежит каталог']],
    rel: ['umount', 'fstab'], docs: 'man 8 mount'
  }),
  L({
    id: 'umount', cat: 'disks', title: 'Размонтирование', cmd: 'sudo umount /mnt/data',
    desc: 'Отключает ФС. «target is busy» — каталог кем-то используется (lsof +D /mnt/data или fuser -vm).', root: true, risk: 'danger',
    rel: ['lsof', 'fuser'], docs: 'man 8 umount'
  }),
  L({
    id: 'fstab', cat: 'disks', title: 'Автомонтирование (/etc/fstab)', cmd: 'cat /etc/fstab',
    desc: 'Формат строки: UUID=… /точка ext4 defaults,noatime 0 2. Используйте UUID, а не /dev/sdX (имена могут меняться).',
    ex: [['sudo findmnt --verify', 'проверить fstab на ошибки'], ['sudo mount -a', 'применить без перезагрузки']],
    warn: ['Ошибка в fstab может остановить загрузку в аварийном режиме. Для некритичных дисков добавляйте опцию nofail.'], rel: ['blkid', 'mount'], docs: 'man 5 fstab'
  }),
  L({
    id: 'mkfs', cat: 'disks', title: 'Создание файловой системы', cmd: 'sudo mkfs.ext4 -L data /dev/sdb1',
    desc: 'Форматирует раздел. Варианты: mkfs.ext4, mkfs.xfs, mkfs.vfat.', root: true,
    warn: ['Все данные на разделе будут уничтожены. Трижды проверьте имя устройства (lsblk).'], risk: 'critical', rel: ['lsblk', 'blkid'], docs: 'man 8 mkfs.ext4'
  }),
  L({
    id: 'fsck', cat: 'disks', title: 'Проверка файловой системы', cmd: 'sudo fsck -n /dev/sdb1',
    desc: 'Проверка и исправление ФС. -n — только проверка без изменений. Исправлять можно только размонтированную ФС.',
    root: true, warn: ['Запуск fsck с исправлением на смонтированной ФС может повредить данные.'], rel: ['tune2fs', 'xfs_repair'], docs: 'man 8 fsck'
  }),
  L({
    id: 'smartctl', cat: 'disks', title: 'Состояние диска (S.M.A.R.T.)', cmd: 'sudo smartctl -H -A /dev/sda',
    desc: 'Здоровье диска: -H общий статус, -A атрибуты, -a всё, -t short — короткий самотест.', root: true, pkg: 'smartmontools',
    ex: [['sudo smartctl -a /dev/nvme0', 'NVMe-диск'], ['sudo smartctl -t short /dev/sda', 'запустить короткий тест'], ['sudo smartctl -a -d megaraid,0 /dev/sda', 'диск за RAID-контроллером MegaRAID']],
    out: 'Тревожные атрибуты: Reallocated_Sector_Ct, Current_Pending_Sector, Offline_Uncorrectable (ненулевые и растущие значения), для NVMe — Percentage Used и Media and Data Integrity Errors.',
    compat: 'На виртуальных машинах SMART обычно недоступен.', rel: ['dmesg', 'badblocks'], docs: 'man 8 smartctl', tags: ['проверка состояния дисков', 'smart']
  }),
  L({
    id: 'lvm-show', cat: 'disks', title: 'LVM: обзор томов', cmd: 'sudo lvs && sudo vgs && sudo pvs',
    desc: 'pvs — физические тома, vgs — группы томов (свободное место VFree), lvs — логические тома.', root: true, pkg: 'lvm2',
    rel: ['lvextend', 'pvdisplay'], docs: 'man 8 lvm', tags: ['lvm']
  }),
  L({
    id: 'lvextend', cat: 'disks', title: 'LVM: увеличение тома вместе с ФС', cmd: 'sudo lvextend -r -L +10G /dev/vg0/data',
    desc: 'Увеличивает логический том; -r — сразу расширяет файловую систему (ext4, xfs).', root: true, pkg: 'lvm2',
    ex: [['sudo lvextend -r -l +100%FREE /dev/vg0/data', 'на всё свободное место группы']], verify: 'df -h', rel: ['vgs', 'resize2fs', 'xfs_growfs'], docs: 'man 8 lvextend'
  }),
  L({
    id: 'growpart', cat: 'disks', title: 'Расширение раздела после увеличения виртуального диска', cmd: 'sudo growpart /dev/sda 1',
    desc: 'Расширяет раздел на освободившееся место (после увеличения диска в гипервизоре). Затем расширьте ФС: resize2fs или xfs_growfs.',
    root: true, pkg: 'cloud-guest-utils', ex: [['sudo resize2fs /dev/sda1', 'расширить ext4'], ['sudo xfs_growfs /', 'расширить xfs (по точке монтирования)']],
    rel: ['lvextend', 'lsblk'], docs: 'man 1 growpart'
  }),
  L({
    id: 'mdadm', cat: 'disks', title: 'Программный RAID (mdadm)', cmd: 'cat /proc/mdstat',
    desc: 'Состояние программных RAID-массивов. [UU] — оба диска в строю, [U_] — массив деградировал.', pkg: 'mdadm',
    ex: [['sudo mdadm --detail /dev/md0', 'подробно о массиве'], ['sudo mdadm --manage /dev/md0 --add /dev/sdc1', 'добавить диск взамен вышедшего']],
    rel: ['smartctl', 'lsblk'], docs: 'man 8 mdadm', tags: ['raid']
  }),
  L({
    id: 'swap', cat: 'disks', title: 'Swap: состояние', cmd: 'swapon --show',
    desc: 'Активные области подкачки. Создание файла подкачки: fallocate, chmod 600, mkswap, swapon и строка в fstab.',
    ex: [['sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile', 'создать и включить swap-файл 2 ГБ'], ['cat /proc/sys/vm/swappiness', 'склонность к подкачке']],
    rel: ['free'], docs: 'man 8 swapon'
  }),
  L({
    id: 'dd', cat: 'backup', title: 'Побайтовое копирование (dd)', cmd: 'sudo dd if=/dev/sda of=/mnt/backup/sda.img bs=4M status=progress conv=fsync',
    desc: 'Копирование дисков и образов. if — откуда, of — куда.', root: true,
    warn: ['Перепутанные if и of уничтожат данные источника. Для of=/dev/… приложение помечает команду как критическую.'],
    risk: 'danger', rel: ['lsblk', 'rsync'], docs: 'man 1 dd'
  }),

  // ===== Пакеты и обновления =====
  L({
    id: 'apt-update', cat: 'packages', title: 'Обновить списки пакетов', cmd: 'sudo apt update',
    desc: 'Скачивает свежие списки пакетов из репозиториев. Сами пакеты не обновляются. Выводит, сколько пакетов можно обновить.',
    root: true, rel: ['apt list --upgradable', 'apt upgrade'], docs: 'man 8 apt', tags: ['проверка обновлений']
  }),
  L({
    id: 'apt-upgradable', cat: 'packages', title: 'Какие пакеты можно обновить', cmd: 'apt list --upgradable',
    desc: 'Список пакетов с доступными обновлениями (по последнему apt update). Ничего не меняет.', rel: ['apt update', 'apt upgrade'], docs: 'man 8 apt', tags: ['проверка обновлений']
  }),
  L({
    id: 'apt-upgrade', cat: 'packages', title: 'Обновить установленные пакеты', cmd: 'sudo apt upgrade',
    desc: 'Обновляет пакеты без удаления существующих. full-upgrade — с разрешением зависимостей (может удалять пакеты).',
    root: true, ex: [['sudo apt upgrade -s', 'пробный прогон: что будет обновлено'], ['sudo apt full-upgrade', 'полное обновление (внимательно читайте список удаляемого)']],
    warn: ['Обновление может перезапустить службы (needrestart) и потребовать перезагрузку (файл /var/run/reboot-required).'], rel: ['apt update', 'needrestart'], docs: 'man 8 apt'
  }),
  L({
    id: 'apt-install', cat: 'packages', title: 'Установка пакета', cmd: 'sudo apt install htop',
    desc: 'Устанавливает пакет с зависимостями. --no-install-recommends — без рекомендуемых пакетов.', root: true,
    ex: [['sudo apt install ./package.deb', 'установка локального .deb с зависимостями'], ['sudo apt install --reinstall openssh-server', 'переустановить пакет']],
    rel: ['apt search', 'dpkg -i'], docs: 'man 8 apt', tpl: 'sudo apt install {{VALUE}}'
  }),
  L({
    id: 'apt-remove', cat: 'packages', title: 'Удаление пакета', cmd: 'sudo apt remove apache2',
    desc: 'remove — удалить пакет, оставив конфигурацию; purge — вместе с конфигурацией; autoremove — ненужные зависимости.',
    root: true, ex: [['sudo apt purge apache2', 'удалить вместе с конфигурацией'], ['sudo apt autoremove', 'удалить неиспользуемые зависимости (проверьте список!)']],
    warn: ['apt может предложить удалить зависимые пакеты — читайте список перед подтверждением.'], risk: 'danger', rel: ['dpkg -r'], docs: 'man 8 apt'
  }),
  L({
    id: 'apt-search', cat: 'packages', title: 'Поиск пакета в репозиториях', cmd: 'apt search nginx',
    desc: 'Поиск по имени и описанию. apt show — подробности о пакете, apt policy — версии и откуда устанавливается.',
    ex: [['apt show nginx', 'описание и зависимости'], ['apt policy nginx', 'установленная и доступные версии, приоритеты репозиториев']], rel: ['apt-cache'], docs: 'man 8 apt'
  }),
  L({
    id: 'apt-cache', cat: 'packages', title: 'Сведения из кэша APT', cmd: 'apt-cache depends nginx',
    desc: 'Зависимости (depends), обратные зависимости (rdepends), политика версий (policy).', rel: ['apt show'], docs: 'man 8 apt-cache'
  }),
  L({
    id: 'dpkg-l', cat: 'packages', title: 'Установленные пакеты', cmd: 'dpkg -l | grep -i ssh',
    desc: 'Список пакетов dpkg. ii — установлен, rc — удалён, но остались конфиги.',
    ex: [["dpkg-query -W -f='${Package} ${Version}\\n' openssh-server", 'версия пакета'], ['dpkg -L openssh-server', 'файлы пакета'], ['dpkg -S /usr/sbin/sshd', 'к какому пакету относится файл']],
    rel: ['apt list --installed'], docs: 'man 1 dpkg-query', tags: ['поиск установленных программ']
  }),
  L({
    id: 'dpkg-i', cat: 'packages', title: 'Установка .deb-файла (dpkg)', cmd: 'sudo dpkg -i package.deb',
    desc: 'Устанавливает локальный пакет без загрузки зависимостей. Если зависимостей не хватает — sudo apt -f install.', root: true, rel: ['apt install ./file.deb'], docs: 'man 1 dpkg'
  }),
  L({
    id: 'apt-fix', cat: 'packages', title: 'Исправление прерванной установки', cmd: 'sudo dpkg --configure -a',
    desc: 'Довершает настройку пакетов после прерванной операции. Затем sudo apt -f install — доустановить недостающие зависимости.',
    root: true, ex: [['sudo apt -f install', 'исправить зависимости'], ['sudo apt clean', 'очистить кэш загруженных пакетов']],
    warn: ['Ошибку «Could not get lock /var/lib/dpkg/lock» обычно вызывает работающий apt или unattended-upgrades — дождитесь завершения, не удаляйте lock-файлы.'],
    rel: ['apt'], docs: 'man 1 dpkg', tags: ['устранение проблем пакетного менеджера']
  }),
  L({
    id: 'sources', cat: 'packages', title: 'Источники репозиториев', cmd: 'grep -rhE "^(deb|URIs|Suites)" /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null',
    desc: 'Подключённые репозитории. В Debian 12+/Ubuntu 24.04+ используется формат deb822 (*.sources).',
    rel: ['apt policy'], docs: 'man 5 sources.list', tags: ['проверка источников репозиториев']
  }),
  L({
    id: 'apt-history', cat: 'packages', title: 'История операций APT', cmd: 'less /var/log/apt/history.log',
    desc: 'Что, когда и кем устанавливалось или удалялось через apt.', rel: ['dpkg.log'], docs: 'man 8 apt'
  }),
  L({
    id: 'unattended', cat: 'packages', title: 'Автоматические обновления безопасности', cmd: 'sudo unattended-upgrade --dry-run -d',
    desc: 'Проверка работы автоматических обновлений. Настройка — /etc/apt/apt.conf.d/50unattended-upgrades и 20auto-upgrades.',
    pkg: 'unattended-upgrades', root: true, ex: [['sudo dpkg-reconfigure -plow unattended-upgrades', 'включить автообновления'], ['ls /var/log/unattended-upgrades/', 'журналы']],
    rel: ['apt'], docs: 'man 8 unattended-upgrade'
  }),
  L({
    id: 'reboot-required', cat: 'packages', title: 'Нужна ли перезагрузка после обновлений', cmd: 'cat /var/run/reboot-required 2>/dev/null || echo "Перезагрузка не требуется"',
    desc: 'Файл создаётся после обновления ядра и ключевых библиотек. reboot-required.pkgs — какие пакеты этого требуют.',
    ex: [['sudo needrestart -r l', 'какие службы используют устаревшие библиотеки (пакет needrestart)']], rel: ['needrestart'], docs: 'man 8 needrestart'
  }),
  L({
    id: 'apt-hold', cat: 'packages', title: 'Запретить обновление пакета', cmd: 'sudo apt-mark hold docker-ce',
    desc: 'Фиксирует версию пакета. unhold — снять фиксацию, showhold — список.', root: true, rel: ['apt policy'], docs: 'man 8 apt-mark'
  })
];
