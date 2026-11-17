// Диагностика баз данных MySQL / MariaDB и PostgreSQL: типовые проблемы.
// Все команды только читают. Запросы выполняются под пользователем SSH-сессии без sudo:
// под root работает вход через сокет (MySQL/MariaDB в Debian/Ubuntu) и runuser -u postgres;
// под обычным пользователем — если есть ~/.my.cnf / ~/.pgpass. Иначе проверка честно сообщает,
// что доступа нет, и что сделать.
import type { CheckAnalysis, CmdOutput, LinuxCheckDef } from './linuxDiag';

const lines = (s: string) => s.split(/\r?\n/).filter((l) => l.trim());
const num = (v: string | undefined) => (v === undefined || v === '' || v === 'NULL' ? NaN : Number(v));
const dur = (sec: number) => (sec >= 86400 ? `${Math.floor(sec / 86400)} д ${Math.floor((sec % 86400) / 3600)} ч` : sec >= 3600 ? `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин` : sec >= 60 ? `${Math.floor(sec / 60)} мин` : `${sec} с`);
const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} ГБ` : `${Math.round(b / 1024 ** 2)} МБ`);

/** Запрос к MySQL/MariaDB без рамок и заголовков (значения через табуляцию). */
export const MY = (sql: string) => `command -v mysql >/dev/null 2>&1 || { echo NO_CLIENT; exit 0; }; mysql -N -B -e "${sql}" 2>&1`;
/** Клиент psql: под root — от имени postgres (runuser), иначе — от текущего пользователя. */
const PSQL_AS = `cd /tmp; P=psql; [ "$(id -u)" = 0 ] && P="runuser -u postgres -- psql"`;
/** Запрос к PostgreSQL: значения через «|», без заголовков. */
export const PGQ = (sql: string, db = 'postgres') => `command -v psql >/dev/null 2>&1 || { echo NO_CLIENT; exit 0; }; ${PSQL_AS}; $P -X -At -F'|' -d ${db} -c "${sql}" 2>&1`;

type Db = 'mysql' | 'pg';

/** Нет клиента, нет доступа, сервер не отвечает — понятный результат вместо «ошибки». */
export function accessProblem(out: string, db: Db): CheckAnalysis | null {
  const name = db === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL';
  if (/NO_CLIENT/.test(out)) return { status: 'info', summary: `${name} не установлен на этом сервере (нет клиента ${db === 'mysql' ? 'mysql' : 'psql'})`, findings: [] };
  if (db === 'mysql') {
    if (/ERROR 1045|Access denied/i.test(out))
      return { status: 'info', summary: 'Нет доступа к MySQL под текущим пользователем SSH', findings: ['Подключитесь к серверу под root (вход в MySQL через сокет) или создайте ~/.my.cnf с логином и паролем пользователя для мониторинга (права 600).', 'Для мониторинга достаточно: GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO \'monitor\'@\'localhost\'; (в MariaDB 10.5 и новее для состояния реплики добавьте SLAVE MONITOR).'] };
    if (/ERROR 2002|ERROR 2003|Can't connect to/i.test(out))
      return { status: 'crit', summary: 'Сервер MySQL / MariaDB не отвечает', findings: ['Служба остановлена или упала: systemctl status mariadb (или mysql), journalctl -u mariadb -n 50.', 'Частые причины: нет места на диске, ошибка в конфигурации, повреждение файлов InnoDB, нехватка памяти (OOM).'] };
  } else {
    if (/Peer authentication failed|role "[^"]+" does not exist|password authentication failed|no password supplied|permission denied for/i.test(out))
      return { status: 'info', summary: 'Нет доступа к PostgreSQL под текущим пользователем SSH', findings: ['Подключитесь под root — проверки выполнятся от имени postgres (runuser), без sudo.', 'Или создайте ~/.pgpass для пользователя с ролью pg_monitor: GRANT pg_monitor TO имя;'] };
    if (/could not connect to server|connection to server .* failed|No such file or directory|Connection refused/i.test(out))
      return { status: 'crit', summary: 'Сервер PostgreSQL не отвечает', findings: ['Кластер остановлен или упал: pg_lsclusters, systemctl status postgresql@ВЕРСИЯ-main, журнал /var/log/postgresql/.', 'Частые причины: нет места на диске (особенно под pg_wal), ошибка в postgresql.conf, нехватка памяти.'] };
  }
  if (/^ERROR\b|^psql: error/m.test(out)) return { status: 'unknown', summary: 'Запрос не выполнен', findings: [out.split('\n').find((l) => /ERROR|error/.test(l)) ?? out.slice(0, 200)] };
  return null;
}

function kv(text: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const l of lines(text)) {
    const [k, ...v] = l.split('\t');
    if (k && v.length) r[k.trim()] = v.join('\t').trim();
  }
  return r;
}

function dfUse(text: string): { pct: number; mount: string; avail: number } | null {
  const m = /\s(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\S+)\s*$/m.exec(text);
  return m ? { pct: Number(m[4]), mount: m[5], avail: Number(m[3]) * 1024 } : null;
}

const MY_SERVICE = 'for s in mariadb mysql; do echo "$s=$(systemctl is-active "$s" 2>/dev/null)"; done';
const MY_LOG_ERR = `command -v mysql >/dev/null 2>&1 || { echo NO_CLIENT; exit 0; }; L=$(mysql -N -B -e "SELECT @@log_error" 2>/dev/null); if [ -n "$L" ] && [ "$L" != "stderr" ] && [ -r "$L" ]; then echo "LOG=$L"; grep -iE "\\[ERROR\\]|crash|corrupt|Too many connections|Out of memory|Aborted connection|Disk is full|No space left" "$L" | tail -n 25; else echo "LOG=journal"; journalctl -u mariadb -u mysql -n 300 --no-pager 2>/dev/null | grep -iE "\\[ERROR\\]|crash|corrupt|Too many connections|Out of memory|Disk is full|No space left" | tail -n 25; fi`;

export const DB_CHECKS: LinuxCheckDef[] = [
  // ======================= MySQL / MariaDB =======================
  {
    id: 'db-mysql-service',
    title: 'MySQL / MariaDB: служба',
    commands: [MY_SERVICE, 'systemctl show -p NRestarts --value mariadb 2>/dev/null; systemctl show -p NRestarts --value mysql 2>/dev/null', 'dmesg 2>/dev/null | grep -iE "killed process .*(mysqld|mariadbd)" | tail -n 3'],
    criteria: 'Служба должна быть active. failed — сервер упал. Перезапуски systemd или убийство процесса OOM-killer — признак нехватки памяти или аварий.',
    analyze(out) {
      const st = lines(out[0]?.output ?? '').map((l) => l.split('=')).filter(([, v]) => v && v !== 'inactive' && v !== 'unknown');
      if (!st.length) return { status: 'info', summary: 'Служба MySQL / MariaDB не найдена (не установлен или называется иначе)', findings: [] };
      const restarts = lines(out[1]?.output ?? '').map(Number).filter((n) => !Number.isNaN(n)).reduce((a, b) => a + b, 0);
      const oom = lines(out[2]?.output ?? '');
      const bad = st.filter(([, v]) => v !== 'active');
      const findings: string[] = [];
      if (bad.length) findings.push(`Служба не работает: ${bad.map(([n, v]) => `${n} (${v})`).join(', ')}. Причина — journalctl -u ${bad[0][0]} -n 80 --no-pager.`);
      if (restarts > 0) findings.push(`systemd перезапускал службу ${restarts} раз(а) — сервер падал. Смотрите журнал ошибок.`);
      if (oom.length) findings.push('Процесс базы был убит OOM-killer (не хватило памяти). Уменьшите innodb_buffer_pool_size или добавьте ОЗУ.');
      return { status: bad.length ? 'crit' : restarts > 0 || oom.length ? 'warn' : 'ok', summary: st.map(([n, v]) => `${n}: ${v}`).join(', '), metrics: { restarts }, findings };
    }
  },
  {
    id: 'db-mysql-conn',
    title: 'MySQL / MariaDB: подключения и нагрузка',
    commands: [MY("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Uptime','Aborted_connects','Slow_queries','Questions'); SHOW VARIABLES WHERE Variable_name IN ('max_connections','version','version_comment','bind_address','port');")],
    criteria: 'Занято соединений: до 60 % — норма, 60–80 % — внимание, больше 80 % или Max_used_connections = max_connections — проблема (клиенты получают «Too many connections»). Время работы меньше часа без плановых перезапусков — сервер падал.',
    analyze(out) {
      const raw = out[0]?.output ?? '';
      const ap = accessProblem(raw, 'mysql');
      if (ap) return ap;
      const v = kv(raw);
      const conn = num(v.Threads_connected);
      const max = num(v.max_connections);
      const maxUsed = num(v.Max_used_connections);
      const uptime = num(v.Uptime);
      const running = num(v.Threads_running);
      const usage = max ? (conn / max) * 100 : NaN;
      const findings: string[] = [];
      let status: CheckAnalysis['status'] = 'ok';
      if (usage > 80 || (maxUsed && max && maxUsed >= max)) {
        status = 'crit';
        findings.push(`Соединения на пределе (${conn} из ${max}, пик ${maxUsed}). Найдите, кто держит соединения: SHOW FULL PROCESSLIST; — часто это приложение без пула или зависшие запросы.`);
      } else if (usage > 60) {
        status = 'warn';
        findings.push(`Занято ${Math.round(usage)} % соединений (${conn} из ${max}).`);
      }
      if (uptime < 3600) {
        if (status === 'ok') status = 'warn';
        findings.push(`Сервер работает всего ${dur(uptime)} — если перезапуск не плановый, ищите причину в журнале ошибок.`);
      }
      if (running > 30) findings.push(`Одновременно выполняется ${running} запросов — сервер под высокой нагрузкой или запросы ждут блокировок.`);
      if (/^(0\.0\.0\.0|\*|::)$/.test(v.bind_address ?? '')) findings.push(`Сервер слушает все сетевые адреса (bind_address = ${v.bind_address}). Убедитесь, что порт ${v.port ?? 3306} закрыт firewall для посторонних.`);
      const product = /mariadb/i.test(`${v.version} ${v.version_comment}`) ? 'MariaDB' : 'MySQL';
      return {
        status,
        summary: `${product} ${v.version ?? ''}: соединений ${conn} из ${max} (пик ${maxUsed}), выполняется ${running}, работает ${dur(uptime || 0)}, медленных запросов ${v.Slow_queries ?? '?'}`,
        metrics: { connections: conn, max_connections: max, usage_pct: Math.round(usage), slow_queries: num(v.Slow_queries), aborted_connects: num(v.Aborted_connects) },
        findings
      };
    }
  },
  {
    id: 'db-mysql-locks',
    title: 'MySQL / MariaDB: долгие запросы и блокировки',
    commands: [
      MY("SELECT id, user, IFNULL(db,'-'), time, IFNULL(state,'-'), LEFT(REPLACE(IFNULL(info,''), '\\n', ' '), 90) FROM information_schema.processlist WHERE command NOT IN ('Sleep','Daemon','Binlog Dump') AND time > 60 ORDER BY time DESC LIMIT 10;"),
      MY('SELECT trx_mysql_thread_id, TIMESTAMPDIFF(SECOND, trx_started, NOW()), trx_state FROM information_schema.innodb_trx WHERE trx_started < NOW() - INTERVAL 5 MINUTE ORDER BY trx_started LIMIT 10;'),
      MY("SELECT COUNT(*) FROM information_schema.processlist WHERE state LIKE 'Waiting for%lock%';")
    ],
    criteria: 'Запросы дольше 1 минуты — внимание, дольше 10 минут — проблема. Транзакции, открытые дольше 5 минут, держат блокировки. Запросы, ждущие блокировку, — проблема.',
    analyze(out) {
      const ap = accessProblem(out[0]?.output ?? '', 'mysql');
      if (ap) return ap;
      const q = lines(out[0]?.output ?? '').map((l) => l.split('\t'));
      const trx = lines(out[1]?.output ?? '').map((l) => l.split('\t'));
      const waits = num(lines(out[2]?.output ?? '')[0]) || 0;
      const longest = q.length ? num(q[0][3]) : 0;
      const findings = [
        ...q.slice(0, 5).map((r) => `Запрос №${r[0]} (${r[1]}, база ${r[2]}) выполняется ${dur(num(r[3]))}: ${r[5] || r[4]}`),
        ...trx.slice(0, 5).map((r) => `Транзакция соединения №${r[0]} открыта ${dur(num(r[1]))} — держит блокировки. Если это зависшее приложение: KILL ${r[0]};`),
        ...(waits ? [`${waits} запрос(ов) ждут блокировку таблицы (metadata lock) — обычно из-за ALTER TABLE и незакрытой транзакции.`] : [])
      ];
      const status = waits || longest > 600 ? 'crit' : q.length || trx.length ? 'warn' : 'ok';
      const n = (a: unknown[]) => (a.length >= 10 ? 'не меньше 10' : String(a.length));
      return { status, summary: `Долгих запросов: ${n(q)}, долгих транзакций: ${n(trx)}, ожидают блокировку: ${waits}`, metrics: { long_queries: q.length, long_trx: trx.length, lock_waits: waits }, findings };
    }
  },
  {
    id: 'db-mysql-disk',
    title: 'MySQL / MariaDB: место на диске',
    commands: [
      'D=$(mysql -N -B -e "SELECT @@datadir" 2>/dev/null); D=${D:-/var/lib/mysql}; echo "DIR=$D"; df -P "$D" 2>/dev/null | tail -n 1',
      MY("SELECT table_schema, ROUND(SUM(data_length+index_length)) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','performance_schema','sys') GROUP BY table_schema ORDER BY 2 DESC LIMIT 5;"),
      MY('SHOW BINARY LOGS;')
    ],
    criteria: 'Раздел с каталогом данных занят меньше чем на 80 % — норма, 80–90 % — внимание, больше 90 % — проблема: при заполнении сервер останавливает запись или не запускается. Двоичные журналы (binlog) должны удаляться автоматически.',
    analyze(out) {
      if (/NO_CLIENT/.test(out[1]?.output ?? '')) return accessProblem(out[1].output, 'mysql')!;
      const dir = /DIR=(.*)/.exec(out[0]?.output ?? '')?.[1] ?? '/var/lib/mysql';
      const df = dfUse(out[0]?.output ?? '');
      const dbs = (accessProblem(out[1]?.output ?? '', 'mysql') ? [] : lines(out[1]?.output ?? '').map((l) => l.split('\t'))).filter((r) => r.length >= 2);
      const binOut = out[2]?.output ?? '';
      const binTotal = /ERROR|NO_CLIENT|denied/i.test(binOut) ? 0 : lines(binOut).map((l) => num(l.split('\t')[1])).filter((n) => !Number.isNaN(n)).reduce((a, b) => a + b, 0);
      if (!df && !dbs.length) {
        const ap = accessProblem(out[1]?.output ?? '', 'mysql');
        return ap ?? { status: 'unknown', summary: 'Не удалось определить место на диске', findings: [] };
      }
      const findings: string[] = [];
      let status: CheckAnalysis['status'] = 'ok';
      if (df && df.pct >= 90) {
        status = 'crit';
        findings.push(`Раздел ${df.mount} (данные ${dir}) заполнен на ${df.pct} %, свободно ${gb(df.avail)}. Освободите место до того, как база остановится.`);
      } else if (df && df.pct >= 80) {
        status = 'warn';
        findings.push(`Раздел ${df.mount} заполнен на ${df.pct} %.`);
      }
      if (binTotal > 5 * 1024 ** 3) findings.push(`Двоичные журналы занимают ${gb(binTotal)}. Проверьте срок хранения (binlog_expire_logs_seconds / expire_logs_days). Не удаляйте файлы вручную — только PURGE BINARY LOGS, и только если реплики их уже получили.`);
      if (dbs.length) findings.push(`Самые большие базы: ${dbs.map((r) => `${r[0]} — ${gb(num(r[1]))}`).join(', ')}`);
      return { status, summary: `${df ? `Раздел ${df.mount}: ${df.pct} % занято, свободно ${gb(df.avail)}` : 'Раздел не определён'}${binTotal ? `; binlog ${gb(binTotal)}` : ''}`, metrics: df ? { disk_used_pct: df.pct } : undefined, findings };
    }
  },
  {
    id: 'db-mysql-replication',
    title: 'MySQL / MariaDB: репликация',
    commands: ['command -v mysql >/dev/null 2>&1 || { echo NO_CLIENT; exit 0; }; mysql -e "SHOW REPLICA STATUS\\G" 2>/dev/null || mysql -e "SHOW SLAVE STATUS\\G" 2>&1'],
    criteria: 'Если сервер — реплика: оба потока (IO и SQL) должны быть Yes, отставание — секунды. No или NULL — репликация остановлена, отставание больше 5 минут — внимание.',
    analyze(out) {
      const raw = out[0]?.output ?? '';
      const ap = accessProblem(raw, 'mysql');
      if (ap) return ap;
      if (!raw.trim()) return { status: 'info', summary: 'Сервер не является репликой (репликация не настроена)', findings: [] };
      const f = (re: RegExp) => re.exec(raw)?.[1]?.trim() ?? '';
      const io = f(/(?:Replica|Slave)_IO_Running:\s*(.*)/);
      const sql = f(/(?:Replica|Slave)_SQL_Running:\s*(.*)/);
      const behind = f(/Seconds_Behind_(?:Source|Master):\s*(.*)/);
      const ioErr = f(/Last_IO_Error:\s*(.*)/);
      const sqlErr = f(/Last_SQL_Error:\s*(.*)/);
      const findings: string[] = [];
      if (io !== 'Yes') findings.push(`Поток чтения (IO) не работает: ${io || '?'}. ${ioErr || 'Проверьте сеть до основного сервера, пароль пользователя репликации и что нужные binlog ещё существуют.'}`);
      if (sql !== 'Yes') findings.push(`Поток применения (SQL) остановлен: ${sql || '?'}. ${sqlErr || 'Смотрите Last_SQL_Error в SHOW REPLICA STATUS.'}`);
      const lag = num(behind);
      if (!Number.isNaN(lag) && lag > 300) findings.push(`Реплика отстаёт на ${dur(lag)}.`);
      const status = io !== 'Yes' || sql !== 'Yes' ? 'crit' : lag > 300 ? 'warn' : 'ok';
      return { status, summary: `Реплика: IO ${io || '?'}, SQL ${sql || '?'}, отставание ${behind === 'NULL' || !behind ? 'неизвестно' : dur(lag)}`, metrics: Number.isNaN(lag) ? undefined : { lag_sec: lag }, findings };
    }
  },
  {
    id: 'db-mysql-errors',
    title: 'MySQL / MariaDB: журнал ошибок',
    commands: [MY_LOG_ERR],
    criteria: 'Сообщения о повреждении (corrupt), авариях (crash), нехватке памяти или места, «Too many connections» — проблема. Отдельные «Aborted connection» обычно безобидны (клиент закрыл соединение некорректно).',
    analyze(out) {
      const raw = out[0]?.output ?? '';
      if (/NO_CLIENT/.test(raw)) return accessProblem(raw, 'mysql')!;
      const src = /LOG=(.*)/.exec(raw)?.[1] ?? '';
      const ls = lines(raw).filter((l) => !l.startsWith('LOG='));
      const has = (re: RegExp) => ls.filter((l) => re.test(l));
      const corrupt = has(/corrupt|crash|assertion/i);
      const space = has(/Disk is full|No space left/i);
      const oom = has(/Out of memory|Cannot allocate/i);
      const tooMany = has(/Too many connections/i);
      const errors = has(/\[ERROR\]/i);
      const aborted = has(/Aborted connection/i);
      const findings: string[] = [];
      if (corrupt.length) findings.push(`Признаки повреждения или аварии (${corrupt.length}): ${corrupt[corrupt.length - 1].slice(0, 200)}`);
      if (space.length) findings.push('Заканчивалось место на диске — проверьте df -h и каталог данных.');
      if (oom.length) findings.push('Серверу не хватало памяти.');
      if (tooMany.length) findings.push(`Были отказы «Too many connections» (${tooMany.length}). См. проверку «подключения».`);
      if (errors.length && !corrupt.length) findings.push(`Последняя ошибка: ${errors[errors.length - 1].slice(0, 200)}`);
      if (aborted.length > 10) findings.push(`Много оборванных соединений (${aborted.length}) — приложение не закрывает соединения или рвётся сеть.`);
      const status = corrupt.length || space.length || oom.length ? 'crit' : tooMany.length || errors.length ? 'warn' : 'ok';
      return {
        status,
        summary: src === 'journal' ? `Журнал systemd: найдено строк с ошибками — ${ls.length}` : src ? `Файл ${src}: найдено строк с ошибками — ${ls.length}` : 'Журнал ошибок не найден или нет прав на чтение',
        findings
      };
    }
  },
  {
    id: 'db-mysql-config',
    title: 'MySQL / MariaDB: память, кодировка, таблицы',
    commands: [
      MY("SELECT @@innodb_buffer_pool_size, @@character_set_server, @@max_connections, @@version;"),
      "awk '/MemTotal/ {print $2*1024}' /proc/meminfo",
      MY("SELECT engine, COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys') AND engine IS NOT NULL GROUP BY engine;")
    ],
    criteria: 'Буфер InnoDB на выделенном сервере БД — обычно 50–70 % ОЗУ (по умолчанию всего 128 МБ). Кодировка сервера — utf8mb4. Таблицы MyISAM не поддерживают транзакции и повреждаются при сбоях — внимание.',
    analyze(out) {
      const ap = accessProblem(out[0]?.output ?? '', 'mysql');
      if (ap) return ap;
      const [pool, charset, maxConn, version] = (lines(out[0]?.output ?? '')[0] ?? '').split('\t');
      const ram = num(lines(out[1]?.output ?? '')[0]);
      const engines = lines(out[2]?.output ?? '').map((l) => l.split('\t'));
      const myisam = engines.find(([e]) => /myisam|aria/i.test(e));
      const poolB = num(pool);
      const findings: string[] = [];
      let status: CheckAnalysis['status'] = 'ok';
      if (ram && poolB && poolB < ram * 0.15 && ram > 2 * 1024 ** 3) findings.push(`Буфер InnoDB ${gb(poolB)} при ${gb(ram)} ОЗУ. Если сервер выделен под базу, увеличьте innodb_buffer_pool_size (обычно 50–70 % ОЗУ).`);
      if (ram && poolB && poolB > ram * 0.85) {
        status = 'warn';
        findings.push(`Буфер InnoDB ${gb(poolB)} почти равен всей памяти (${gb(ram)}) — риск, что OOM-killer остановит сервер.`);
      }
      if (charset && !/utf8mb4/i.test(charset)) {
        if (status === 'ok') status = 'warn';
        findings.push(`Кодировка сервера ${charset}, а не utf8mb4 — возможны «кракозябры» и потеря символов.`);
      }
      if (myisam) {
        if (status === 'ok') status = 'warn';
        findings.push(`Таблиц на движке ${myisam[0]}: ${myisam[1]}. Они не поддерживают транзакции и могут ломаться при сбое питания; по возможности переведите на InnoDB (ALTER TABLE … ENGINE=InnoDB).`);
      }
      return { status, summary: `${version ?? ''}: буфер InnoDB ${poolB ? gb(poolB) : '?'}${ram ? ` из ${gb(ram)} ОЗУ` : ''}, кодировка ${charset ?? '?'}, max_connections ${maxConn ?? '?'}; движки: ${engines.map(([e, n]) => `${e} ${n}`).join(', ') || '—'}`, findings };
    }
  },

  // ======================= PostgreSQL =======================
  {
    id: 'db-pg-service',
    title: 'PostgreSQL: кластеры и журнал',
    commands: [
      'command -v pg_lsclusters >/dev/null 2>&1 && pg_lsclusters --no-header 2>/dev/null || systemctl list-units "postgresql*" --no-legend --no-pager 2>/dev/null',
      'tail -n 400 /var/log/postgresql/postgresql-*.log 2>/dev/null | grep -E "FATAL|PANIC|ERROR|could not|No space" | tail -n 25',
      'dmesg 2>/dev/null | grep -iE "killed process .*postgres" | tail -n 3'
    ],
    criteria: 'Каждый кластер должен быть online. PANIC, нехватка места, убийство процесса OOM-killer — проблема. Частые FATAL «too many clients» — нехватка соединений. «password authentication failed» и «no pg_hba.conf entry» — неудачные входы (неверный пароль или запрещённый адрес).',
    analyze(out) {
      const cl = lines(out[0]?.output ?? '');
      if (!cl.length) return { status: 'info', summary: 'PostgreSQL не установлен на этом сервере', findings: [] };
      const down = cl.filter((l) => /\bdown\b|failed/i.test(l));
      const log = lines(out[1]?.output ?? '');
      const oom = lines(out[2]?.output ?? '');
      const has = (re: RegExp) => log.filter((l) => re.test(l));
      const panic = has(/PANIC|No space|could not write|could not extend/i);
      const tooMany = has(/too many clients|remaining connection slots/i);
      const auth = has(/password authentication failed|no pg_hba\.conf entry/i);
      const findings: string[] = [];
      for (const l of down) {
        const [ver, name, , , , , logf] = l.trim().split(/\s+/);
        findings.push(`Кластер ${ver} ${name} не работает. Причина — в журнале ${logf && logf.startsWith('/') ? logf : '/var/log/postgresql/'} и journalctl -u postgresql@${ver}-${name} -n 80 --no-pager. Запуск после устранения причины: pg_ctlcluster ${ver} ${name} start`);
      }
      if (panic.length) findings.push(`Серьёзные ошибки (${panic.length}): ${panic[panic.length - 1].slice(0, 200)}`);
      if (oom.length) findings.push('Процесс PostgreSQL был убит OOM-killer — не хватает памяти.');
      if (tooMany.length) findings.push(`Отказы из-за нехватки соединений (${tooMany.length}) — см. проверку «подключения».`);
      if (auth.length) findings.push(`Неудачные входы (${auth.length}): ${auth[auth.length - 1].slice(0, 160)}. Проверьте пароль приложения и строки pg_hba.conf.`);
      const status = down.length || panic.length || oom.length ? 'crit' : tooMany.length ? 'warn' : 'ok';
      return { status, summary: cl.map((l) => l.replace(/\s+/g, ' ').trim()).join('; '), findings };
    }
  },
  {
    id: 'db-pg-conn',
    title: 'PostgreSQL: подключения и нагрузка',
    commands: [
      PGQ("SELECT count(*), current_setting('max_connections'), count(*) FILTER (WHERE state = 'active'), count(*) FILTER (WHERE state LIKE 'idle in transaction%'), extract(epoch from now() - pg_postmaster_start_time())::int, split_part(version(), ' ', 2) FROM pg_stat_activity WHERE backend_type = 'client backend';"),
      PGQ("SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 1), sum(deadlocks), sum(temp_bytes) FROM pg_stat_database;")
    ],
    criteria: 'Занято соединений до 60 % — норма, 60–80 % — внимание, больше 80 % — проблема (новые клиенты получат «too many clients»). Попадание в кэш на рабочей базе — 95–99 %. Время работы меньше часа без плановых перезапусков — сервер падал.',
    analyze(out) {
      const ap = accessProblem(out[0]?.output ?? '', 'pg');
      if (ap) return ap;
      const [conn, max, active, idleTrx, uptime, version] = (lines(out[0]?.output ?? '')[0] ?? '').split('|').map((x) => x.trim());
      const [hit, deadlocks, tempBytes] = (lines(out[1]?.output ?? '')[0] ?? '').split('|');
      const c = num(conn);
      const m = num(max);
      const usage = m ? (c / m) * 100 : NaN;
      const findings: string[] = [];
      let status: CheckAnalysis['status'] = 'ok';
      if (usage > 80) {
        status = 'crit';
        findings.push(`Соединения на пределе: ${c} из ${m}. Обычно помогает пул соединений (PgBouncer), а не увеличение max_connections.`);
      } else if (usage > 60) {
        status = 'warn';
        findings.push(`Занято ${Math.round(usage)} % соединений.`);
      }
      if (num(idleTrx) > 0) {
        if (status === 'ok') status = 'warn';
        findings.push(`Соединений «idle in transaction»: ${idleTrx} — приложение открыло транзакцию и не закрыло (держит блокировки, мешает VACUUM).`);
      }
      if (num(uptime) < 3600) {
        if (status === 'ok') status = 'warn';
        findings.push(`Сервер работает всего ${dur(num(uptime))} — если перезапуск не плановый, ищите причину в журнале.`);
      }
      const h = num(hit);
      if (!Number.isNaN(h) && h < 90) findings.push(`Попадание в кэш ${h} % — для горячих данных не хватает памяти (shared_buffers, ОЗУ сервера) или идут полные сканирования больших таблиц.`);
      if (num(deadlocks) > 0) findings.push(`Взаимоблокировок (deadlock) с момента сброса статистики: ${deadlocks}. Подробности — в журнале PostgreSQL.`);
      if (num(tempBytes) > 10 * 1024 ** 3) findings.push(`Запросы записали во временные файлы ${gb(num(tempBytes))} — мало work_mem или тяжёлые сортировки.`);
      return {
        status,
        summary: `PostgreSQL ${version ?? ''}: соединений ${c} из ${m}, активных ${active}, idle in transaction ${idleTrx}, работает ${dur(num(uptime) || 0)}, кэш ${hit ?? '?'} %`,
        metrics: { connections: c, max_connections: m, usage_pct: Math.round(usage), cache_hit_pct: h, idle_in_trx: num(idleTrx) },
        findings
      };
    }
  },
  {
    id: 'db-pg-locks',
    title: 'PostgreSQL: долгие запросы и блокировки',
    commands: [
      PGQ("SELECT pid, usename, datname, state, extract(epoch from now() - query_start)::int, left(regexp_replace(query, '\\s+', ' ', 'g'), 90) FROM pg_stat_activity WHERE state <> 'idle' AND backend_type = 'client backend' AND now() - query_start > interval '1 minute' ORDER BY 5 DESC LIMIT 10;"),
      PGQ('SELECT pid, pg_blocking_pids(pid), extract(epoch from now() - query_start)::int FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0 LIMIT 10;'),
      PGQ("SELECT pid, usename, extract(epoch from now() - xact_start)::int FROM pg_stat_activity WHERE state LIKE 'idle in transaction%' AND now() - xact_start > interval '5 minutes' ORDER BY 3 DESC LIMIT 10;")
    ],
    criteria: 'Запросы дольше 1 минуты — внимание, дольше 10 минут или заблокированные запросы — проблема. Транзакции «idle in transaction» дольше 5 минут держат блокировки и мешают очистке.',
    analyze(out) {
      const ap = accessProblem(out[0]?.output ?? '', 'pg');
      if (ap) return ap;
      const q = lines(out[0]?.output ?? '').map((l) => l.split('|'));
      const blocked = lines(out[1]?.output ?? '').map((l) => l.split('|'));
      const idle = lines(out[2]?.output ?? '').map((l) => l.split('|'));
      const longest = q.length ? num(q[0][4]) : 0;
      const findings = [
        ...q.slice(0, 5).map((r) => `pid ${r[0]} (${r[1]}, база ${r[2]}, ${r[3]}) — ${dur(num(r[4]))}: ${r[5]}`),
        ...blocked.slice(0, 5).map((r) => {
          const by = /\d+/.exec(r[1] ?? '')?.[0] ?? 'PID';
          return `pid ${r[0]} ждёт ${dur(num(r[2]))}, его блокирует ${r[1]}. Если блокирующий запрос можно прервать: SELECT pg_cancel_backend(${by}); (не помогло — pg_terminate_backend)`;
        }),
        ...idle.slice(0, 5).map((r) => `pid ${r[0]} (${r[1]}): транзакция простаивает ${dur(num(r[2]))}. Закрыть: SELECT pg_terminate_backend(${r[0]});`)
      ];
      const status = blocked.length || longest > 600 ? 'crit' : q.length || idle.length ? 'warn' : 'ok';
      const n = (a: unknown[]) => (a.length >= 10 ? 'не меньше 10' : String(a.length));
      return { status, summary: `Долгих запросов: ${n(q)}, заблокированных: ${n(blocked)}, зависших транзакций: ${n(idle)}`, metrics: { long_queries: q.length, blocked: blocked.length, idle_in_trx_long: idle.length }, findings };
    }
  },
  {
    id: 'db-pg-disk',
    title: 'PostgreSQL: место на диске и журналы WAL',
    commands: [
      `command -v psql >/dev/null 2>&1 || { echo NO_CLIENT; exit 0; }; ${PSQL_AS}; D=$($P -X -At -c "SHOW data_directory" 2>/dev/null); D=\${D:-/var/lib/postgresql}; echo "DIR=$D"; df -P "$D" 2>/dev/null | tail -n 1; echo "WAL=$(du -sb "$D/pg_wal" 2>/dev/null | cut -f1)"`,
      PGQ('SELECT datname, pg_database_size(datname) FROM pg_database WHERE NOT datistemplate ORDER BY 2 DESC LIMIT 5;')
    ],
    criteria: 'Раздел с данными занят меньше чем на 80 % — норма, 80–90 % — внимание, больше 90 % — проблема: при заполнении PostgreSQL останавливается. Каталог pg_wal больше нескольких гигабайт — признак неактивного слота репликации или сломанного архивирования WAL.',
    analyze(out) {
      const raw = out[0]?.output ?? '';
      if (/NO_CLIENT/.test(raw)) return { status: 'info', summary: 'PostgreSQL не установлен на этом сервере', findings: [] };
      const dir = /DIR=(.*)/.exec(raw)?.[1] ?? '';
      const df = dfUse(raw);
      const wal = num(/WAL=(\d*)/.exec(raw)?.[1]);
      const dbs = accessProblem(out[1]?.output ?? '', 'pg') ? [] : lines(out[1]?.output ?? '').map((l) => l.split('|'));
      const findings: string[] = [];
      let status: CheckAnalysis['status'] = 'ok';
      if (df && df.pct >= 90) {
        status = 'crit';
        findings.push(`Раздел ${df.mount} (данные ${dir}) заполнен на ${df.pct} %, свободно ${gb(df.avail)}.`);
      } else if (df && df.pct >= 80) {
        status = 'warn';
        findings.push(`Раздел ${df.mount} заполнен на ${df.pct} %.`);
      }
      if (wal > 4 * 1024 ** 3) {
        if (status === 'ok') status = 'warn';
        findings.push(`Каталог pg_wal занимает ${gb(wal)}. Проверьте слоты репликации (проверка «репликация») и archive_command. Не удаляйте файлы WAL вручную.`);
      }
      if (dbs.length) findings.push(`Самые большие базы: ${dbs.map((r) => `${r[0]} — ${gb(num(r[1]))}`).join(', ')}`);
      const ap = accessProblem(out[1]?.output ?? '', 'pg');
      if (ap && !df) return ap;
      if (ap) findings.push(`${ap.summary}: размеры баз и каталог pg_wal не проверены, показан раздел с ${dir || '/var/lib/postgresql'}.`);
      return { status, summary: `${df ? `Раздел ${df.mount}: ${df.pct} % занято, свободно ${gb(df.avail)}` : 'Раздел не определён (нет прав)'}${wal ? `; pg_wal ${gb(wal)}` : ''}`, metrics: df ? { disk_used_pct: df.pct } : undefined, findings };
    }
  },
  {
    id: 'db-pg-replication',
    title: 'PostgreSQL: репликация и слоты',
    commands: [
      PGQ('SELECT pg_is_in_recovery();'),
      PGQ('SELECT coalesce(host(client_addr), \'local\'), state, coalesce(extract(epoch from replay_lag)::int, 0) FROM pg_stat_replication;'),
      PGQ('SELECT slot_name, active, coalesce(pg_wal_lsn_diff(CASE WHEN pg_is_in_recovery() THEN pg_last_wal_receive_lsn() ELSE pg_current_wal_lsn() END, restart_lsn)::bigint, 0) FROM pg_replication_slots;'),
      PGQ('SELECT coalesce(extract(epoch from now() - pg_last_xact_replay_timestamp())::int, -1) WHERE pg_is_in_recovery();')
    ],
    criteria: 'Основной сервер: все реплики в состоянии streaming, отставание — секунды. Неактивный слот, удерживающий больше 1 ГБ журналов, — проблема (заполнит диск). Реплика: отставание больше 5 минут — внимание (при отсутствии записей на основном сервере отставание растёт естественно).',
    analyze(out) {
      const ap = accessProblem(out[0]?.output ?? '', 'pg');
      if (ap) return ap;
      const standby = /^t/.test(lines(out[0]?.output ?? '')[0] ?? '');
      const reps = lines(out[1]?.output ?? '').map((l) => l.split('|'));
      const slots = lines(out[2]?.output ?? '').map((l) => l.split('|'));
      const lag = num(lines(out[3]?.output ?? '')[0]);
      const findings: string[] = [];
      let status: CheckAnalysis['status'] = 'ok';
      for (const [name, active, retained] of slots) {
        const r = num(retained);
        if (active !== 't' && r > 1024 ** 3) {
          status = 'crit';
          findings.push(`Неактивный слот «${name}» удерживает ${gb(r)} журналов WAL — диск будет заполняться. Верните реплику или удалите слот (SELECT pg_drop_replication_slot('${name}');), если реплика больше не нужна.`);
        } else if (active !== 't') {
          if (status === 'ok') status = 'warn';
          findings.push(`Слот «${name}» не активен и удерживает ${gb(r)} журналов WAL — объём будет расти, пока реплика не подключится или слот не удалят.`);
        }
      }
      for (const [addr, state, l] of reps) {
        if (state !== 'streaming') {
          if (status === 'ok') status = 'warn';
          findings.push(`Реплика ${addr}: состояние ${state}.`);
        } else if (num(l) > 300) findings.push(`Реплика ${addr} отстаёт на ${dur(num(l))}.`);
      }
      if (standby && lag > 300) {
        if (status === 'ok') status = 'warn';
        findings.push(`Этот сервер — реплика, отставание ${dur(lag)} (если на основном сервере нет записей, это нормально).`);
      }
      const summary = standby ? `Реплика (только чтение), отставание ${lag >= 0 ? dur(lag) : 'неизвестно'}` : reps.length ? `Основной сервер, реплик: ${reps.length}` : 'Основной сервер, реплик нет';
      return { status, summary: `${summary}; слотов: ${slots.length}`, metrics: standby && lag >= 0 ? { lag_sec: lag } : undefined, findings };
    }
  },
  {
    id: 'db-pg-maint',
    title: 'PostgreSQL: очистка (VACUUM) и переполнение счётчика транзакций',
    commands: [
      PGQ('SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY 2 DESC LIMIT 5;'),
      `command -v psql >/dev/null 2>&1 || { echo NO_CLIENT; exit 0; }; ${PSQL_AS}; for d in $($P -X -At -d postgres -c "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate"); do $P -X -At -F'|' -d "$d" -c "SELECT current_database(), relname, n_dead_tup, n_live_tup, coalesce(extract(epoch from now() - greatest(last_autovacuum, last_vacuum))::int, -1) FROM pg_stat_user_tables WHERE n_dead_tup > 50000 AND n_dead_tup > n_live_tup * 0.2 ORDER BY n_dead_tup DESC LIMIT 5"; done 2>&1 | head -n 25`,
      PGQ("SELECT setting FROM pg_settings WHERE name = 'autovacuum';")
    ],
    criteria: 'Возраст самой старой транзакции базы (age) больше 500 млн — внимание, больше 1,5 млрд — проблема: при 2 млрд PostgreSQL перестанет принимать запись, пока не выполнят VACUUM. Таблицы, где «мёртвых» строк больше 20 % от живых и больше 50 тыс., — внимание (раздувание).',
    analyze(out) {
      const ap = accessProblem(out[0]?.output ?? '', 'pg');
      if (ap) return ap;
      const ages = lines(out[0]?.output ?? '').map((l) => l.split('|'));
      const dead = lines(out[1]?.output ?? '').map((l) => l.split('|')).filter((r) => r.length >= 5);
      const auto = (lines(out[2]?.output ?? '')[0] ?? '').trim();
      const maxAge = Math.max(0, ...ages.map((r) => num(r[1])).filter((n) => !Number.isNaN(n)));
      const findings: string[] = [];
      let status: CheckAnalysis['status'] = 'ok';
      if (maxAge > 1.5e9) {
        status = 'crit';
        findings.push(`База ${ages[0][0]}: возраст транзакций ${Math.round(maxAge / 1e6)} млн — близко к остановке записи. Срочно: VACUUM (FREEZE) в этой базе, найдите долгие транзакции и неактивные слоты.`);
      } else if (maxAge > 5e8) {
        status = 'warn';
        findings.push(`База ${ages[0][0]}: возраст транзакций ${Math.round(maxAge / 1e6)} млн — autovacuum не успевает замораживать строки.`);
      }
      if (auto === 'off') {
        status = 'crit';
        findings.push('autovacuum выключен — таблицы будут раздуваться, а счётчик транзакций — приближаться к переполнению. Включите autovacuum = on.');
      }
      if (dead.length) {
        if (status === 'ok') status = 'warn';
        findings.push(...dead.slice(0, 6).map((r) => `${r[0]}.${r[1]}: мёртвых строк ${num(r[2]).toLocaleString('ru-RU')} при ${num(r[3]).toLocaleString('ru-RU')} живых, очистка ${num(r[4]) < 0 ? 'не выполнялась' : `${dur(num(r[4]))} назад`}. VACUUM (ANALYZE) ${r[1]};`));
      }
      return { status, summary: `Наибольший возраст транзакций: ${Math.round(maxAge / 1e6)} млн; autovacuum: ${auto || '?'}; таблиц с раздуванием: ${dead.length}`, metrics: { xid_age_m: Math.round(maxAge / 1e6), bloated_tables: dead.length }, findings };
    }
  }
];

export const DB_TASKS = [
  { id: 'db-mysql', title: 'MySQL / MariaDB: полная проверка', checks: ['db-mysql-service', 'db-mysql-conn', 'db-mysql-locks', 'db-mysql-disk', 'db-mysql-replication', 'db-mysql-errors', 'db-mysql-config'] },
  { id: 'db-pg', title: 'PostgreSQL: полная проверка', checks: ['db-pg-service', 'db-pg-conn', 'db-pg-locks', 'db-pg-disk', 'db-pg-replication', 'db-pg-maint'] },
  { id: 'db-slow', title: 'База данных тормозит', checks: ['db-mysql-conn', 'db-mysql-locks', 'db-mysql-config', 'db-pg-conn', 'db-pg-locks', 'db-pg-maint', 'cpu', 'memory', 'disks'] },
  { id: 'db-cannot-connect', title: 'К базе не подключиться / Too many connections', checks: ['db-mysql-service', 'db-mysql-conn', 'db-mysql-errors', 'db-pg-service', 'db-pg-conn', 'ports'] },
  { id: 'db-space', title: 'База занимает много места / кончается диск', checks: ['db-mysql-disk', 'db-pg-disk', 'db-pg-replication', 'db-pg-maint', 'disks', 'inodes'] },
  { id: 'db-replication', title: 'Репликация баз данных', checks: ['db-mysql-replication', 'db-pg-replication'] },
  { id: 'db-crash', title: 'База упала или перезапускалась', checks: ['db-mysql-service', 'db-mysql-errors', 'db-pg-service', 'oom', 'disks', 'kernel'] }
];

/** Для подсказок в интерфейсе: какие проверки относятся к базам данных. */
export function isDbCheck(id: string): boolean {
  return id.startsWith('db-');
}

export type { CmdOutput };
