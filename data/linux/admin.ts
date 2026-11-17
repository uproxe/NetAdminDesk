// Типовые задачи администратора Linux и решение частых проблем — с пояснениями для начинающих.
import { L } from './_helpers';

export const LINUX_ADMIN = [
  // ===== Решение типовых проблем =====
  L({
    id: 't-disk-full', cat: 'troubleshoot', basic: true, title: 'Закончилось место на диске: что делать', cmd: 'df -h && sudo du -xh / --max-depth=1 2>/dev/null | sort -h | tail',
    desc: 'Сначала найдите заполненный раздел (df -h, Use% около 100%), затем — самый большой каталог (du, спускаясь глубже). Частые причины: журналы (/var/log, journalctl), кэш пакетов (sudo apt clean), образы Docker (docker system df), старые резервные копии, удалённые, но открытые файлы (sudo lsof +L1).',
    ex: [['sudo journalctl --vacuum-size=200M', 'уменьшить журнал systemd до 200 МБ'], ['sudo apt clean', 'очистить кэш пакетов'], ['sudo lsof +L1', 'удалённые файлы, которые всё ещё занимают место (помогает перезапуск службы)']],
    tags: ['закончилось место', 'диск заполнен', 'no space left on device', 'нет места']
  }),
  L({
    id: 't-inodes', cat: 'troubleshoot', title: 'Место есть, но «No space left» (кончились inode)', cmd: 'df -i',
    desc: 'Если df -h показывает свободное место, а файлы не создаются — закончились inode (записи о файлах). Обычно виноваты миллионы мелких файлов (сессии PHP, кэш, почтовая очередь). Найти каталог: sudo find / -xdev -type d -size +1M.',
    tags: ['inode', 'no space left', 'много файлов']
  }),
  L({
    id: 't-high-load', cat: 'troubleshoot', basic: true, title: 'Сервер тормозит: кто нагружает', cmd: 'top -o %CPU',
    desc: 'В top смотрите: load average (сравнивайте с числом ядер — nproc), %CPU у процессов, wa (ожидание диска) в строке %Cpu, свободную память (MiB Mem avail) и swap. Клавиши top: M — сортировать по памяти, P — по процессору, k — завершить процесс, q — выход.',
    ex: [['ps aux --sort=-%mem | head', 'кто больше всего ест памяти'], ['sudo iotop -o', 'кто нагружает диск']], tags: ['тормозит', 'медленно работает', 'высокая нагрузка', 'зависает']
  }),
  L({
    id: 't-oom', cat: 'troubleshoot', title: 'Процесс убит из-за нехватки памяти (OOM)', cmd: 'sudo dmesg -T | grep -iE "out of memory|killed process"',
    desc: 'Если служба внезапно падает — проверьте, не завершило ли её ядро из-за нехватки памяти. Решения: добавить память или swap, ограничить потребление службы, найти утечку.', tags: ['oom', 'нехватка памяти', 'служба падает', 'killed']
  }),
  L({
    id: 't-add-swap', cat: 'troubleshoot', title: 'Добавить файл подкачки (swap) 2 ГБ', cmd: 'sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile',
    desc: 'Создаёт и включает swap-файл. Чтобы работал после перезагрузки, добавьте в /etc/fstab строку: /swapfile none swap sw 0 0. Проверка — free -h.', tags: ['swap', 'подкачка', 'мало памяти']
  }),
  L({
    id: 't-site-down', cat: 'troubleshoot', basic: true, title: 'Сайт не открывается: проверка по шагам', cmd: 'systemctl status nginx --no-pager; sudo ss -tlnp | grep -E ":80|:443"; curl -I http://localhost',
    desc: '1) Служба веб-сервера запущена? 2) Порт 80/443 слушается? 3) Отвечает ли сайт на самом сервере (curl localhost)? Если локально работает, а снаружи нет — firewall (sudo ufw status), DNS имени сайта, маршрут. Если не работает и локально — журнал ошибок (/var/log/nginx/error.log) и проверка конфига (sudo nginx -t).',
    tags: ['сайт не открывается', 'не работает сайт', '502', '504', 'веб-сервер']
  }),
  L({
    id: 't-ssh-cant', cat: 'troubleshoot', title: 'Не пускает по SSH: проверка на сервере', cmd: 'sudo systemctl status ssh --no-pager; sudo ss -tlnp | grep ssh; sudo tail -n 30 /var/log/auth.log',
    desc: 'Выполните из консоли хостинга/гипервизора. Проверьте, что служба запущена и слушает порт, посмотрите в auth.log причину отказа (неверный пароль, запрещён root, ключ). Также: sudo ufw status, sudo fail2ban-client status sshd (не заблокирован ли ваш IP).',
    tags: ['не подключается ssh', 'connection refused', 'connection reset', 'нет доступа по ssh']
  }),
  L({
    id: 't-fail2ban-unban', cat: 'firewall', basic: true, title: 'Разблокировать IP в fail2ban', cmd: 'sudo fail2ban-client set sshd unbanip 203.0.113.10',
    desc: 'Если после нескольких неверных паролей ваш IP заблокирован, fail2ban отбрасывает подключения (часто выглядит как «Connection reset»). Посмотреть заблокированные: sudo fail2ban-client status sshd.', tags: ['разбанить', 'fail2ban', 'заблокирован ip', 'unban']
  }),
  L({
    id: 't-readonly-fs', cat: 'troubleshoot', title: 'Файловая система стала «только для чтения»', cmd: 'sudo dmesg -T | grep -iE "error|read-only|ext4|xfs" | tail -30',
    desc: 'Ядро переводит раздел в read-only при ошибках диска или ФС. Посмотрите ошибки в dmesg и состояние диска (smartctl). Исправление — fsck на отмонтированном разделе (обычно с LiveCD или в режиме восстановления). Сначала сделайте резервную копию важных данных.',
    warn: ['Не запускайте fsck на смонтированном разделе.'], tags: ['read-only file system', 'только чтение', 'ошибки диска']
  }),
  L({
    id: 't-dns-broken', cat: 'troubleshoot', title: 'Не работает DNS (имена не разрешаются)', cmd: 'resolvectl status; dig ya.ru; dig @8.8.8.8 ya.ru',
    desc: 'Если dig @8.8.8.8 работает, а просто dig — нет, неисправен или недоступен ваш DNS-сервер. Проверьте nameserver в /etc/resolv.conf или в настройках сети (netplan/interfaces), доступность DNS-сервера (ping), firewall для порта 53.', tags: ['не работает dns', 'temporary failure in name resolution', 'имя не разрешается']
  }),
  L({
    id: 't-time-wrong', cat: 'troubleshoot', title: 'Время на сервере неверное', cmd: 'timedatectl',
    desc: 'System clock synchronized: no — синхронизация не работает. Включите: sudo timedatectl set-ntp true; укажите серверы NTP в /etc/systemd/timesyncd.conf; проверьте доступность NTP-сервера (UDP 123). Неверное время ломает вход в домен, сертификаты и журналы.', tags: ['неверное время', 'время отстает', 'часы спешат']
  }),
  L({
    id: 't-root-password', cat: 'troubleshoot', title: 'Забыт пароль root: восстановление (общий порядок)', cmd: '# GRUB: e → в строке linux добавить init=/bin/bash → Ctrl+X → mount -o remount,rw / → passwd root → exec /sbin/init',
    desc: 'Нужен физический доступ или консоль гипервизора. При загрузке в меню GRUB нажмите e, в конце строки, начинающейся с linux, допишите init=/bin/bash, загрузитесь (Ctrl+X или F10), перемонтируйте корень на запись, задайте пароль и перезагрузитесь. На зашифрованных дисках потребуется пароль шифрования.',
    warn: ['Выполняйте только на своих серверах. Действие фиксируется в журналах безопасности.'], tags: ['забыл пароль root', 'сброс пароля root', 'восстановление пароля']
  }),
  L({
    id: 't-too-many-files', cat: 'troubleshoot', title: 'Ошибка «Too many open files»', cmd: 'ulimit -n; cat /proc/$(pidof -s nginx)/limits | grep "open files"',
    desc: 'Процессу не хватает лимита открытых файлов. Для службы systemd лимит задаётся в override: sudo systemctl edit имя → [Service] LimitNOFILE=65535 → перезапуск службы.', tags: ['too many open files', 'ulimit', 'лимит файлов']
  }),
  L({
    id: 't-kill-hung', cat: 'troubleshoot', basic: true, title: 'Завис процесс: завершить принудительно', cmd: 'pkill -9 -f имя_процесса',
    desc: 'Сначала попробуйте обычное завершение (kill PID или pkill имя) — программа успеет сохранить данные. -9 убивает немедленно. Если завис терминал — Ctrl+C; если зависла SSH-сессия — нажмите Enter, затем ~ и . (тильда, точка).',
    warn: ['kill -9 не даёт программе сохранить данные. Не применяйте к базам данных без необходимости.'], tags: ['убить процесс', 'завис', 'kill -9']
  }),
  L({
    id: 't-what-changed', cat: 'troubleshoot', title: 'Что меняли на сервере недавно', cmd: 'last -n 20; grep " install \\| upgrade \\| remove " /var/log/dpkg.log | tail -20; sudo find /etc -mtime -2 -type f',
    desc: 'Кто входил, какие пакеты ставились/обновлялись и какие файлы настроек менялись за 2 дня. Помогает понять причину внезапной поломки.', tags: ['что изменилось', 'кто заходил', 'что обновлялось']
  }),
  L({
    id: 't-port-busy', cat: 'troubleshoot', title: 'Служба пишет «Address already in use»', cmd: 'sudo ss -tlnp | grep ":8080"',
    desc: 'Порт уже занят другой программой. Найдите её (ss или lsof -i :порт) и остановите, либо смените порт в настройках службы.', tags: ['address already in use', 'порт занят']
  }),

  // ===== Веб-серверы =====
  L({ id: 'w-nginx-reload', cat: 'nginx', basic: true, title: 'Применить новые настройки nginx', cmd: 'sudo nginx -t && sudo systemctl reload nginx', desc: 'Сначала проверка конфигурации (должно быть «syntax is ok» и «test is successful»), затем мягкая перезагрузка без разрыва соединений. Если проверка не прошла — reload не выполнится, сайт продолжит работать на старых настройках.', tags: ['применить настройки nginx', 'перечитать конфиг'] }),
  L({ id: 'w-nginx-site', cat: 'nginx', title: 'Включить сайт nginx (sites-enabled)', cmd: 'sudo ln -s /etc/nginx/sites-available/site.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx', desc: 'В Debian/Ubuntu конфиги сайтов лежат в sites-available, а включаются ссылкой в sites-enabled. Отключить — удалить ссылку и reload.', tags: ['включить сайт', 'новый сайт nginx'] }),
  L({ id: 'w-nginx-access', cat: 'nginx', title: 'Кто заходит на сайт (журнал доступа)', cmd: 'sudo tail -f /var/log/nginx/access.log', desc: 'Каждая строка — запрос: IP клиента, время, адрес страницы, код ответа (200 — ок, 404 — не найдено, 500/502 — ошибка сервера).', tags: ['журнал доступа', 'access log', 'кто заходит'] }),
  L({ id: 'w-apache-restart', cat: 'apache', basic: true, title: 'Перезапустить Apache', cmd: 'sudo apache2ctl configtest && sudo systemctl restart apache2', desc: 'Проверка конфигурации и перезапуск. В CentOS/RHEL служба называется httpd: sudo systemctl restart httpd. Мягко перечитать настройки — reload вместо restart.', tags: ['перезапустить апач', 'restart apache', 'апач'] }),
  L({ id: 'w-apache-mod', cat: 'apache', title: 'Включить модуль Apache', cmd: 'sudo a2enmod rewrite && sudo systemctl reload apache2', desc: 'Включает модуль (rewrite, ssl, headers, proxy). Отключить — a2dismod. Список включённых — apache2ctl -M.', tags: ['модуль apache', 'mod_rewrite'] }),
  L({ id: 'w-apache-status', cat: 'apache', basic: true, title: 'Работает ли Apache', cmd: 'systemctl status apache2 --no-pager', desc: 'Состояние веб-сервера Apache. В CentOS/RHEL — systemctl status httpd.', tags: ['апач работает', 'статус apache'] }),
  L({ id: 'w-php-version', cat: 'web', title: 'Версия PHP и PHP-FPM', cmd: 'php -v; systemctl list-units "php*-fpm*" --no-pager', desc: 'Версия PHP в консоли и запущенные службы PHP-FPM (через них nginx выполняет PHP).', tags: ['php', 'версия php'] }),
  L({ id: 'w-cert-expire', cat: 'web', basic: true, title: 'Когда истекает SSL-сертификат сайта', cmd: 'echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -dates', desc: 'notAfter — дата окончания сертификата. Для файла сертификата: openssl x509 -in cert.pem -noout -enddate.', tags: ['сертификат истекает', 'срок сертификата', 'ssl'] }),
  L({ id: 'w-certbot-renew', cat: 'web', title: 'Продлить сертификаты Let’s Encrypt', cmd: 'sudo certbot renew --dry-run', desc: '--dry-run проверяет, что продление сработает, ничего не меняя. Без него — реальное продление. Обычно продление идёт автоматически по таймеру certbot.timer.', tags: ['продлить сертификат', 'letsencrypt', 'certbot'] }),

  // ===== Базы данных =====
  L({ id: 'db-mysql-login', cat: 'mysql', basic: true, title: 'Войти в MySQL / MariaDB', cmd: 'sudo mysql', desc: 'В Debian/Ubuntu root входит в MySQL без пароля через sudo. С паролем — mysql -u пользователь -p (пароль спросит). Выход — exit. Команды SQL заканчиваются точкой с запятой.', tags: ['войти в mysql', 'консоль mysql', 'мускул'] }),
  L({ id: 'db-mysql-dbs', cat: 'mysql', basic: true, title: 'Список баз данных MySQL', cmd: 'sudo mysql -e "SHOW DATABASES;"', desc: 'Показывает базы данных. Таблицы базы — sudo mysql -e "SHOW TABLES;" имя_базы.', tags: ['список баз', 'show databases'] }),
  L({ id: 'db-mysql-create', cat: 'mysql', title: 'Создать базу и пользователя MySQL', cmd: "sudo mysql -e \"CREATE DATABASE app CHARACTER SET utf8mb4; CREATE USER 'app'@'localhost' IDENTIFIED BY 'СЛОЖНЫЙ_ПАРОЛЬ'; GRANT ALL ON app.* TO 'app'@'localhost';\"", desc: 'Создаёт базу app и пользователя с полными правами только на неё. Подставьте свой пароль.', warn: ['Пароль в командной строке остаётся в истории. Удобнее выполнить команды внутри sudo mysql.'], tags: ['создать базу', 'создать пользователя mysql'] }),
  L({ id: 'db-mysql-restore', cat: 'mysql', title: 'Восстановить базу MySQL из дампа', cmd: 'sudo mysql app < app-2026-11-17.sql', desc: 'Загружает SQL-дамп в существующую базу app. Сжатый дамп: zcat dump.sql.gz | sudo mysql app.', warn: ['Данные в базе будут перезаписаны таблицами из дампа.'], tags: ['восстановить базу', 'загрузить дамп'] }),
  L({ id: 'db-pg-login', cat: 'postgresql', basic: true, title: 'Войти в PostgreSQL', cmd: 'sudo -u postgres psql', desc: 'Вход под системным пользователем postgres. Полезное внутри psql: \\l — базы, \\c имя — подключиться к базе, \\dt — таблицы, \\du — пользователи, \\q — выход.', tags: ['войти в postgres', 'psql', 'постгрес'] }),
  L({ id: 'db-pg-restore', cat: 'postgresql', title: 'Восстановить базу PostgreSQL из дампа', cmd: 'sudo -u postgres pg_restore -d app app.dump', desc: 'Для дампа формата custom (-Fc). Обычный SQL-дамп: sudo -u postgres psql app < app.sql.', tags: ['восстановить базу postgres'] }),
  L({ id: 'db-redis-ping', cat: 'netservices', title: 'Проверить Redis', cmd: 'redis-cli ping', desc: 'Ответ PONG — Redis работает. redis-cli info memory — использование памяти.', tags: ['redis', 'редис'] }),

  // ===== Docker =====
  L({ id: 'd-run', cat: 'docker', basic: true, title: 'Запустить контейнер', cmd: 'docker run -d --name web -p 8080:80 --restart unless-stopped nginx', desc: '-d — в фоне, --name — имя, -p 8080:80 — порт сервера 8080 → порт контейнера 80, --restart unless-stopped — поднимать после перезагрузки. Образ скачается автоматически.', tags: ['запустить контейнер', 'docker run', 'докер'] }),
  L({ id: 'd-stop', cat: 'docker', basic: true, title: 'Остановить и удалить контейнер', cmd: 'docker stop web && docker rm web', desc: 'stop останавливает, rm удаляет контейнер (данные внутри контейнера пропадут, тома — останутся). Запустить остановленный — docker start web.', tags: ['остановить контейнер', 'удалить контейнер'] }),
  L({ id: 'd-pull', cat: 'docker', title: 'Скачать / обновить образ', cmd: 'docker pull nginx:latest', desc: 'Загружает образ. Список образов — docker images.', tags: ['образ', 'скачать образ'] }),
  L({ id: 'd-compose-up', cat: 'docker', basic: true, title: 'Запустить проект docker compose', cmd: 'docker compose up -d', desc: 'Запускает все контейнеры из docker-compose.yml (compose.yaml) текущего каталога в фоне. Остановить и удалить — docker compose down. Обновить образы и перезапустить — docker compose pull && docker compose up -d.', tags: ['docker compose', 'компоуз', 'запустить проект'] }),
  L({ id: 'd-compose-logs', cat: 'docker', title: 'Журналы контейнеров compose', cmd: 'docker compose logs -f --tail 100', desc: 'Последние 100 строк журналов всех служб проекта и новые строки по мере появления (Ctrl+C — выход).', tags: ['логи контейнеров'] }),
  L({ id: 'd-shell', cat: 'docker', basic: true, title: 'Зайти внутрь контейнера', cmd: 'docker exec -it web sh', desc: 'Открывает оболочку внутри работающего контейнера (bash, если он есть; иначе sh). Выход — exit (контейнер продолжит работать).', tags: ['зайти в контейнер', 'консоль контейнера'] }),
  L({ id: 'd-install', cat: 'docker', title: 'Установить Docker (Debian/Ubuntu)', cmd: 'sudo apt install -y docker.io docker-compose-v2', desc: 'Docker из репозитория дистрибутива. Чтобы запускать docker без sudo: sudo usermod -aG docker $USER и перелогиниться (это даёт права, равные root).', compat: 'Ubuntu 22.04+; в Debian пакет compose может называться docker-compose', tags: ['установить docker'] }),

  // ===== Git, Python и другое =====
  L({ id: 'dev-git-clone', cat: 'dev', basic: true, title: 'Скачать репозиторий Git', cmd: 'git clone https://github.com/user/repo.git', desc: 'Скачивает репозиторий в новый каталог. Обновить потом — git pull в этом каталоге. Пакет git.', pkg: 'git', tags: ['git', 'гит', 'скачать репозиторий'] }),
  L({ id: 'dev-git-status', cat: 'dev', title: 'Что изменено в репозитории Git', cmd: 'git status && git log --oneline -10', desc: 'Изменённые файлы и последние 10 коммитов. Отменить локальные изменения файла — git checkout -- файл (git restore файл).', tags: ['git status', 'изменения'] }),
  L({ id: 'dev-python', cat: 'dev', basic: true, title: 'Версия Python и запуск скрипта', cmd: 'python3 --version && python3 script.py', desc: 'В современных системах команда — python3. Пакеты ставятся в виртуальное окружение: python3 -m venv venv; . venv/bin/activate; pip install имя.', tags: ['python', 'питон', 'запустить скрипт python'] }),
  L({ id: 'dev-http-server', cat: 'dev', title: 'Быстро раздать файлы по HTTP', cmd: 'python3 -m http.server 8000', desc: 'Раздаёт текущий каталог по адресу http://сервер:8000 — удобно забрать файл с сервера браузером. Остановить — Ctrl+C. Не оставляйте запущенным.', warn: ['Каталог будет доступен всем, кто может подключиться к порту.'], tags: ['раздать файлы', 'http сервер', 'забрать файл'] }),
  L({ id: 'dev-java', cat: 'dev', title: 'Версия Java', cmd: 'java -version', desc: 'Установленная версия Java. Несколько версий переключаются: sudo update-alternatives --config java.', tags: ['java', 'джава'] }),
  L({ id: 'dev-node', cat: 'dev', title: 'Версия Node.js и npm', cmd: 'node -v && npm -v', desc: 'Версии Node.js и менеджера пакетов npm.', tags: ['node', 'npm', 'нода'] }),

  // ===== Firewall: простые действия =====
  L({ id: 'f-ufw-enable', cat: 'firewall', basic: true, title: 'Включить firewall UFW (не потеряв SSH)', cmd: 'sudo ufw allow OpenSSH && sudo ufw enable', desc: 'Сначала разрешите SSH, затем включите UFW — иначе удалённый доступ пропадёт. Проверка — sudo ufw status verbose.', warn: ['Без правила для SSH после включения вы потеряете доступ к удалённому серверу.'], tags: ['включить фаервол', 'ufw', 'брандмауэр'] }),
  L({ id: 'f-ufw-port', cat: 'firewall', basic: true, title: 'Открыть порт в UFW', cmd: 'sudo ufw allow 443/tcp', desc: 'Открывает порт для всех. Только для своей сети: sudo ufw allow from 192.168.1.0/24 to any port 22. Закрыть — sudo ufw deny 443/tcp.', tags: ['открыть порт', 'разрешить порт'] }),
  L({ id: 'f-ufw-delete', cat: 'firewall', title: 'Удалить правило UFW', cmd: 'sudo ufw status numbered', desc: 'Покажет правила с номерами; затем удалить нужное: sudo ufw delete НОМЕР.', tags: ['удалить правило', 'ufw delete'] }),
  L({ id: 'f-firewalld', cat: 'firewall', title: 'Открыть порт в firewalld (CentOS/RHEL)', cmd: 'sudo firewall-cmd --permanent --add-port=443/tcp && sudo firewall-cmd --reload', desc: 'В семействе Red Hat вместо UFW используется firewalld. Список правил — sudo firewall-cmd --list-all.', compat: 'CentOS, RHEL, Rocky, AlmaLinux, РЕД ОС', tags: ['firewalld', 'firewall-cmd', 'centos порт'] }),
  L({ id: 'f-ssh-root', cat: 'firewall', title: 'Запретить вход root по SSH', cmd: 'sudo nano /etc/ssh/sshd_config.d/10-local.conf', desc: 'Добавьте строку PermitRootLogin no (и при входе по ключам — PasswordAuthentication no). Проверьте: sudo sshd -t; примените: sudo systemctl reload ssh. Перед этим убедитесь, что можете войти обычным пользователем с sudo.', warn: ['Не закрывайте текущую сессию, пока не проверите вход в новом окне.'], tags: ['запретить root', 'безопасность ssh', 'permitrootlogin'] }),

  // ===== Виртуализация =====
  L({ id: 'v-detect', cat: 'virt', basic: true, title: 'Это виртуальная машина или физический сервер', cmd: 'systemd-detect-virt', desc: 'none — физический сервер; kvm, vmware, microsoft (Hyper-V), oracle, lxc — тип виртуализации/контейнера.', tags: ['виртуальная машина', 'физический сервер', 'гипервизор'] }),
  L({ id: 'v-virsh-list', cat: 'virt', title: 'Виртуальные машины KVM (virsh)', cmd: 'sudo virsh list --all', desc: 'Список ВМ на хосте KVM/libvirt. Запустить — virsh start имя, корректно выключить — virsh shutdown имя, принудительно — virsh destroy имя.', tags: ['kvm', 'virsh', 'виртуалки'] }),
  L({ id: 'v-qm-list', cat: 'virt', title: 'Виртуальные машины Proxmox (qm, pct)', cmd: 'sudo qm list && sudo pct list', desc: 'ВМ (qm) и контейнеры LXC (pct) на узле Proxmox VE. Запуск — qm start ID, выключение — qm shutdown ID.', compat: 'Proxmox VE', tags: ['proxmox', 'проксмокс', 'qm'] }),

  // ===== Почта и прочие службы =====
  L({ id: 'm-mailq', cat: 'netservices', title: 'Очередь почты (Postfix)', cmd: 'mailq', desc: 'Письма, ожидающие отправки. Повторить отправку — sudo postqueue -f. Журнал — /var/log/mail.log.', tags: ['почта', 'очередь писем', 'postfix'] }),
  L({ id: 'm-samba-share', cat: 'samba', title: 'Простая общая папка Samba', cmd: 'sudo nano /etc/samba/smb.conf', desc: 'Пример в конце файла:\n[share]\n   path = /srv/share\n   read only = no\n   valid users = ivanov\nЗатем: sudo smbpasswd -a ivanov (пароль для Samba), testparm (проверка), sudo systemctl restart smbd. Из Windows: \\\\сервер\\share.', tags: ['общая папка', 'шара', 'samba', 'доступ из windows'] }),
  L({ id: 'm-cifs-fstab', cat: 'samba', title: 'Подключать сетевую папку Windows при загрузке', cmd: 'sudo nano /etc/fstab', desc: 'Строка: //fileserver/share /mnt/share cifs credentials=/root/.smbcred,uid=1000,iconv=utf8,nofail 0 0. В /root/.smbcred: username=..., password=..., domain=... (права 600). Проверка — sudo mount -a.', warn: ['Ошибка в fstab может помешать загрузке. Добавляйте nofail и проверяйте mount -a.'], tags: ['сетевой диск', 'подключить шару', 'fstab cifs'] }),

  // ===== Диски: простые действия =====
  L({ id: 'dk-usb', cat: 'disks', basic: true, title: 'Подключить флешку или новый диск', cmd: 'lsblk && sudo mkdir -p /mnt/usb && sudo mount /dev/sdb1 /mnt/usb', desc: 'lsblk покажет новый диск (например sdb, раздел sdb1). Затем создайте каталог и смонтируйте раздел. Отключить — sudo umount /mnt/usb.', tags: ['флешка', 'подключить диск', 'usb', 'смонтировать'] }),
  L({ id: 'dk-fstab-uuid', cat: 'disks', title: 'Монтировать диск автоматически при загрузке', cmd: 'sudo blkid /dev/sdb1', desc: 'Узнайте UUID раздела и добавьте в /etc/fstab строку: UUID=xxxx /data ext4 defaults,nofail 0 2. Проверьте без перезагрузки: sudo mount -a (ошибок быть не должно).', warn: ['Ошибка в fstab может помешать загрузке системы. Используйте nofail.'], tags: ['автомонтирование', 'fstab', 'диск при загрузке'] }),
  L({ id: 'dk-health', cat: 'disks', basic: true, title: 'Здоров ли диск (SMART)', cmd: 'sudo smartctl -H /dev/sda', desc: 'PASSED — диск считает себя исправным. Подробно — smartctl -a: обратите внимание на Reallocated_Sector_Ct, Pending_Sector, ошибки CRC. Пакет smartmontools. На виртуальных дисках SMART недоступен.', pkg: 'smartmontools', tags: ['здоровье диска', 'smart', 'диск умирает'] })
];
