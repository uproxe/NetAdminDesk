// Руководства по базам данных: MySQL, MariaDB, PostgreSQL — вход, отличия синтаксиса,
// типовые проблемы и их решение. Имена в примерах нейтральные: shop, orders, app_user.
import type { Guide } from '../../src/shared/types';

export const GUIDES_DB: Guide[] = [
  {
    id: 'db-intro', section: 'db', level: 'новичок', title: 'Базы данных с нуля: MySQL, MariaDB, PostgreSQL',
    summary: 'Что такое сервер БД, база, таблица и пользователь; как войти в клиент и не сломать данные.',
    tags: ['база данных', 'бд', 'sql', 'mysql', 'mariadb', 'postgresql', 'postgres', 'постгрес', 'мускул', 'с чего начать', 'войти в базу', 'psql'],
    body: `**Сервер баз данных** (СУБД) — программа, которая хранит данные приложений: сайта, системы учёта, мониторинга. Самые распространённые бесплатные — **MySQL**, **MariaDB** и **PostgreSQL**.

## Из чего состоит
- **Сервер** — служба на Linux (\`mariadb\`, \`mysql\` или \`postgresql\`), слушает порт: 3306 у MySQL/MariaDB, 5432 у PostgreSQL.
- **База** (database) — набор таблиц одного приложения, например \`shop\`.
- **Таблица** — как лист Excel: столбцы (поля) и строки (записи).
- **Пользователь** (в PostgreSQL — «роль») — логин, под которым приложение или человек входит в базу. Права выдаются на базы и таблицы.
- **Клиент** — программа для ввода команд: \`mysql\` (или \`mariadb\`) и \`psql\`.

## Как войти администратором
На Debian / Ubuntu администратор входит без пароля — через системного пользователя:

\`\`\`linux
sudo mysql
\`\`\`

\`\`\`linux
sudo -u postgres psql
\`\`\`

Приглашение изменится: \`MariaDB [(none)]>\` или \`mysql>\` у MySQL/MariaDB, \`postgres=#\` у PostgreSQL. Выход — \`exit\` или \`\\q\`.

## Три правила безопасности
1. **Сначала смотрим, потом меняем.** Команды SELECT, SHOW и служебные команды psql (\`\\l\`, \`\\dt\`) ничего не меняют. UPDATE, DELETE, DROP, TRUNCATE, ALTER — меняют, и часто необратимо.
2. **UPDATE и DELETE — только с WHERE.** Без условия команда изменит или удалит **все строки таблицы**. Сначала выполните SELECT с тем же WHERE и посмотрите, что попадёт под изменение.
3. **Перед изменениями — резервная копия** ([[db-backup]]).

> Оператор SQL заканчивается точкой с запятой «;». Если клиент показывает приглашение \`->\` (MySQL) или \`shop-#\` (PostgreSQL) — он ждёт продолжения команды: допишите «;» и нажмите Enter, а чтобы отменить ввод — Ctrl+C.

## Где в программе
- «Справочник → Базы данных» — команды с объяснениями; отличия СУБД указаны в каждой записи.
- «Инструменты → Диагностика → Linux» — задачи «MySQL / MariaDB: полная проверка», «PostgreSQL: полная проверка», «База данных тормозит» и другие.
- Отличия синтаксиса — [[db-syntax]].`
  },
  {
    id: 'db-syntax', section: 'db', level: 'новичок', title: 'Отличия синтаксиса: MySQL, MariaDB и PostgreSQL',
    summary: 'MySQL и MariaDB почти одинаковы, PostgreSQL заметно отличается. Таблица соответствий самых нужных команд.',
    tags: ['отличия синтаксиса', 'разница mysql postgresql', 'mariadb или mysql', 'синтаксис', 'шпаргалка sql', 'аналог show databases', 'аналог use', 'show tables postgres'],
    body: `Коротко: **MySQL и MariaDB — почти одно и то же** (MariaDB — ответвление MySQL, сделанное его же авторами). Клиент, утилиты, файлы настроек и основной SQL совпадают; записи справочника с пометкой «MySQL / MariaDB» работают в обеих. **PostgreSQL — другая СУБД**: обычные SELECT / INSERT / UPDATE / DELETE пишутся так же, а служебные команды, пользователи, права и настройки — по-другому.

## Самые нужные команды
| Задача | MySQL / MariaDB | PostgreSQL |
|---|---|---|
| Войти администратором | \`sudo mysql\` | \`sudo -u postgres psql\` |
| Список баз | \`SHOW DATABASES;\` | \`\\l\` |
| Перейти в базу | \`USE shop;\` | \`\\c shop\` |
| Список таблиц | \`SHOW TABLES;\` | \`\\dt\` |
| Структура таблицы | \`DESCRIBE orders;\` | \`\\d orders\` |
| Список пользователей | \`SELECT user, host FROM mysql.user;\` | \`\\du\` |
| Создать пользователя | \`CREATE USER 'app_user'@'localhost' IDENTIFIED BY 'пароль';\` | \`CREATE ROLE app_user LOGIN PASSWORD 'пароль';\` |
| Все права на базу | \`GRANT ALL PRIVILEGES ON shop.* TO 'app_user'@'localhost';\` | \`GRANT ALL ON DATABASE shop TO app_user;\` + права на схему (ниже) |
| Сменить пароль | \`ALTER USER 'app_user'@'localhost' IDENTIFIED BY 'пароль';\` | \`\\password app_user\` |
| Что выполняется сейчас | \`SHOW FULL PROCESSLIST;\` | \`SELECT pid, state, query FROM pg_stat_activity;\` |
| Прервать запрос | \`KILL QUERY 123;\` | \`SELECT pg_cancel_backend(123);\` |
| Отключить соединение | \`KILL 123;\` | \`SELECT pg_terminate_backend(123);\` |
| Вертикальный вывод | окончание \`\\G\` вместо «;» | команда \`\\x\` |
| Резервная копия базы | \`mysqldump --single-transaction shop > shop.sql\` | \`pg_dump -Fc shop > shop.dump\` |
| Восстановление | \`mysql shop < shop.sql\` | \`pg_restore -d shop shop.dump\` |
| Порт | 3306 | 5432 |
| Файл настроек (Debian/Ubuntu) | \`/etc/mysql/mariadb.conf.d/50-server.cnf\` или \`/etc/mysql/mysql.conf.d/mysqld.cnf\` | \`/etc/postgresql/ВЕРСИЯ/main/postgresql.conf\` |
| Кто откуда может войти | хост в имени пользователя: \`'app_user'@'192.168.1.%'\` | файл \`pg_hba.conf\` + роль |
| Слушать сеть | \`bind-address\` | \`listen_addresses\` |

## Отличия в самом SQL
- **Кавычки для имён** (если имя совпадает с ключевым словом или содержит дефис): MySQL — обратные апострофы (клавиша Ё в английской раскладке), PostgreSQL — двойные кавычки. Строки — везде в одинарных: \`'текст'\`.

\`\`\`mysql
SELECT \`order\` FROM \`my-table\`;
\`\`\`

\`\`\`postgresql
SELECT "order" FROM "my-table";
\`\`\`

- **Автонумерация**: MySQL — \`id INT AUTO_INCREMENT PRIMARY KEY\`, PostgreSQL — \`id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY\` (или старое \`serial\`).
- **Интервал времени**: MySQL — \`INTERVAL 1 DAY\`, PostgreSQL — \`INTERVAL '1 day'\`. Стандартная запись \`INTERVAL '1' DAY\` работает в обеих.
- **Поиск без учёта регистра**: в MySQL обычный \`LIKE\` (зависит от сортировки — collation), в PostgreSQL — \`ILIKE\`.
- **«Вставить или обновить»**: MySQL — \`INSERT … ON DUPLICATE KEY UPDATE …\`, PostgreSQL — \`INSERT … ON CONFLICT (id) DO UPDATE SET …\`.
- **Склейка строк**: \`CONCAT(a, b)\` работает в обеих; \`a || b\` — только PostgreSQL (в MySQL \`||\` по умолчанию означает «ИЛИ»).
- **LIMIT**: \`LIMIT 10 OFFSET 20\` — в обеих; короткая форма \`LIMIT 20, 10\` — только MySQL.
- **Отмена изменения структуры**: в PostgreSQL CREATE / ALTER / DROP внутри \`BEGIN\` можно откатить \`ROLLBACK\`. В MySQL такие команды сразу фиксируют транзакцию — откатить нельзя.

## Права в PostgreSQL 15 и новее
Права на базу не дают права создавать таблицы. После \`GRANT ALL ON DATABASE\` выполните внутри этой базы:

\`\`\`postgresql
\\c shop
GRANT ALL ON SCHEMA public TO app_user;
\`\`\`

Или сразу сделайте пользователя владельцем базы: \`CREATE DATABASE shop OWNER app_user;\`.

## Где MySQL и MariaDB всё-таки различаются
- **Имена команд**: в новых MariaDB основные — \`mariadb\`, \`mariadb-dump\`, \`mariadb-admin\`; старые \`mysql\`, \`mysqldump\` обычно оставлены как ссылки. Служба называется \`mariadb\` (у MySQL — \`mysql\`).
- **Пароли**: MySQL 8 по умолчанию использует \`caching_sha2_password\`. Старые клиенты и библиотеки выдают «Authentication plugin 'caching_sha2_password' cannot be loaded» — нужен новый клиент или пользователь с \`mysql_native_password\`.
- **Репликация**: \`SHOW REPLICA STATUS\` — MySQL 8.0.22+ и MariaDB 10.5.1+; в старых версиях \`SHOW SLAVE STATUS\`. Настройка источника: MySQL 8.0.23+ — \`CHANGE REPLICATION SOURCE TO\`, MariaDB — \`CHANGE MASTER TO\`. Старые формы со словами SLAVE / MASTER в новых версиях MySQL устарели.
- **Срок хранения binlog**: MySQL 8 — \`binlog_expire_logs_seconds\`; MariaDB — \`expire_logs_days\` (с 10.6 есть и \`binlog_expire_logs_seconds\`).
- **JSON**: в MySQL — отдельный тип с проверкой, в MariaDB JSON — синоним LONGTEXT с проверкой формата.
- **Переход между ними**: файлы данных MySQL 8 и MariaDB 10.x/11.x **несовместимы** — переносите через дамп (mysqldump → импорт), а не копированием /var/lib/mysql.

Как узнать, что установлено: \`SELECT VERSION();\` — в ответе MariaDB есть слово «MariaDB».`
  },
  {
    id: 'db-backup', section: 'db', level: 'новичок', title: 'Резервная копия и восстановление базы',
    summary: 'mysqldump и pg_dump пошагово: сделать копию, проверить её и восстановить в новую базу.',
    tags: ['бэкап базы', 'резервная копия бд', 'mysqldump', 'pg_dump', 'pg_restore', 'восстановить базу', 'дамп', 'выгрузить базу'],
    body: `Логическая копия (дамп) — файл с командами SQL или архив, из которого базу можно создать заново. Делается без остановки сервера.

## MySQL / MariaDB
\`\`\`linux
sudo mysqldump --single-transaction --routines --triggers shop | gzip > /backup/shop-$(date +%F).sql.gz
\`\`\`

- \`--single-transaction\` — согласованная копия таблиц InnoDB без блокировки работы.
- \`--routines --triggers\` — сохранить хранимые процедуры и триггеры.
- Все базы сразу: \`sudo mysqldump --single-transaction --all-databases | gzip > /backup/all-$(date +%F).sql.gz\`.

Восстановление в новую базу (так безопаснее, чем поверх рабочей):

\`\`\`linux
sudo mysql -e "CREATE DATABASE shop_restore;"
zcat /backup/shop-2026-01-15.sql.gz | sudo mysql shop_restore
\`\`\`

## PostgreSQL
\`\`\`linux
sudo -u postgres pg_dump -Fc shop > /backup/shop-$(date +%F).dump
\`\`\`

- \`-Fc\` — сжатый архивный формат: из него можно восстановить отдельную таблицу и посмотреть содержимое (\`pg_restore -l файл\`).
- Пользователи и роли в \`pg_dump\` не попадают — их сохраняет \`sudo -u postgres pg_dumpall --roles-only > /backup/roles.sql\`.

Восстановление в новую базу:

\`\`\`linux
sudo -u postgres createdb shop_restore
sudo -u postgres pg_restore -d shop_restore /backup/shop-2026-01-15.dump
\`\`\`

> Если файл копии принадлежит root, а команда запущена от postgres, будет «Permission denied». Перенаправление \`> файл\` выполняет ваш пользователь, а не postgres — каталог /backup должен быть доступен вам на запись.

## Проверка копии
Копия, которую ни разу не восстанавливали, может оказаться пустой или битой. Раз в месяц восстановите её в отдельную базу и проверьте количество строк в главных таблицах (\`SELECT COUNT(*) FROM orders;\`). Автоматический запуск по расписанию — [[lx-cron]].`
  },
  {
    id: 'ts-db-connect', section: 'db', level: 'базовый', title: 'К базе не подключиться: Access denied, pg_hba, Connection refused',
    summary: 'Разбор типовых ошибок входа в MySQL / MariaDB и PostgreSQL: что означает каждая и что делать.',
    tags: ['access denied', 'не подключается к базе', 'ошибка 1045', 'pg_hba.conf', 'peer authentication failed', 'password authentication failed', 'connection refused', 'can not connect', 'нет доступа к базе', 'ошибка 2002'],
    body: `Сначала прочитайте текст ошибки — он почти всегда говорит, где проблема. Быстрая проверка в программе: «Диагностика → Linux → К базе не подключиться / Too many connections».

## MySQL / MariaDB
**ERROR 1045 (28000): Access denied for user 'app_user'@'localhost'** — неверный пароль или такого пользователя нет **для этого адреса**. В MySQL пользователь — это пара «имя + откуда»: \`'app_user'@'localhost'\` и \`'app_user'@'192.168.1.%'\` — разные учётные записи.

\`\`\`mysql
SELECT user, host, plugin FROM mysql.user WHERE user = 'app_user';
\`\`\`

Нет строки для нужного адреса — создайте пользователя для него и выдайте права. Пароль забыт — задайте новый: \`ALTER USER 'app_user'@'localhost' IDENTIFIED BY 'новый_пароль';\`.

**Access denied for user 'root'@'localhost'** при входе \`mysql -u root -p\` на Debian/Ubuntu — root входит не по паролю, а через системного пользователя: \`sudo mysql\`.

**ERROR 2002: Can't connect to local server through socket** — сервер не запущен: \`systemctl status mariadb\` (или \`mysql\`), причину ищите в журнале ([[ts-db-start]]).

**ERROR 2003: Can't connect to MySQL server on '192.168.1.20'** — по сети не доступен: сервер слушает только 127.0.0.1 (\`bind-address\` в настройках), закрыт порт 3306 на firewall или неверный адрес. Проверка с клиента: «Инструменты → Сетевые утилиты → Проверка TCP-порта».

## PostgreSQL
**Peer authentication failed for user "app_user"** — вход через сокет без \`-h\`: PostgreSQL проверяет, что имя пользователя Linux совпадает с именем роли. Подключайтесь по паролю: \`psql -h localhost -U app_user -d shop\`.

**password authentication failed for user "app_user"** — неверный пароль. Сбросить: \`sudo -u postgres psql\`, затем \`\\password app_user\`.

**no pg_hba.conf entry for host "192.168.1.30", user "app_user", database "shop"** — в \`pg_hba.conf\` нет разрешения для этого адреса. Добавьте строку и перечитайте настройки:

\`\`\`linux
sudo nano /etc/postgresql/16/main/pg_hba.conf
\`\`\`

Строка для сети 192.168.1.0/24: \`host  shop  app_user  192.168.1.0/24  scram-sha-256\`. Затем \`sudo -u postgres psql -c "SELECT pg_reload_conf();"\`.

**Connection refused** / **could not connect to server** — сервер не запущен или слушает только localhost (\`listen_addresses\` в postgresql.conf; после изменения нужен перезапуск).

## Too many connections / too many clients
Все соединения заняты — новых клиентов сервер не пускает. Администратор всё равно может войти: в MySQL зарезервировано одно соединение для пользователя с правом SUPER / CONNECTION_ADMIN, в PostgreSQL — \`superuser_reserved_connections\`.

\`\`\`mysql
SHOW FULL PROCESSLIST;
\`\`\`

\`\`\`postgresql
SELECT usename, client_addr, state, count(*) FROM pg_stat_activity GROUP BY 1, 2, 3 ORDER BY 4 DESC;
\`\`\`

Чаще всего соединения держит одно приложение — без пула соединений или с зависшими запросами. Сначала найдите и исправьте его; увеличение \`max_connections\` — временная мера (каждое соединение занимает память).`
  },
  {
    id: 'ts-db-slow', section: 'db', level: 'базовый', title: 'База данных тормозит: долгие запросы и блокировки',
    summary: 'Как найти запрос, который всё держит, понять причину и аккуратно его прервать.',
    tags: ['база тормозит', 'медленные запросы', 'зависший запрос', 'блокировка', 'lock', 'deadlock', 'processlist', 'pg_stat_activity', 'kill query', 'idle in transaction'],
    body: `Запустите «Диагностика → Linux → База данных тормозит» — проверка покажет долгие запросы, блокировки, нагрузку на процессор, память и диски. Ниже — то же вручную.

## 1. Что выполняется дольше всего
\`\`\`mysql
SELECT id, user, db, time, state, LEFT(info, 100) FROM information_schema.processlist WHERE command <> 'Sleep' ORDER BY time DESC LIMIT 10;
\`\`\`

\`\`\`postgresql
SELECT pid, usename, state, now() - query_start AS dur, left(query, 100) FROM pg_stat_activity WHERE state <> 'idle' ORDER BY dur DESC LIMIT 10;
\`\`\`

## 2. Кто кого блокирует
- PostgreSQL: \`SELECT pid, pg_blocking_pids(pid), left(query, 80) FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;\` — во втором столбце номера тех, кто держит блокировку.
- MySQL: состояние «Waiting for table metadata lock» у запросов — обычно ALTER TABLE ждёт, пока закроется чья-то незавершённая транзакция.
- **idle in transaction** (PostgreSQL) или долгая транзакция в \`information_schema.innodb_trx\` (MySQL) — приложение открыло транзакцию и «забыло» её. Она держит блокировки часами.

## 3. Прервать запрос
Сначала мягко — прервать только запрос, соединение останется:

\`\`\`mysql
KILL QUERY 123;
\`\`\`

\`\`\`postgresql
SELECT pg_cancel_backend(12345);
\`\`\`

Не помогло — закрыть соединение: \`KILL 123;\` / \`SELECT pg_terminate_backend(12345);\`. Незавершённые изменения этой транзакции откатятся.

> Не прерывайте запросы резервного копирования, миграции и долгие UPDATE без понимания: откат большого изменения может идти столько же, сколько само изменение.

## 4. Почему запрос медленный
- \`EXPLAIN\` перед запросом показывает план: «Seq Scan» (PostgreSQL) или type=ALL (MySQL) на большой таблице — нет подходящего индекса.
- Мало памяти под кэш: \`innodb_buffer_pool_size\` (MySQL) или \`shared_buffers\` (PostgreSQL) оставлены по умолчанию — диагностика подскажет.
- PostgreSQL: таблица раздулась «мёртвыми» строками — нужна очистка (VACUUM), см. проверку «PostgreSQL: очистка».
- Диск перегружен: \`iostat -x 1 5\` (столбец %util около 100).`
  },
  {
    id: 'ts-db-space', section: 'db', level: 'базовый', title: 'База занимает много места: binlog, pg_wal, слоты репликации',
    summary: 'Почему каталог базы растёт, что можно чистить, а что удалять руками нельзя ни в коем случае.',
    tags: ['место на диске база', 'binlog', 'pg_wal', 'журналы wal', 'слот репликации', 'кончилось место mysql', 'no space left on device', 'размер базы', 'раздувание', 'bloat'],
    body: `Когда диск с базой заполняется, MySQL/MariaDB перестаёт записывать данные (а при перезапуске может не стартовать), PostgreSQL останавливается. Проверка: «Диагностика → Linux → База занимает много места / кончается диск».

> **Никогда не удаляйте вручную файлы в /var/lib/mysql и /var/lib/postgresql** — ни binlog, ни pg_wal, ни «непонятные большие файлы». Это почти гарантированно ломает базу. Чистить — только командами ниже.

## Сколько занимают базы
\`\`\`mysql
SELECT table_schema, ROUND(SUM(data_length + index_length) / 1024 / 1024) AS mb FROM information_schema.tables GROUP BY table_schema ORDER BY mb DESC;
\`\`\`

\`\`\`postgresql
SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY pg_database_size(datname) DESC;
\`\`\`

## MySQL / MariaDB: двоичные журналы (binlog)
Журналы изменений для репликации и восстановления. Если срок хранения не задан, они копятся годами.

\`\`\`mysql
SHOW BINARY LOGS;
\`\`\`

Удалить журналы старше 7 дней — **только если реплики их уже получили** (на реплике проверьте SHOW REPLICA STATUS):

\`\`\`mysql
PURGE BINARY LOGS BEFORE NOW() - INTERVAL 7 DAY;
\`\`\`

Чтобы не копились: в настройках сервера \`binlog_expire_logs_seconds = 604800\` (7 дней; в старых MariaDB — \`expire_logs_days = 7\`).

## PostgreSQL: каталог pg_wal
Обычно pg_wal занимает сотни мегабайт. Если гигабайты — причина почти всегда одна из двух:
1. **Неактивный слот репликации** — реплика выключена или удалена, а слот держит журналы для неё:

\`\`\`postgresql
SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) FROM pg_replication_slots;
\`\`\`

   Если реплика больше не нужна: \`SELECT pg_drop_replication_slot('имя_слота');\` — место освободится после ближайшей контрольной точки.
2. **Сломано архивирование** (\`archive_command\` выдаёт ошибку) — смотрите \`SELECT * FROM pg_stat_archiver;\` (поле failed_count и last_failed_wal) и журнал PostgreSQL.

## Раздувание таблиц (PostgreSQL)
После массовых UPDATE и DELETE строки не исчезают сразу — их убирает автоочистка (autovacuum). \`VACUUM (ANALYZE) orders;\` освобождает место для новых данных внутри таблицы, но файл не уменьшает. Уменьшает файл \`VACUUM FULL orders;\` — **блокирует таблицу полностью** на всё время работы, только в окно обслуживания.

## Если место уже кончилось
1. Освободите место вне базы: старые логи в /var/log, старые резервные копии, \`journalctl --vacuum-size=200M\`.
2. Запустите базу, затем чистите binlog/слоты командами выше.
3. Не перезагружайте сервер «на удачу» — без места база может не подняться.`
  },
  {
    id: 'ts-db-start', section: 'db', level: 'базовый', title: 'Сервер базы данных не запускается или падает',
    summary: 'Где смотреть причину, типовые сообщения в журнале и порядок действий.',
    tags: ['база не запускается', 'mysql не стартует', 'mariadb failed', 'postgresql не запускается', 'упала база', 'oom', 'innodb corruption', 'журнал ошибок mysql', 'job for mariadb.service failed'],
    body: `Проверка в программе: «Диагностика → Linux → База упала или перезапускалась».

## 1. Состояние и журнал
\`\`\`linux
systemctl status mariadb
journalctl -u mariadb -n 80 --no-pager
\`\`\`

Для MySQL служба называется \`mysql\`. Подробный журнал ошибок MySQL/MariaDB — обычно \`/var/log/mysql/error.log\`.

\`\`\`linux
pg_lsclusters
sudo tail -n 100 /var/log/postgresql/postgresql-16-main.log
\`\`\`

## 2. Что означают типовые сообщения
| Сообщение | Причина | Что делать |
|---|---|---|
| No space left on device / Disk is full | кончилось место | [[ts-db-space]] |
| Out of memory, «Killed process … mysqld» в dmesg | не хватило ОЗУ, процесс убит | уменьшить innodb_buffer_pool_size / shared_buffers, добавить память |
| Can't start server: Bind on TCP/IP port: Address already in use | порт 3306 занят (второй экземпляр) | \`ss -tlnp | grep 3306\` |
| could not bind IPv4 address … Address already in use | порт 5432 занят | \`ss -tlnp | grep 5432\` |
| unknown variable / invalid value for parameter | ошибка в файле настроек | исправить последнюю правку конфигурации |
| InnoDB: Database page corruption, Assertion failure | повреждены файлы данных | **не экспериментировать**, сначала копия каталога данных, затем восстановление из резервной копии |
| could not open file … Permission denied | неправильный владелец файлов | владелец каталога данных — mysql или postgres |
| database system was interrupted; last known up at … | PostgreSQL восстанавливается после сбоя | подождать: это штатное восстановление |

## 3. После запуска
- Посмотрите, почему упал (сообщения **перед** остановкой в журнале).
- MySQL/MariaDB с таблицами MyISAM: \`sudo mysqlcheck --all-databases --check\` — проверка без изменений.
- Проверьте резервные копии — после аварии они особенно нужны.

> Режим принудительного восстановления InnoDB (\`innodb_force_recovery\`) — крайняя мера для выгрузки данных. Значения 4 и выше могут необратимо повредить данные; используйте только по документации и после копии каталога.`
  },
  {
    id: 'ts-db-replication', section: 'db', level: 'опытный', title: 'Репликация сломалась или отстаёт',
    summary: 'Как проверить реплику MySQL / MariaDB и PostgreSQL, типовые ошибки и безопасные действия.',
    tags: ['репликация', 'реплика отстает', 'slave', 'replica', 'seconds_behind_master', 'replication lag', 'standby', 'pg_stat_replication', 'last_sql_error'],
    body: `Проверка: «Диагностика → Linux → Репликация баз данных» — запускайте на основном сервере и на реплике.

## MySQL / MariaDB (на реплике)
\`\`\`mysql
SHOW REPLICA STATUS\\G
\`\`\`

В старых версиях — \`SHOW SLAVE STATUS\\G\`. Смотрите поля:
- \`Replica_IO_Running\` (\`Slave_IO_Running\`) — Yes: реплика получает журналы. No — сеть, пароль пользователя репликации или на основном сервере уже удалён нужный binlog (ошибка «Could not find first log file name»).
- \`Replica_SQL_Running\` — Yes: изменения применяются. No — смотрите \`Last_SQL_Error\`: чаще всего «Duplicate entry» или «Can't find record» — данные реплики разошлись с основным сервером.
- \`Seconds_Behind_Source\` (\`Seconds_Behind_Master\`) — отставание в секундах.

> Пропуск ошибки (sql_slave_skip_counter) делает данные реплики **неточными**. Надёжное решение при расхождении — пересоздать реплику из свежей копии основного сервера.

## PostgreSQL
На основном сервере:

\`\`\`postgresql
SELECT client_addr, state, replay_lag FROM pg_stat_replication;
\`\`\`

Нет строк — реплика не подключена. На реплике: \`SELECT pg_is_in_recovery();\` (t — это реплика) и \`SELECT now() - pg_last_xact_replay_timestamp();\` — отставание (если на основном сервере нет записей, оно растёт само по себе — это нормально).

Типовые проблемы:
- В журнале реплики «requested WAL segment … has already been removed» — основной сервер удалил нужные журналы. Реплику придётся пересоздать (pg_basebackup); на будущее — слот репликации или больший \`wal_keep_size\`.
- Неактивный слот на основном сервере копит журналы и заполняет диск — [[ts-db-space]].
- Реплика не подключается: строка \`host replication …\` в pg_hba.conf основного сервера и пароль пользователя репликации.`
  }
];
