import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB_CHECKS, accessProblem } from '../../src/shared/dbDiag';
import { LINUX_CHECKS, LINUX_TASKS, linuxTaskGroup } from '../../src/shared/linuxDiag';
import { classifyCommand } from '../../src/shared/risk';

const check = (id: string) => DB_CHECKS.find((c) => c.id === id)!;
const o = (...outputs: string[]) => outputs.map((output) => ({ command: '', output }));

test('проверки БД подключены к общему списку и задачам', () => {
  for (const c of DB_CHECKS) assert.ok(LINUX_CHECKS.some((x) => x.id === c.id), c.id);
  const ids = new Set(LINUX_CHECKS.map((c) => c.id));
  for (const t of LINUX_TASKS) for (const c of t.checks) assert.ok(ids.has(c), `${t.id}: ${c}`);
  assert.ok(LINUX_TASKS.some((t) => t.id === 'db-mysql') && LINUX_TASKS.some((t) => t.id === 'db-pg'));
  assert.equal(linuxTaskGroup(LINUX_TASKS.find((t) => t.id === 'db-slow')!), 'db');
  assert.equal(linuxTaskGroup(LINUX_TASKS.find((t) => t.id === 'cpu')!), 'single');
});

test('команды диагностики БД: без sudo и ничего не меняют', () => {
  for (const c of DB_CHECKS)
    for (const cmd of c.commands) {
      assert.doesNotMatch(cmd, /\bsudo\b/, `${c.id}: ${cmd}`);
      assert.doesNotMatch(cmd, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|KILL|PURGE|VACUUM|pg_terminate_backend|pg_cancel_backend)\b/i, `${c.id}: ${cmd}`);
      assert.notEqual(classifyCommand(cmd, 'linux').level, 'critical', `${c.id}: ${cmd}`);
    }
});

test('нет клиента, нет доступа, сервер не отвечает — понятные статусы', () => {
  assert.equal(accessProblem('NO_CLIENT', 'mysql')?.status, 'info');
  assert.match(accessProblem("ERROR 1045 (28000): Access denied for user 'u'@'localhost'", 'mysql')!.summary, /Нет доступа/);
  assert.equal(accessProblem("ERROR 2002 (HY000): Can't connect to local server through socket", 'mysql')?.status, 'crit');
  assert.match(accessProblem('psql: error: FATAL:  Peer authentication failed for user "u"', 'pg')!.summary, /Нет доступа/);
  assert.equal(accessProblem('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory', 'pg')?.status, 'crit');
  assert.equal(accessProblem('42', 'pg'), null);
  assert.equal(check('db-mysql-conn').analyze(o('NO_CLIENT')).status, 'info');
});

test('MySQL: подключения на пределе и недавний перезапуск', () => {
  const out = ['Aborted_connects\t3', 'Max_used_connections\t151', 'Questions\t1000', 'Slow_queries\t12', 'Threads_connected\t140', 'Threads_running\t4', 'Uptime\t600', 'bind_address\t127.0.0.1', 'max_connections\t151', 'port\t3306', 'version\t10.11.6-MariaDB-0+deb12u1', 'version_comment\tDebian 12'].join('\n');
  const a = check('db-mysql-conn').analyze(o(out));
  assert.equal(a.status, 'crit');
  assert.match(a.summary, /MariaDB 10\.11/);
  assert.ok(a.findings.some((f) => /на пределе/.test(f)));
  assert.ok(a.findings.some((f) => /работает всего 10 мин/.test(f)));
  const ok = check('db-mysql-conn').analyze(o(out.replace('Threads_connected\t140', 'Threads_connected\t10').replace('Max_used_connections\t151', 'Max_used_connections\t40').replace('Uptime\t600', 'Uptime\t900000')));
  assert.equal(ok.status, 'ok');
});

