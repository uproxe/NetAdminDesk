import { L } from './_helpers';

export const SERVICES = [
  // ===== Docker =====
  L({
    id: 'docker-ps', cat: 'docker', title: 'Контейнеры', cmd: 'docker ps -a',
    desc: 'Список контейнеров: -a — включая остановленные. Status: Up — работает, Exited (код) — завершился.',
    pkg: 'docker.io или docker-ce', root: 'partial', ex: [['docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"', 'компактная таблица'], ['docker ps -a --filter status=exited', 'только завершившиеся']],
    compat: 'Без sudo работает, если пользователь в группе docker (это эквивалент прав root).', rel: ['docker logs', 'docker stats'], docs: 'docker ps --help', tags: ['контейнеры', 'проверка docker']
  }),
  L({
    id: 'docker-logs', cat: 'docker', title: 'Журнал контейнера', cmd: 'docker logs --tail 100 -f app',
    desc: 'Вывод контейнера. --tail N — последние N строк, -f — следить, --since 1h — за час, -t — с временными метками.',
    pkg: 'docker.io или docker-ce', rel: ['docker ps'], docs: 'docker logs --help', tpl: 'docker logs --tail 100 {{VALUE}}'
  }),
  L({
    id: 'docker-stats', cat: 'docker', title: 'Потребление ресурсов контейнерами', cmd: 'docker stats --no-stream',
    desc: 'CPU, память, сеть и диск по контейнерам. Без --no-stream — в реальном времени.', pkg: 'docker.io или docker-ce', rel: ['docker ps'], docs: 'docker stats --help'
  }),
  L({
    id: 'docker-exec', cat: 'docker', title: 'Выполнить команду в контейнере', cmd: 'docker exec -it app sh',
    desc: 'Запускает команду внутри работающего контейнера; -it — интерактивно с терминалом.', pkg: 'docker.io или docker-ce', rel: ['docker logs'], docs: 'docker exec --help'
  }),
  L({
    id: 'docker-inspect', cat: 'docker', title: 'Подробная информация о контейнере', cmd: 'docker inspect app',
    desc: 'JSON со всеми параметрами: тома, сети, переменные окружения, политика перезапуска.',
    ex: [["docker inspect -f '{{.State.Status}} {{.RestartCount}}' app", 'состояние и число перезапусков'], ["docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{\"\\n\"}}{{end}}' app", 'подключённые тома']],
    pkg: 'docker.io или docker-ce', warn: ['Вывод может содержать пароли из переменных окружения.'], rel: ['docker ps'], docs: 'docker inspect --help'
  }),
  L({
    id: 'docker-restart', cat: 'docker', title: 'Перезапуск контейнера', cmd: 'docker restart app', desc: 'Останавливает и запускает контейнер.', pkg: 'docker.io или docker-ce', rel: ['docker stop', 'docker start'], docs: 'docker restart --help'
  }),
  L({
    id: 'docker-images', cat: 'docker', title: 'Образы и занятое место', cmd: 'docker system df',
    desc: 'Сколько места занимают образы, контейнеры, тома и кэш сборки. docker images — список образов.',
    ex: [['docker images', 'список образов'], ['docker image prune', 'удалить «висячие» образы (с подтверждением)']], pkg: 'docker.io или docker-ce', rel: ['docker system prune'], docs: 'docker system df --help'
  }),
  L({
    id: 'docker-prune', cat: 'docker', title: 'Очистка неиспользуемых данных Docker', cmd: 'docker system prune',
    desc: 'Удаляет остановленные контейнеры, неиспользуемые сети, «висячие» образы и кэш сборки. -a — все неиспользуемые образы, --volumes — и тома.',
    pkg: 'docker.io или docker-ce', warn: ['С --volumes удаляются данные в неиспользуемых томах (например, базы остановленных контейнеров).'], risk: 'danger', rel: ['docker system df'], docs: 'docker system prune --help'
  }),
  L({
    id: 'docker-compose', cat: 'docker', title: 'Docker Compose: состояние и управление', cmd: 'docker compose ps',
    desc: 'Работа с проектом из compose.yaml в текущем каталоге: ps, logs, up -d, down, pull.',
    pkg: 'docker-compose-plugin (или docker-compose v1)', ex: [['docker compose logs -f --tail 50', 'журналы всех сервисов'], ['docker compose pull && docker compose up -d', 'обновить образы и пересоздать контейнеры'], ['docker compose config', 'проверить итоговую конфигурацию']],
    compat: 'Старая версия — отдельная команда docker-compose (через дефис).', rel: ['docker ps'], docs: 'docker compose --help'
  }),
  L({
    id: 'docker-networks', cat: 'docker', title: 'Сети Docker', cmd: 'docker network ls', desc: 'Сети Docker; docker network inspect ИМЯ — подключённые контейнеры и адреса.', pkg: 'docker.io или docker-ce', rel: ['docker inspect'], docs: 'docker network --help'
  }),
  L({
    id: 'docker-service', cat: 'docker', title: 'Служба Docker', cmd: 'systemctl status docker --no-pager',
    desc: 'Состояние демона Docker и его журнал (journalctl -u docker).', rel: ['journalctl -u docker'], docs: 'man 8 dockerd'
  }),

  // ===== Nginx =====
  L({
    id: 'nginx-t', cat: 'nginx', title: 'Проверка конфигурации Nginx', cmd: 'sudo nginx -t',
    desc: 'Проверяет синтаксис и доступность файлов. Запускайте перед reload/restart. -T — проверить и вывести итоговую конфигурацию.',
    root: true, pkg: 'nginx', ex: [['sudo nginx -T | less', 'итоговая конфигурация со всеми include'], ['sudo nginx -t && sudo systemctl reload nginx', 'безопасное применение']],
    rel: ['systemctl reload nginx'], docs: 'man 8 nginx'
  }),
  L({
    id: 'nginx-sites', cat: 'nginx', title: 'Сайты Nginx (Debian/Ubuntu)', cmd: 'ls -l /etc/nginx/sites-enabled/',
    desc: 'В Debian/Ubuntu конфигурации сайтов — в sites-available, включение — символической ссылкой в sites-enabled.', pkg: 'nginx', rel: ['ln -s', 'nginx -t'], docs: 'man 8 nginx'
  }),
  L({
    id: 'nginx-logs', cat: 'nginx', title: 'Журналы Nginx', cmd: 'sudo tail -n 100 /var/log/nginx/error.log',
    desc: 'error.log — ошибки, access.log — запросы.', root: true, pkg: 'nginx',
    ex: [["sudo awk '$9 ~ /^5/' /var/log/nginx/access.log | tail", 'запросы с ошибками 5xx'], ["sudo awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head", 'самые активные клиенты']],
    rel: ['tail -f'], docs: 'man 8 nginx'
  }),

  // ===== Apache =====
  L({
    id: 'apache-test', cat: 'apache', title: 'Проверка конфигурации Apache', cmd: 'sudo apache2ctl configtest',
    desc: 'Проверка синтаксиса. -S — виртуальные хосты и на каких портах они слушают.', root: true, pkg: 'apache2',
    ex: [['sudo apache2ctl -S', 'список виртуальных хостов'], ['sudo apache2ctl -M', 'загруженные модули']], rel: ['systemctl reload apache2'], docs: 'man 8 apache2ctl'
  }),
  L({
    id: 'apache-sites', cat: 'apache', title: 'Включение сайтов и модулей Apache', cmd: 'sudo a2ensite site.conf',
    desc: 'Debian/Ubuntu: a2ensite/a2dissite — сайты, a2enmod/a2dismod — модули. После — reload.', root: true, pkg: 'apache2',
    ex: [['sudo a2enmod rewrite ssl', 'включить модули'], ['sudo a2dissite 000-default.conf', 'отключить сайт по умолчанию']], rel: ['apache2ctl configtest'], docs: 'man 8 a2ensite'
  }),
  L({
    id: 'apache-logs', cat: 'apache', title: 'Журналы Apache', cmd: 'sudo tail -n 100 /var/log/apache2/error.log', desc: 'Ошибки и запросы Apache (/var/log/apache2/).', root: true, pkg: 'apache2', rel: ['tail -f'], docs: 'man 8 apache2'
  }),

  // ===== MySQL / MariaDB =====
  L({
    id: 'mysql-status', cat: 'mysql', title: 'Состояние сервера MySQL/MariaDB', cmd: 'sudo mysqladmin status',
    desc: 'Время работы, число потоков и запросов. В Debian/Ubuntu root входит через сокет без пароля (sudo).', root: true, pkg: 'mariadb-server или mysql-server',
    ex: [['sudo mysql -e "SHOW PROCESSLIST;"', 'текущие запросы'], ['sudo mysql -e "SHOW DATABASES;"', 'базы данных']], rel: ['mysqldump'], docs: 'man 1 mysqladmin'
  }),
  L({
    id: 'mysqldump', cat: 'mysql', title: 'Резервная копия базы MySQL/MariaDB', cmd: 'sudo mysqldump --single-transaction --routines db_name | gzip > db_name-$(date +%F).sql.gz',
    desc: 'Логический дамп базы. --single-transaction — согласованная копия InnoDB без блокировки таблиц.', root: true, pkg: 'mariadb-client или mysql-client',
    ex: [['sudo mysqldump --all-databases --single-transaction | gzip > all-$(date +%F).sql.gz', 'все базы'], ['gunzip < db.sql.gz | sudo mysql db_name', 'восстановление (перезапишет данные!)']],
    rel: ['mysql'], docs: 'man 1 mysqldump'
  }),
  L({
    id: 'mysql-size', cat: 'mysql', title: 'Размер баз данных MySQL', cmd: 'sudo mysql -e "SELECT table_schema, ROUND(SUM(data_length+index_length)/1024/1024,1) AS mb FROM information_schema.tables GROUP BY table_schema ORDER BY mb DESC;"',
    desc: 'Размер каждой базы в мегабайтах.', root: true, pkg: 'mariadb-client или mysql-client', rel: ['du -sh /var/lib/mysql'], docs: 'man 1 mysql'
  }),

  // ===== PostgreSQL =====
  L({
    id: 'pg-status', cat: 'postgresql', title: 'Кластеры PostgreSQL (Debian/Ubuntu)', cmd: 'pg_lsclusters',
    desc: 'Версии, порты, состояние и каталоги данных кластеров PostgreSQL (утилиты postgresql-common).', pkg: 'postgresql',
    ex: [['sudo -u postgres psql -c "SELECT version();"', 'версия сервера'], ['sudo -u postgres psql -c "\\l"', 'список баз']], rel: ['pg_dump'], docs: 'man 1 pg_lsclusters'
  }),
  L({
    id: 'pg-activity', cat: 'postgresql', title: 'Активные запросы PostgreSQL', cmd: "sudo -u postgres psql -c \"SELECT pid, usename, state, now()-query_start AS dur, left(query,80) FROM pg_stat_activity WHERE state <> 'idle' ORDER BY dur DESC;\"",
    desc: 'Выполняющиеся запросы с длительностью.', pkg: 'postgresql', rel: ['pg_lsclusters'], docs: 'https://www.postgresql.org/docs/current/monitoring-stats.html'
  }),
  L({
    id: 'pg-dump', cat: 'postgresql', title: 'Резервная копия базы PostgreSQL', cmd: 'sudo -u postgres pg_dump -Fc db_name > /backup/db_name-$(date +%F).dump',
    desc: 'Дамп в собственном формате (-Fc) — восстанавливается pg_restore, позволяет выбирать объекты. pg_dumpall — все базы и роли.',
    pkg: 'postgresql-client', ex: [['sudo -u postgres pg_restore -l /backup/db.dump | head', 'содержимое дампа'], ['sudo -u postgres pg_restore -d db_name --clean /backup/db.dump', 'восстановление (перезапишет объекты!)']],
    rel: ['pg_restore'], docs: 'man 1 pg_dump'
  }),

  // ===== Samba =====
  L({
    id: 'samba-test', cat: 'samba', title: 'Проверка конфигурации Samba', cmd: 'testparm -s', desc: 'Проверяет /etc/samba/smb.conf и выводит итоговые параметры.', pkg: 'samba', rel: ['smbstatus'], docs: 'man 1 testparm'
  }),
  L({
    id: 'smbstatus', cat: 'samba', title: 'Подключения к Samba', cmd: 'sudo smbstatus', desc: 'Активные сессии, подключённые ресурсы и заблокированные файлы.', root: true, pkg: 'samba', rel: ['testparm'], docs: 'man 1 smbstatus'
  }),
  L({
    id: 'smbclient', cat: 'samba', title: 'Список общих ресурсов SMB', cmd: 'smbclient -L //fileserver -U ivanov',
    desc: 'Показывает ресурсы SMB-сервера (проверка доступа с Linux).', pkg: 'smbclient', rel: ['mount -t cifs'], docs: 'man 1 smbclient'
  }),
  L({
    id: 'mount-cifs', cat: 'samba', title: 'Подключение сетевой папки Windows (CIFS)', cmd: 'sudo mount -t cifs //fileserver/share /mnt/share -o credentials=/root/.smbcred,vers=3.0,uid=1000',
    desc: 'Монтирует SMB-ресурс. Учётные данные храните в файле с правами 600 (username=…, password=…, domain=…).', root: true, pkg: 'cifs-utils',
    warn: ['Не передавайте пароль в командной строке — он виден в списке процессов и истории.'], rel: ['smbclient', 'fstab'], docs: 'man 8 mount.cifs'
  }),

  // ===== NFS =====
  L({
    id: 'nfs-exports', cat: 'nfs', title: 'Экспорты NFS-сервера', cmd: 'sudo exportfs -v',
    desc: 'Экспортируемые каталоги и опции. После правки /etc/exports — exportfs -ra.', root: true, pkg: 'nfs-kernel-server',
    ex: [['sudo exportfs -ra', 'применить изменения /etc/exports']], rel: ['showmount'], docs: 'man 8 exportfs'
  }),
  L({
    id: 'showmount', cat: 'nfs', title: 'Экспорты удалённого NFS-сервера', cmd: 'showmount -e 10.0.0.20', desc: 'Какие каталоги экспортирует сервер (NFSv3).', pkg: 'nfs-common', rel: ['mount -t nfs'], docs: 'man 8 showmount'
  }),
  L({
    id: 'mount-nfs', cat: 'nfs', title: 'Монтирование NFS', cmd: 'sudo mount -t nfs4 10.0.0.20:/export/data /mnt/data',
    desc: 'Подключение NFS-ресурса. Для fstab: 10.0.0.20:/export/data /mnt/data nfs4 defaults,_netdev,nofail 0 0', root: true, pkg: 'nfs-common', rel: ['showmount', 'fstab'], docs: 'man 5 nfs'
  }),

  // ===== DNS / DHCP =====
  L({
    id: 'bind-check', cat: 'dns', title: 'Проверка конфигурации BIND', cmd: 'sudo named-checkconf',
    desc: 'Проверка named.conf; named-checkzone — проверка файла зоны.', root: true, pkg: 'bind9',
    ex: [['sudo named-checkzone example.local /etc/bind/db.example.local', 'проверить зону'], ['sudo rndc reload', 'перечитать зоны']], rel: ['dig'], docs: 'man 1 named-checkconf'
  }),
  L({
    id: 'dhcp-leases', cat: 'dhcp', title: 'Аренды DHCP (ISC DHCP / Kea)', cmd: 'sudo cat /var/lib/dhcp/dhcpd.leases | tail -40',
    desc: 'Выданные адреса ISC DHCP. Для Kea — /var/lib/kea/kea-leases4.csv.', root: true, pkg: 'isc-dhcp-server или kea',
    compat: 'ISC DHCP больше не развивается; в новых установках рекомендуется Kea.', rel: ['dhcpd -t'], docs: 'man 5 dhcpd.leases'
  }),
  L({
    id: 'dhcp-client', cat: 'dhcp', title: 'Обновление адреса DHCP на клиенте', cmd: 'sudo dhclient -v ens18',
    desc: 'Запрос адреса по DHCP (ifupdown). В системах с systemd-networkd — networkctl renew ens18.', root: true, pkg: 'isc-dhcp-client',
    warn: ['dhclient -r освобождает адрес — на удалённом сервере это оборвёт подключение.'], rel: ['networkctl', 'ip addr'], docs: 'man 8 dhclient'
  }),

  // ===== Веб-сервисы =====
  L({
    id: 'certbot', cat: 'web', title: "Сертификаты Let's Encrypt", cmd: 'sudo certbot certificates',
    desc: 'Список сертификатов и сроки действия. renew --dry-run — проверка автоматического продления.', root: true, pkg: 'certbot',
    ex: [['sudo certbot renew --dry-run', 'проверить продление'], ['systemctl list-timers | grep certbot', 'таймер продления']], rel: ['openssl s_client'], docs: 'man 1 certbot'
  }),
  L({
    id: 'http-check', cat: 'web', title: 'Код ответа и время ответа сайта', cmd: 'curl -o /dev/null -s -w "%{http_code} %{time_total}s\\n" https://site.local/',
    desc: 'Быстрая проверка работы веб-сервиса.', rel: ['curl'], docs: 'man 1 curl', tags: ['веб-сервисы']
  }),

  // ===== Мониторинг =====
  L({
    id: 'zabbix-agent', cat: 'monitoring', title: 'Zabbix agent: проверка', cmd: 'systemctl status zabbix-agent2 --no-pager',
    desc: 'Состояние агента Zabbix. zabbix_agent2 -t ключ — проверить элемент данных локально.', pkg: 'zabbix-agent2',
    ex: [['zabbix_agent2 -t system.cpu.load[all,avg1]', 'проверить ключ'], ['grep -E "^(Server|ServerActive|Hostname)=" /etc/zabbix/zabbix_agent2.conf', 'адреса сервера и имя узла']],
    compat: 'Для классического агента: служба zabbix-agent и zabbix_agentd -t.', rel: ['journalctl -u zabbix-agent2'], docs: 'https://www.zabbix.com/documentation'
  }),
  L({
    id: 'sensors', cat: 'monitoring', title: 'Температуры и вентиляторы', cmd: 'sensors', desc: 'Показания датчиков материнской платы и CPU. Перед первым запуском — sudo sensors-detect.', pkg: 'lm-sensors', rel: ['ipmitool'], docs: 'man 1 sensors', tags: ['температура']
  }),
  L({
    id: 'ipmitool', cat: 'monitoring', title: 'IPMI: датчики и журнал сервера', cmd: 'sudo ipmitool sdr',
    desc: 'Датчики BMC (iLO/iDRAC/IPMI): температуры, вентиляторы, блоки питания. sel list — журнал событий оборудования.', root: true, pkg: 'ipmitool',
    ex: [['sudo ipmitool sel list | tail', 'последние события оборудования'], ['sudo ipmitool lan print 1', 'сетевые настройки BMC']], rel: ['sensors', 'dmidecode'], docs: 'man 1 ipmitool'
  }),

  // ===== Сетевые службы =====
  L({
    id: 'chrony', cat: 'netservices', title: 'Синхронизация времени (chrony)', cmd: 'chronyc tracking',
    desc: 'Смещение часов и источник времени. sources -v — список серверов NTP с качеством.', pkg: 'chrony',
    ex: [['chronyc sources -v', 'серверы времени'], ['sudo chronyc makestep', 'немедленно скорректировать время']], rel: ['timedatectl'], docs: 'man 1 chronyc', tags: ['ntp', 'время']
  }),
  L({
    id: 'snmpwalk', cat: 'netservices', title: 'SNMP-опрос устройства', cmd: 'snmpwalk -v2c -c public 192.168.1.1 system',
    desc: 'Читает дерево SNMP. Удобно для проверки доступности SNMP на коммутаторах.', pkg: 'snmp',
    warn: ['Строка community — это пароль; не храните её в истории команд.'], rel: ['snmpget'], docs: 'man 1 snmpwalk'
  }),
  L({
    id: 'tftp-server', cat: 'netservices', title: 'TFTP-сервер для конфигураций коммутаторов', cmd: 'systemctl status tftpd-hpa --no-pager',
    desc: 'tftpd-hpa: каталог задаётся TFTP_DIRECTORY в /etc/default/tftpd-hpa (по умолчанию /srv/tftp). Для приёма файлов от коммутаторов добавьте --create в TFTP_OPTIONS и дайте права на запись пользователю tftp.',
    pkg: 'tftpd-hpa', ex: [['cat /etc/default/tftpd-hpa', 'настройки'], ['ls -lt /srv/tftp | head', 'последние полученные конфигурации']], rel: ['ufw allow 69/udp'], docs: 'man 8 in.tftpd'
  }),
  L({
    id: 'rsyslog-remote', cat: 'netservices', title: 'Приём syslog от сетевого оборудования', cmd: 'sudo ss -ulpn | grep ":514"',
    desc: 'Проверка, слушает ли rsyslog UDP 514. Включение приёма: module(load="imudp") и input(type="imudp" port="514") в /etc/rsyslog.d/.',
    root: true, pkg: 'rsyslog', rel: ['logger', 'tcpdump port 514'], docs: 'man 5 rsyslog.conf'
  })
];
