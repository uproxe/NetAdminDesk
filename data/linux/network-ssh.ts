import { L } from './_helpers';

export const NETWORK_SSH = [
  // ===== Сетевые команды =====
  L({
    id: 'ip-addr', cat: 'network', title: 'IP-адреса интерфейсов', cmd: 'ip -br addr',
    syntax: 'ip [-br] [-4|-6] addr [show [dev ИНТЕРФЕЙС]]', desc: 'Показывает адреса интерфейсов. -br — кратко, одной строкой на интерфейс.',
    ex: [['ip addr show dev ens18', 'подробно об одном интерфейсе'], ['ip -4 -br addr', 'только IPv4'], ['sudo ip addr add 192.168.10.5/24 dev ens19', 'временно добавить адрес (до перезагрузки)']],
    warn: ['Изменения через ip не сохраняются после перезагрузки. Постоянная настройка — netplan (Ubuntu), /etc/network/interfaces (Debian) или NetworkManager.'],
    rel: ['ip link', 'ip route', 'nmcli'], docs: 'man 8 ip-address', tags: ['сетевые интерфейсы', 'ip адрес'], tpl: 'ip addr show dev {{INTERFACE}}'
  }),
  L({
    id: 'ip-link', cat: 'network', title: 'Состояние сетевых интерфейсов', cmd: 'ip -br link',
    desc: 'Состояние (UP/DOWN), MAC-адрес и MTU интерфейсов.',
    ex: [['ip -s link show ens18', 'со счётчиками пакетов и ошибок'], ['sudo ip link set ens19 up', 'поднять интерфейс'], ['sudo ip link set ens19 mtu 9000', 'изменить MTU']],
    warn: ['ip link set … down на интерфейсе, через который вы подключены, оборвёт SSH-сессию.'],
    rel: ['ethtool', 'ip addr'], docs: 'man 8 ip-link', tags: ['проверка сетевых интерфейсов'], tpl: 'ip -s link show {{INTERFACE}}'
  }),
  L({
    id: 'ip-route', cat: 'network', title: 'Таблица маршрутизации', cmd: 'ip route',
    desc: 'Маршруты; default via … — шлюз по умолчанию. ip route get — какой маршрут будет выбран для адреса.',
    ex: [['ip route get 8.8.8.8', 'через какой интерфейс и шлюз пойдёт трафик'], ['sudo ip route add 10.20.0.0/16 via 192.168.1.1', 'временный статический маршрут'], ['ip -6 route', 'маршруты IPv6']],
    warn: ['Удаление маршрута по умолчанию на удалённом сервере обрывает доступ.'], rel: ['ip rule', 'traceroute'], docs: 'man 8 ip-route', tags: ['маршруты', 'шлюз', 'проверка маршрутов'], tpl: 'ip route get {{IP}}'
  }),
  L({
    id: 'ip-neigh', cat: 'network', title: 'ARP-таблица (соседи)', cmd: 'ip neigh',
    desc: 'Таблица соседей: IP ↔ MAC. REACHABLE/STALE — запись актуальна/устарела, FAILED — сосед не ответил.',
    ex: [['ip neigh show dev ens18', 'по интерфейсу'], ['sudo ip neigh flush dev ens18', 'очистить таблицу на интерфейсе']], rel: ['arp -n', 'arping'], docs: 'man 8 ip-neighbour', tags: ['arp', 'mac']
  }),
  L({
    id: 'arp', cat: 'network', title: 'ARP-таблица (устаревший интерфейс)', cmd: 'arp -n', desc: 'Классическая утилита просмотра ARP. Современная замена — ip neigh.', pkg: 'net-tools', rel: ['ip neigh'], docs: 'man 8 arp'
  }),
  L({
    id: 'ss', cat: 'network', title: 'Открытые порты и соединения', cmd: 'sudo ss -tulpn',
    desc: 'Сокеты: -t TCP, -u UDP, -l слушающие, -p процесс, -n без разрешения имён. Без sudo имена процессов других пользователей не видны.',
    ex: [['ss -tn state established', 'установленные TCP-соединения'], ['ss -s', 'сводная статистика'], ["sudo ss -tlnp 'sport = :443'", 'кто слушает 443'], ["ss -tn dst 10.0.0.5", 'соединения к узлу']],
    out: 'Local Address:Port 0.0.0.0:22 — служба доступна на всех адресах, 127.0.0.1:… — только локально.',
    root: 'partial', rel: ['netstat', 'lsof -i'], docs: 'man 8 ss', tags: ['порты', 'проверка открытых портов', 'активные соединения']
  }),
  L({
    id: 'netstat', cat: 'network', title: 'Порты и соединения (устаревшая утилита)', cmd: 'sudo netstat -tulpn',
    desc: 'Аналог ss из пакета net-tools. В новых системах по умолчанию не установлен.', pkg: 'net-tools', rel: ['ss'], docs: 'man 8 netstat'
  }),
  L({
    id: 'ping', cat: 'network', title: 'Проверка доступности узла', cmd: 'ping -c 4 8.8.8.8',
    desc: 'Отправляет ICMP echo. -c — число пакетов (без него — бесконечно, Ctrl+C).',
    params: [['-c N', 'число запросов'], ['-i СЕК', 'интервал'], ['-s РАЗМЕР', 'размер данных'], ['-M do -s 1472', 'проверка MTU без фрагментации'], ['-I ИНТЕРФЕЙС', 'с конкретного интерфейса']],
    out: 'Потери (packet loss) и время ответа (rtt). Отсутствие ответа не всегда означает недоступность — ICMP может фильтроваться.',
    rel: ['mtr', 'traceroute'], docs: 'man 8 ping', tags: ['проверка сетевого подключения'], tpl: 'ping -c 4 {{HOST}}'
  }),
  L({
    id: 'traceroute', cat: 'network', title: 'Трассировка маршрута', cmd: 'traceroute -n 8.8.8.8',
    desc: 'Показывает узлы на пути к адресу. -n — без DNS, -T — TCP SYN (обход фильтрации UDP/ICMP, нужен root).',
    pkg: 'traceroute', rel: ['tracepath', 'mtr'], docs: 'man 8 traceroute', tpl: 'traceroute -n {{HOST}}'
  }),
  L({
    id: 'tracepath', cat: 'network', title: 'Трассировка с определением MTU', cmd: 'tracepath -n 8.8.8.8',
    desc: 'Трассировка без прав root, показывает Path MTU.', pkg: 'iputils-tracepath', rel: ['traceroute'], docs: 'man 8 tracepath'
  }),
  L({
    id: 'mtr', cat: 'network', title: 'Трассировка с потерями по каждому узлу', cmd: 'mtr -rwbzc 50 8.8.8.8',
    desc: 'Совмещает ping и traceroute: потери и задержки на каждом участке. -r отчёт, -c число циклов, -w широкий вывод.',
    pkg: 'mtr-tiny', out: 'Потери только на промежуточном узле при отсутствии потерь дальше — обычно ограничение ICMP на маршрутизаторе, а не проблема.', rel: ['ping', 'traceroute'], docs: 'man 8 mtr'
  }),
  L({
    id: 'dig', cat: 'dns', title: 'DNS-запросы', cmd: 'dig example.com A +short',
    desc: 'Запрашивает записи DNS. @сервер — спросить конкретный сервер.',
    pkg: 'dnsutils (Debian 12+: bind9-dnsutils)', ex: [['dig @192.168.1.10 srv01.example.local +short', 'проверить через свой DNS'], ['dig -x 192.168.1.10 +short', 'обратная запись (PTR)'], ['dig example.com MX', 'почтовые записи'], ['dig +trace example.com', 'полный путь разрешения']],
    rel: ['nslookup', 'host', 'resolvectl'], docs: 'man 1 dig', tags: ['dns', 'проверка dns'], tpl: 'dig {{HOST}} +short'
  }),
  L({ id: 'nslookup', cat: 'dns', title: 'DNS-запрос (nslookup)', cmd: 'nslookup example.com', desc: 'Простая проверка разрешения имени. Можно указать сервер вторым аргументом.', pkg: 'dnsutils (bind9-dnsutils)', rel: ['dig'], docs: 'man 1 nslookup' }),
  L({ id: 'host', cat: 'dns', title: 'DNS-запрос (host)', cmd: 'host example.com', desc: 'Краткий вывод A/AAAA/MX записей; host IP — обратный запрос.', pkg: 'bind9-host', rel: ['dig'], docs: 'man 1 host' }),
  L({
    id: 'resolvectl', cat: 'dns', title: 'Настройки DNS-клиента (systemd-resolved)', cmd: 'resolvectl status',
    desc: 'Какие DNS-серверы и домены поиска используются на каждом интерфейсе. Работает, если используется systemd-resolved (по умолчанию в Ubuntu).',
    ex: [['resolvectl query example.com', 'разрешить имя через resolved'], ['sudo resolvectl flush-caches', 'очистить кэш DNS'], ['cat /etc/resolv.conf', 'для систем без resolved']],
    compat: 'В Debian systemd-resolved по умолчанию не установлен — смотрите /etc/resolv.conf.', rel: ['dig', 'getent hosts'], docs: 'man 1 resolvectl'
  }),
  L({
    id: 'tcpdump', cat: 'network', title: 'Захват сетевого трафика', cmd: 'sudo tcpdump -ni ens18 host 10.0.0.5 and port 443',
    desc: 'Перехват пакетов с фильтрами BPF.', root: true, pkg: 'tcpdump',
    params: [['-i ИНТЕРФЕЙС', 'интерфейс (any — все)'], ['-n', 'без разрешения имён'], ['-c N', 'остановиться после N пакетов'], ['-w файл.pcap', 'записать для Wireshark'], ['-A', 'показать содержимое в ASCII']],
    ex: [['sudo tcpdump -ni any port 53', 'DNS-запросы'], ['sudo tcpdump -ni ens18 -c 200 -w /tmp/cap.pcap', 'записать 200 пакетов в файл'], ['sudo tcpdump -ni ens18 "tcp[tcpflags] & tcp-syn != 0"', 'только SYN']],
    warn: ['Захват может содержать пароли и персональные данные — храните файлы pcap осторожно.'], rel: ['ss', 'tshark'], docs: 'man 8 tcpdump'
  }),
  L({
    id: 'curl', cat: 'network', title: 'HTTP-запросы и проверка веб-сервисов', cmd: 'curl -I https://example.com',
    desc: 'Универсальный HTTP-клиент.',
    params: [['-I', 'только заголовки'], ['-v', 'подробно (TLS, заголовки)'], ['-k', 'не проверять сертификат (только для диагностики)'], ['-o файл / -O', 'сохранить в файл'], ['-L', 'следовать перенаправлениям'], ['-x proxy:port', 'через прокси'], ['--resolve host:443:IP', 'подставить IP для имени']],
    ex: [['curl -s -o /dev/null -w "%{http_code} %{time_total}\\n" https://site.local', 'код ответа и время'], ['curl -v telnet://10.0.0.5:3306', 'проверить, открыт ли TCP-порт'], ['curl --resolve site.ru:443:10.0.0.7 https://site.ru', 'проверить конкретный бэкенд']],
    rel: ['wget', 'nc'], docs: 'man 1 curl', tags: ['веб', 'http'], tpl: 'curl -I {{VALUE}}'
  }),
  L({
    id: 'wget', cat: 'network', title: 'Загрузка файлов', cmd: 'wget https://example.com/file.tar.gz',
    desc: 'Загрузка по HTTP/HTTPS/FTP. -c — докачка, -O — имя файла, -q — тихо.', rel: ['curl'], docs: 'man 1 wget'
  }),
  L({
    id: 'nc', cat: 'network', title: 'Проверка TCP/UDP-портов (netcat)', cmd: 'nc -zv 10.0.0.5 22',
    desc: 'Проверка доступности порта, простая передача данных. -z — только проверка, -v — подробно, -u — UDP, -w N — тайм-аут.',
    pkg: 'netcat-openbsd', ex: [['nc -zv -w 3 10.0.0.5 20-25', 'диапазон портов'], ['nc -l 9000', 'слушать порт (для проверки firewall с другой стороны)']],
    rel: ['curl telnet://', 'nmap'], docs: 'man 1 nc', tpl: 'nc -zv -w 3 {{HOST}} {{PORT}}'
  }),
  L({
    id: 'nmap', cat: 'network', title: 'Сканирование портов', cmd: 'nmap -sT -p 22,80,443 10.0.0.5',
    desc: 'Сканер портов и служб. -sT — TCP connect (без root), -sS — SYN (root), -sV — версии служб, -Pn — без ping.',
    pkg: 'nmap', warn: ['Сканируйте только свои сети или с разрешения владельца — сканирование может срабатывать в системах защиты.'],
    rel: ['nc', 'ss'], docs: 'man 1 nmap', tpl: 'nmap -sT -p {{PORT}} {{HOST}}'
  }),
  L({
    id: 'ethtool', cat: 'network', title: 'Скорость, дуплекс и ошибки сетевой карты', cmd: 'sudo ethtool ens18',
    desc: 'Параметры линка: скорость, дуплекс, автосогласование, Link detected. -S — статистика драйвера (ошибки, отбросы).',
    pkg: 'ethtool', root: 'partial', ex: [['sudo ethtool -S ens18 | grep -i -E "err|drop|crc"', 'ошибки на интерфейсе'], ['sudo ethtool -i ens18', 'драйвер и прошивка']],
    rel: ['ip -s link'], docs: 'man 8 ethtool', tpl: 'sudo ethtool {{INTERFACE}}'
  }),
  L({
    id: 'nmcli', cat: 'network', title: 'NetworkManager: подключения и устройства', cmd: 'nmcli device status',
    desc: 'Управление сетью через NetworkManager (десктопы, часть серверов).',
    pkg: 'network-manager', ex: [['nmcli connection show', 'профили подключений'], ['nmcli dev show ens18', 'параметры устройства'], ['sudo nmcli connection reload', 'перечитать профили']],
    compat: 'На серверах Debian обычно используется ifupdown (/etc/network/interfaces), на Ubuntu Server — netplan с systemd-networkd.', rel: ['netplan', 'ip'], docs: 'man 1 nmcli'
  }),
  L({
    id: 'netplan', cat: 'network', title: 'Netplan: применение сетевой конфигурации (Ubuntu)', cmd: 'sudo netplan try',
    desc: 'Конфигурация в /etc/netplan/*.yaml. try — применить с автоматическим откатом через 120 секунд, если не подтвердить (защита от потери доступа).',
    root: true, ex: [['sudo netplan get', 'текущая конфигурация'], ['sudo netplan apply', 'применить без отката (осторожно)']],
    warn: ['На удалённом сервере используйте netplan try, а не apply.'], compat: 'Ubuntu 18.04+. В Debian по умолчанию не используется.', rel: ['ip addr'], docs: 'man 8 netplan-try'
  }),
  L({
    id: 'interfaces', cat: 'network', title: 'Сетевая конфигурация Debian (ifupdown)', cmd: 'cat /etc/network/interfaces',
    desc: 'Классическая настройка сети в Debian. Применение для интерфейса — ifdown/ifup (может оборвать SSH).',
    ex: [['sudo ifup ens19', 'поднять интерфейс по конфигурации'], ['ls /etc/network/interfaces.d/', 'дополнительные файлы']],
    rel: ['ip addr'], docs: 'man 5 interfaces'
  }),
  L({
    id: 'ss-summary', cat: 'monitoring', title: 'Сводка по сокетам', cmd: 'ss -s', desc: 'Сколько TCP-соединений в каждом состоянии — помогает увидеть всплеск соединений или TIME-WAIT.', rel: ['ss -tan'], docs: 'man 8 ss'
  }),
  L({
    id: 'iperf3', cat: 'network', title: 'Измерение пропускной способности', cmd: 'iperf3 -c 10.0.0.5 -t 10',
    desc: 'Тест скорости между двумя узлами: на одном iperf3 -s, на другом iperf3 -c адрес.', pkg: 'iperf3',
    ex: [['iperf3 -s', 'запустить сервер'], ['iperf3 -c 10.0.0.5 -R', 'обратное направление']], rel: ['ethtool'], docs: 'man 1 iperf3'
  }),
  L({
    id: 'arping', cat: 'network', title: 'Проверка узла на канальном уровне (ARP)', cmd: 'sudo arping -c 3 -I ens18 192.168.1.10',
    desc: 'Отправляет ARP-запросы — помогает найти дубликат IP-адреса и проверить узел, блокирующий ICMP.', pkg: 'iputils-arping', root: true, rel: ['ip neigh'], docs: 'man 8 arping'
  }),
  L({
    id: 'openssl-sclient', cat: 'web', title: 'Проверка TLS-сертификата сервера', cmd: 'openssl s_client -connect example.com:443 -servername example.com </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates',
    desc: 'Подключается по TLS и показывает субъект, издателя и срок действия сертификата.',
    ex: [['openssl x509 -in cert.pem -noout -text', 'разобрать файл сертификата'], ['openssl x509 -in cert.pem -noout -enddate', 'дата окончания']],
    rel: ['curl -v', 'certbot certificates'], docs: 'man 1 openssl-s_client', tags: ['сертификат', 'ssl']
  }),

  // ===== SSH и передача файлов =====
  L({
    id: 'ssh', cat: 'ssh', title: 'Подключение по SSH', cmd: 'ssh admin@10.0.0.5',
    syntax: 'ssh [-p ПОРТ] [-i КЛЮЧ] [-J JUMP] пользователь@хост [команда]', desc: 'Клиент OpenSSH.',
    params: [['-p ПОРТ', 'порт сервера'], ['-i ФАЙЛ', 'приватный ключ'], ['-J хост', 'через промежуточный сервер (ProxyJump)'], ['-L l:h:p', 'локальный проброс порта'], ['-v', 'отладка подключения'], ['-o StrictHostKeyChecking=ask', 'параметр конфигурации']],
    ex: [['ssh -p 2222 admin@10.0.0.5', 'нестандартный порт'], ['ssh admin@10.0.0.5 "df -h"', 'выполнить одну команду'], ['ssh -vvv admin@10.0.0.5', 'разобраться, почему не подключается']],
    rel: ['ssh-keygen', 'ssh-copy-id', '~/.ssh/config'], docs: 'man 1 ssh', tags: ['ssh'], tpl: 'ssh {{USERNAME}}@{{HOST}}'
  }),
  L({
    id: 'ssh-keygen', cat: 'ssh', title: 'Создание SSH-ключа', cmd: 'ssh-keygen -t ed25519 -C "admin@workstation"',
    desc: 'Создаёт пару ключей (~/.ssh/id_ed25519 и .pub). Задайте парольную фразу для приватного ключа.',
    ex: [['ssh-keygen -t rsa -b 4096', 'RSA-ключ для старого оборудования без поддержки ed25519'], ['ssh-keygen -lf ~/.ssh/id_ed25519.pub', 'отпечаток ключа'], ['ssh-keygen -p -f ~/.ssh/id_ed25519', 'сменить парольную фразу']],
    rel: ['ssh-copy-id', 'ssh-agent'], docs: 'man 1 ssh-keygen', tags: ['ключ', 'управление ssh-ключами']
  }),
  L({
    id: 'ssh-copy-id', cat: 'ssh', title: 'Установка открытого ключа на сервер', cmd: 'ssh-copy-id -i ~/.ssh/id_ed25519.pub admin@10.0.0.5',
    desc: 'Добавляет ключ в ~/.ssh/authorized_keys на сервере и выставляет правильные права.', rel: ['ssh-keygen'], docs: 'man 1 ssh-copy-id', tpl: 'ssh-copy-id -i ~/.ssh/id_ed25519.pub {{USERNAME}}@{{HOST}}'
  }),
  L({
    id: 'known-hosts', cat: 'ssh', title: 'Работа с known_hosts', cmd: 'ssh-keygen -F 10.0.0.5',
    desc: 'Поиск ключа хоста в ~/.ssh/known_hosts (-F) и удаление устаревшей записи (-R) после переустановки сервера.',
    ex: [['ssh-keygen -R 10.0.0.5', 'удалить запись (только если вы уверены, что ключ сменился легитимно)'], ['ssh-keyscan -t ed25519 10.0.0.5', 'получить ключ хоста']],
    warn: ['Предупреждение «REMOTE HOST IDENTIFICATION HAS CHANGED» может означать атаку «человек посередине». Сверьте отпечаток с сервером по другому каналу.'],
    rel: ['ssh-keyscan'], docs: 'man 1 ssh-keygen'
  }),
  L({
    id: 'host-key-fp', cat: 'ssh', title: 'Отпечатки ключей SSH-сервера (на самом сервере)', cmd: 'for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done',
    desc: 'Показывает SHA256-отпечатки ключей хоста — их сравнивают с отпечатком, который показывает клиент при первом подключении.', rel: ['known_hosts'], docs: 'man 1 ssh-keygen'
  }),
  L({
    id: 'ssh-agent', cat: 'ssh', title: 'SSH-агент', cmd: 'ssh-add -l',
    desc: 'Агент хранит расшифрованные ключи в памяти. ssh-add добавляет ключ, -l — список, -D — удалить все.',
    ex: [['eval "$(ssh-agent -s)"', 'запустить агент в текущей оболочке'], ['ssh-add ~/.ssh/id_ed25519', 'добавить ключ']], rel: ['ssh -A'], docs: 'man 1 ssh-add'
  }),
  L({
    id: 'ssh-config', cat: 'ssh', title: 'Клиентский конфиг ~/.ssh/config', cmd: 'cat ~/.ssh/config',
    desc: 'Псевдонимы хостов, пользователи, ключи, ProxyJump. Пример блока:\nHost core-sw\n  HostName 192.168.1.1\n  User admin\n  KexAlgorithms +diffie-hellman-group14-sha1',
    ex: [['ssh -G core-sw', 'итоговые параметры для хоста']], rel: ['ssh'], docs: 'man 5 ssh_config'
  }),
  L({
    id: 'proxyjump', cat: 'ssh', title: 'Подключение через промежуточный сервер (ProxyJump)', cmd: 'ssh -J admin@bastion.local admin@10.10.0.5',
    desc: 'Подключение к внутреннему узлу через бастион. В ~/.ssh/config: ProxyJump bastion.', rel: ['ssh -L', 'ssh_config'], docs: 'man 1 ssh', tags: ['jump host', 'настройка proxyjump']
  }),
  L({
    id: 'ssh-tunnel', cat: 'ssh', title: 'Проброс портов через SSH', cmd: 'ssh -N -L 8080:10.10.0.20:80 admin@bastion.local',
    desc: '-L — локальный порт → удалённый адрес; -R — удалённый порт → локальный адрес; -D — SOCKS-прокси; -N — без выполнения команды.',
    ex: [['ssh -N -D 1080 admin@bastion.local', 'SOCKS5-прокси на localhost:1080'], ['ssh -N -R 2222:localhost:22 admin@public.server', 'обратный туннель']],
    rel: ['proxyjump'], docs: 'man 1 ssh', tags: ['туннель']
  }),
  L({
    id: 'sshd-test', cat: 'ssh', title: 'Проверка конфигурации sshd', cmd: 'sudo sshd -t',
    desc: 'Проверяет синтаксис /etc/ssh/sshd_config. sshd -T — итоговые параметры (с учётом файлов sshd_config.d).',
    root: true, ex: [["sudo sshd -T | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication) '", 'ключевые параметры безопасности']],
    rel: ['systemctl reload ssh'], docs: 'man 8 sshd', tags: ['настройка sshd', 'проверка ssh-конфигурации']
  }),
  L({
    id: 'sshd-config', cat: 'ssh', title: 'Настройка сервера SSH', cmd: 'sudo nano /etc/ssh/sshd_config.d/10-hardening.conf',
    desc: 'Собственные параметры лучше класть в /etc/ssh/sshd_config.d/. Частые: PermitRootLogin no, PasswordAuthentication no, AllowUsers.',
    root: true, risk: 'danger',
    warn: ['Перед reload проверьте sshd -t и не закрывайте текущую сессию, пока не убедитесь, что новое подключение проходит.', 'Отключение паролей без установленного ключа лишит доступа.'],
    verify: 'sudo sshd -t && sudo systemctl reload ssh', rel: ['sshd -t'], docs: 'man 5 sshd_config'
  }),
  L({
    id: 'scp', cat: 'ssh', title: 'Копирование файлов по SSH (scp)', cmd: 'scp backup.tgz admin@10.0.0.5:/srv/backup/',
    desc: 'Копирование между узлами. -r — каталоги, -P — порт (заглавная), -p — сохранить время и права.',
    ex: [['scp admin@10.0.0.5:/etc/nginx/nginx.conf .', 'забрать файл с сервера'], ['scp -r -P 2222 ./site admin@10.0.0.5:/var/www/', 'каталог на нестандартный порт']],
    compat: 'В OpenSSH 9+ scp по умолчанию работает через протокол SFTP.', rel: ['rsync', 'sftp'], docs: 'man 1 scp'
  }),
  L({
    id: 'sftp', cat: 'ssh', title: 'Интерактивная передача файлов (sftp)', cmd: 'sftp admin@10.0.0.5',
    desc: 'Команды внутри: ls, cd, get, put, mkdir, rm, lcd (локальный каталог), bye.', rel: ['scp', 'rsync'], docs: 'man 1 sftp'
  }),
  L({
    id: 'rsync', cat: 'backup', title: 'Синхронизация каталогов (rsync)', cmd: 'rsync -avh --progress /srv/data/ admin@10.0.0.6:/backup/data/',
    syntax: 'rsync [ПАРАМЕТРЫ] ИСТОЧНИК… НАЗНАЧЕНИЕ', desc: 'Копирует только изменения — локально или по SSH. Слэш в конце источника означает «содержимое каталога».',
    params: [['-a', 'архивный режим (рекурсия, права, время, ссылки)'], ['-v', 'подробно'], ['-h', 'удобные размеры'], ['-n', 'пробный прогон (ничего не меняет)'], ['--delete', 'удалять в назначении то, чего нет в источнике (опасно)'], ['-e "ssh -p 2222"', 'параметры SSH'], ['--exclude', 'исключения'], ['-z', 'сжатие при передаче']],
    ex: [['rsync -avhn --delete /srv/data/ /mnt/backup/data/', 'сначала посмотреть, что будет сделано'], ['rsync -a --exclude "*.log" /etc/ /backup/etc/', 'с исключениями']],
    warn: ['--delete с перепутанными источником и назначением удалит данные. Всегда сначала запускайте с -n.'],
    pkg: 'rsync', rel: ['scp', 'tar'], docs: 'man 1 rsync', tags: ['синхронизация каталогов', 'резервное копирование']
  })
];