test('MySQL: долгие запросы, реплика остановлена, ошибки в журнале', () => {
  const locks = check('db-mysql-locks').analyze(o('17\tapp\tshop\t900\tSending data\tSELECT * FROM orders', '', '0'));
  assert.equal(locks.status, 'crit');
  assert.match(locks.findings[0], /15 мин/);
  const rep = check('db-mysql-replication').analyze(o('*************************** 1. row ***************************\n     Slave_IO_Running: Yes\n    Slave_SQL_Running: No\n        Last_SQL_Error: Duplicate entry \'5\' for key \'PRIMARY\'\nSeconds_Behind_Master: NULL'));
  assert.equal(rep.status, 'crit');
  assert.ok(rep.findings.some((f) => /Duplicate entry/.test(f)));
  assert.equal(check('db-mysql-replication').analyze(o('')).status, 'info');
  const log = check('db-mysql-errors').analyze(o('LOG=/var/log/mysql/error.log\n2026-11-01 [ERROR] InnoDB: Database page corruption on disk'));
  assert.equal(log.status, 'crit');
});

test('MySQL: место на диске и настройки', () => {
  const disk = check('db-mysql-disk').analyze(o('DIR=/var/lib/mysql/\n/dev/sda1 102400000 95000000 7400000 93% /', 'shop\t5368709120', 'mysql-bin.000001\t1073741824\tNo'));
  assert.equal(disk.status, 'crit');
  assert.match(disk.summary, /93 %/);
  const cfg = check('db-mysql-config').analyze(o('134217728\tlatin1\t151\t8.0.36', String(16 * 1024 ** 3), 'InnoDB\t120\nMyISAM\t4'));
  assert.equal(cfg.status, 'warn');
  assert.ok(cfg.findings.some((f) => /utf8mb4/.test(f)));
  assert.ok(cfg.findings.some((f) => /MyISAM/.test(f)));
  assert.ok(cfg.findings.some((f) => /innodb_buffer_pool_size/.test(f)));
});

test('PostgreSQL: подключения, блокировки, слоты, VACUUM', () => {
  const conn = check('db-pg-conn').analyze(o('92|100|20|3|86400|16.4', '97.5|0|0'));
  assert.equal(conn.status, 'crit');
  assert.ok(conn.findings.some((f) => /PgBouncer/.test(f)));
  assert.ok(conn.findings.some((f) => /idle in transaction/.test(f)));
  const locks = check('db-pg-locks').analyze(o('', '4321|{1234}|120', ''));
  assert.equal(locks.status, 'crit');
  assert.match(locks.findings[0], /блокирует \{1234\}.*pg_cancel_backend\(1234\)/);
  const rep = check('db-pg-replication').analyze(o('f', '', `old_replica|f|${3 * 1024 ** 3}`, ''));
  assert.equal(rep.status, 'crit');
  assert.ok(rep.findings.some((f) => /pg_drop_replication_slot/.test(f)));
  const maint = check('db-pg-maint').analyze(o('shop|1600000000\npostgres|1000', 'shop|orders|900000|1000000|-1', 'on'));
  assert.equal(maint.status, 'crit');
  assert.ok(maint.findings.some((f) => /VACUUM \(FREEZE\)/.test(f)));
  const svc = check('db-pg-service').analyze(o('16  main    5432 online postgres /var/lib/postgresql/16/main /var/log/postgresql/postgresql-16-main.log', '2026-11-10 FATAL:  sorry, too many clients already', ''));
  assert.equal(svc.status, 'warn');
  assert.equal(check('db-pg-service').analyze(o('', '', '')).status, 'info');
});

test('сервер без MySQL / MariaDB: все проверки MySQL отвечают «не установлен», а не ошибкой', () => {
  for (const c of DB_CHECKS.filter((c) => c.id.startsWith('db-mysql') && c.id !== 'db-mysql-service')) {
    const outs = c.commands.map((cmd) => ({ command: cmd, output: cmd.startsWith('command -v mysql') ? 'NO_CLIENT' : c.id === 'db-mysql-disk' ? 'DIR=/var/lib/mysql\n/dev/sda1 100 50 50 50% /' : '' }));
    const a = c.analyze(outs);
    assert.equal(a.status, 'info', c.id);
    assert.match(a.summary, /не установлен/, c.id);
  }
  assert.equal(check('db-mysql-service').analyze(o('mariadb=inactive\nmysql=inactive', '', '')).status, 'info');
});
