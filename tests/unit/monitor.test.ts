import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { freshDb } from './helpers';
import { Vault } from '../../src/main/vault';
import { MonitorEngine, communityKey, MAIL_PASSWORD_KEY, type MonitorEmit } from '../../src/main/monitor/engine';
import { SnmpClient, type SnmpTarget } from '../../src/main/monitor/snmpClient';
import { buildMessage, sendMail } from '../../src/main/monitor/mailer';
import { OID, TRAP, str, type VarBind } from '../../src/shared/snmp';
import { applyCheck, composeAlertMail, initialState, parseBulkNodes, parsePing, pingArgs, withMonitorDefaults, type MonitorNodeInput } from '../../src/shared/monitor';

const node = (p: Partial<MonitorNodeInput>): MonitorNodeInput => ({ name: 'n', host: '10.10.0.1', kind: 'switch', vendor: '', method: 'ping', snmpVersion: 2, snmpPort: 161, tcpPort: 0, intervalSec: 0, enabled: true, deviceId: null, notes: '', ...p });

test('мониторинг: смена состояний — порог неудач, восстановление, перезагрузка, предупреждение', () => {
  const t0 = '2026-11-23T10:00:00.000Z';
  let s = initialState(1, true, t0);
  let r = applyCheck(s, { reachable: false, latencyMs: null, message: 'нет ответа на ping' }, 2, t0);
  assert.equal(r.state.status, 'unknown');
  assert.equal(r.changes.length, 0, 'одна неудача — ещё не тревога');
  r = applyCheck(r.state, { reachable: false, latencyMs: null, message: 'нет ответа на ping' }, 2, '2026-11-23T10:00:05.000Z');
  assert.equal(r.state.status, 'down');
  assert.deepEqual(r.changes.map((c) => c.type), ['down']);
  const again = applyCheck(r.state, { reachable: false, latencyMs: null, message: 'x' }, 2, '2026-11-23T10:01:00.000Z');
  assert.equal(again.changes.length, 0, 'повторного события «не в сети» нет');
  r = applyCheck(again.state, { reachable: true, latencyMs: 3, message: 'ok', uptimeTicks: 100000 }, 2, '2026-11-23T10:12:05.000Z');
  assert.equal(r.state.status, 'up');
  assert.match(r.changes[0].message, /снова в сети \(не было 12 мин\)/);
  r = applyCheck(r.state, { reachable: true, latencyMs: 3, message: 'ok', uptimeTicks: 3000 }, 2, '2026-11-23T10:13:00.000Z');
  assert.equal(r.changes[0].type, 'reboot');
  r = applyCheck(r.state, { reachable: true, latencyMs: 3, message: 'ok', warn: 'SNMP не отвечает' }, 2, '2026-11-23T10:14:00.000Z');
  assert.equal(r.state.status, 'warn');
  r = applyCheck(r.state, { reachable: true, latencyMs: 3, message: 'ok' }, 2, '2026-11-23T10:15:00.000Z');
  assert.equal(r.state.status, 'up');
  assert.equal(r.changes[0].type, 'ok');
  s = withMonitorDefaults({ trap: { port: 1162 } } as never).trap.enabled ? s : s;
  assert.equal(withMonitorDefaults({ trap: { port: 1162 } } as never).trap.linkDownWarn, true);
});

test('мониторинг: разбор ping Windows (русская и английская), Linux, аргументы', () => {
  assert.deepEqual(parsePing('Ответ от 10.10.0.1: число байт=32 время<1мс TTL=64', 0, 'win32'), { ok: true, ms: 1, text: 'отвечает на ping' });
  assert.equal(parsePing('Reply from 10.10.0.1: bytes=32 time=12ms TTL=63', 0, 'win32').ms, 12);
  // В Windows «узел недоступен» приходит с кодом 0 — это не ответ узла.
  assert.equal(parsePing('Ответ от 10.10.0.254: Заданный узел недоступен.', 0, 'win32').ok, false);
  assert.match(parsePing('Превышен интервал ожидания для запроса.', 1, 'win32').text, /нет ответа/);
  assert.deepEqual(parsePing('64 bytes from 10.10.0.1: icmp_seq=1 ttl=64 time=0.412 ms', 0, 'linux'), { ok: true, ms: 0, text: 'отвечает на ping' });
  assert.equal(parsePing('ping: srv-x: Name or service not known', 2, 'linux').text, 'имя не найдено в DNS');
  assert.deepEqual(pingArgs('10.10.0.1', 1500, 'win32'), ['-n', '1', '-w', '1500', '10.10.0.1']);
  assert.deepEqual(pingArgs('10.10.0.1', 1500, 'linux'), ['-c', '1', '-n', '-W', '2', '10.10.0.1']);
});

test('мониторинг: массовое добавление — строки, диапазон, тип по словам, ошибки', () => {
  const r = parseBulkNodes('SW-ACCESS-1; 10.10.1.11; коммутатор\n10.10.5.20\nВидеосервер 1\t10.10.6.10\nКамеры; 10.10.7.1-3\nплохо; 999.1.1.1\n# комментарий', { kind: 'other' });
  assert.deepEqual(
    r.nodes.map((n) => [n.name, n.host, n.kind]),
    [
      ['SW-ACCESS-1', '10.10.1.11', 'switch'],
      ['10.10.5.20', '10.10.5.20', 'other'],
      ['Видеосервер 1', '10.10.6.10', 'vms'],
      ['Камеры 1', '10.10.7.1', 'camera'],
      ['Камеры 2', '10.10.7.2', 'camera'],
      ['Камеры 3', '10.10.7.3', 'camera']
    ]
  );
  assert.equal(r.errors.length, 1);
});

test('мониторинг: текст письма', () => {
  const m = composeAlertMail([{ ts: '2026-11-23T10:00:00Z', nodeName: 'SW-ACCESS-1', host: '10.10.1.11', type: 'down', message: 'не в сети: нет ответа на ping' }], { up: 10, warn: 1, down: 1, unknown: 0, paused: 0 }, 'PC-MON');
  assert.equal(m.subject, '[NetAdmin Desk] Не в сети: SW-ACCESS-1');
  assert.match(m.text, /в сети 10, с проблемами 1, не в сети 1/);
  const raw = buildMessage({ from: 'Мониторинг <mon@example.com>', to: ['admin@example.com'] }, 'Не в сети: SW', 'Привет\nмир');
  assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(raw, /Content-Transfer-Encoding: base64/);
  const body = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Привет\r\nмир');
});

/** Почтовый сервер для теста: принимает EHLO, AUTH PLAIN, MAIL, RCPT, DATA. */
function fakeSmtp(opts: { requireAuth?: string; rejectRcpt?: boolean } = {}): Promise<{ port: number; mails: { from: string; to: string[]; data: string; auth?: string }[]; close: () => void }> {
  const mails: { from: string; to: string[]; data: string; auth?: string }[] = [];
  return new Promise((resolve) => {
    const srv = net.createServer((s) => {
      let buf = '';
      let data = false;
      let cur = { from: '', to: [] as string[], data: '', auth: undefined as string | undefined };
      s.write('220 test ESMTP\r\n');
      s.on('data', (d) => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (data) {
            if (line === '.') {
              data = false;
              mails.push(cur);
              cur = { from: '', to: [], data: '', auth: cur.auth };
              s.write('250 OK queued\r\n');
            } else cur.data += `${line}\r\n`;
            continue;
          }
          if (/^EHLO /i.test(line)) s.write('250-test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
          else if (/^AUTH PLAIN /i.test(line)) {
            const [, u, p] = Buffer.from(line.slice(11), 'base64').toString().split('\0');
            if (opts.requireAuth && `${u}:${p}` !== opts.requireAuth) s.write('535 5.7.8 Authentication credentials invalid\r\n');
            else {
              cur.auth = u;
              s.write('235 OK\r\n');
            }
          } else if (/^MAIL FROM:/i.test(line)) {
            if (opts.requireAuth && !cur.auth) s.write('530 Authentication required\r\n');
            else {
              cur.from = line.slice(10);
              s.write('250 OK\r\n');
            }
          } else if (/^RCPT TO:/i.test(line)) {
            if (opts.rejectRcpt) s.write('550 No such user\r\n');
            else {
              cur.to.push(line.slice(8));
              s.write('250 OK\r\n');
            }
          } else if (line === 'DATA') {
            data = true;
            s.write('354 go\r\n');
          } else if (line === 'QUIT') {
            s.write('221 bye\r\n');
            s.end();
          } else s.write('502 unknown\r\n');
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as net.AddressInfo).port, mails, close: () => srv.close() }));
  });
}

test('почта: отправка с авторизацией, ошибки сервера понятным текстом', async () => {
  const s = await fakeSmtp({ requireAuth: 'mon:Secr3t' });
  try {
    const base = { host: '127.0.0.1', port: s.port, security: 'none' as const, user: 'mon', password: 'Secr3t', from: 'mon@example.com', to: ['a@example.com', 'b@example.com'], timeoutMs: 3000 };
    await sendMail(base, 'Тест', 'Строка 1\n.точка в начале');
    assert.equal(s.mails.length, 1);
    assert.deepEqual(s.mails[0].to, ['<a@example.com>', '<b@example.com>']);
    assert.match(s.mails[0].data, /Subject: =\?UTF-8\?B\?/);
    await assert.rejects(sendMail({ ...base, password: 'wrong' }, 'x', 'y'), /AUTH: 535/);
    await assert.rejects(sendMail({ ...base, security: 'starttls' }, 'x', 'y'), /не поддерживает STARTTLS/);
    await assert.rejects(sendMail({ ...base, to: ['не-адрес'] }, 'x', 'y'), /неверный адрес получателя/);
    await assert.rejects(sendMail({ ...base, port: 1 }, 'x', 'y'), /не принимает соединения|ECONNREFUSED|EACCES/);
  } finally {
    s.close();
  }
});

function fakeOs() {
  return { isAvailable: () => true, backend: () => 'dpapi', encrypt: (v: string) => Buffer.from(`enc:${v}`), decrypt: (b: Buffer) => b.toString().slice(4) };
}

class StubSnmp extends SnmpClient {
  table: Record<string, Record<string, VarBind['value']>> = {};
  calls: string[] = [];
  override async get(t: SnmpTarget, oids: string[]): Promise<VarBind[]> {
    this.calls.push(`${t.host}:${t.community}`);
    const tab = this.table[`${t.host}:${t.community}`];
    if (!tab) {
      const { SnmpError } = await import('../../src/main/monitor/snmpClient');
      throw new SnmpError('нет ответа', 'timeout');
    }
    return oids.map((oid) => ({ oid, value: tab[oid] ?? { type: 'noSuchObject' } }));
  }
}

test('движок мониторинга: опрос, «не в сети» после двух неудач, SNMP с откатом на ping, трап linkDown, письмо одной пачкой', async () => {
  const db = await freshDb();
  db.setSettings({ vaultMode: 'os' });
  const vault = new Vault(db, fakeOs());
  const alive = new Set(['10.10.1.11', '10.10.1.12', '10.10.6.10', '10.10.6.11']);
  let clock = Date.parse('2026-11-23T10:00:00Z');
  const snmp = new StubSnmp();
  snmp.table['10.10.1.11:public'] = { [OID.sysUpTime]: { type: 'ticks', value: 900000 }, [OID.sysName]: str('SW-ACCESS-1'), [OID.sysDescr]: str('Cisco IOS'), [`${OID.ifName}.5`]: str('Gi1/0/5'), [`${OID.ifAlias}.5`]: str('Камера 12') };
  const mails: { subject: string; text: string }[] = [];
  const emitted: MonitorEmit[] = [];
  const desktop: string[] = [];
  const eng = new MonitorEngine(db, vault, (e) => emitted.push(e), {
    ping: async (h) => (alive.has(h) ? { ok: true, ms: 1, text: 'отвечает на ping' } : { ok: false, ms: null, text: 'нет ответа на ping' }),
    tcp: async (h, p) => ({ ok: alive.has(h) && p === 554, ms: 2, text: `TCP-порт ${p}` }),
    snmp,
    mail: async (_cfg, subject, text) => void mails.push({ subject, text }),
    desktopNotify: (t) => desktop.push(t),
    now: () => clock,
    tickMs: 3600000
  });
  db.setSettings({ monitor: withMonitorDefaults({ email: { enabled: true, host: 'mail', port: 25, security: 'none', user: '', from: 'm@example.com', to: 'a@example.com', delaySec: 5, includeTraps: false, allowInvalidCert: false }, failThreshold: 2 } as never) });
  const sw = db.saveMonitorNode(node({ name: 'SW-ACCESS-1', host: '10.10.1.11', method: 'snmp' }));
  vault.storeApp(communityKey(sw.id), 'public');
  const sw2 = db.saveMonitorNode(node({ name: 'SW-ACCESS-2', host: '10.10.1.12', method: 'snmp' }));
  vault.storeApp(communityKey(sw2.id), 'wrong-community');
  const vms = db.saveMonitorNode(node({ name: 'Видеосервер 1', host: '10.10.6.10', kind: 'vms', method: 'tcp', tcpPort: 554 }));
  const vms2 = db.saveMonitorNode(node({ name: 'Видеосервер 2', host: '10.10.6.11', kind: 'vms', method: 'tcp', tcpPort: 8080 }));
  const cam = db.saveMonitorNode(node({ name: 'Камера 3', host: '10.10.7.3', kind: 'camera' }));
  assert.equal(db.getMonitorNode(sw.id)!.hasCommunity, true);
  assert.ok(!JSON.stringify(db.listMonitorNodes()).includes('public'), 'community не попадает в список узлов');

  await eng.start();
  for (const n of [sw, sw2, vms, vms2, cam]) await eng.checkNow(n.id);
  const st = () => new Map(eng.listStates().map((s) => [s.nodeId, s]));
  assert.equal(st().get(sw.id)!.status, 'up');
  assert.equal(st().get(sw.id)!.sysName, 'SW-ACCESS-1');
  assert.equal(st().get(sw2.id)!.status, 'warn');
  assert.match(st().get(sw2.id)!.message, /SNMP не отвечает/);
  assert.equal(st().get(vms.id)!.status, 'up');
  // порт закрыт, но ping есть — узел в сети, служба недоступна («жёлтый», а не «не в сети»)
  assert.equal(st().get(vms2.id)!.status, 'warn');
  assert.match(st().get(vms2.id)!.message, /TCP-порт 8080.*служба недоступна/);
  assert.equal(st().get(cam.id)!.status, 'unknown', 'после одной неудачи — ещё «проверяется»');
  clock += 5000;
  await eng.checkNow(cam.id);
  assert.equal(st().get(cam.id)!.status, 'down');
  const ev = db.listMonitorEvents();
  assert.ok(ev.some((e) => e.type === 'down' && e.nodeName === 'Камера 3'));

  // трап linkDown от коммутатора: порт уточняется по SNMP, узел становится «жёлтым»
  await (eng as unknown as { onTrap(e: unknown): Promise<void> }).onTrap({ source: '10.10.1.11', sourcePort: 50000, receivedAt: clock, trap: { version: 2, community: 'public', trapOid: TRAP.linkDown, name: 'Порт отключился (linkDown)', ifIndex: 5, varbinds: [], inform: false } });
  assert.equal(st().get(sw.id)!.status, 'warn');
  assert.equal(st().get(sw.id)!.portsDown[0].label, 'Gi1/0/5 (Камера 12)');
  assert.ok(db.listMonitorEvents().some((e) => /linkDown.*Gi1\/0\/5 \(Камера 12\)/.test(e.message)));
  await (eng as unknown as { onTrap(e: unknown): Promise<void> }).onTrap({ source: '10.10.1.11', sourcePort: 50000, receivedAt: clock, trap: { version: 2, community: 'public', trapOid: TRAP.linkUp, name: 'Порт включился (linkUp)', ifIndex: 5, varbinds: [], inform: false } });
  assert.equal(st().get(sw.id)!.status, 'up');

  // камера вернулась
  alive.add('10.10.7.3');
  clock += 120000;
  await eng.checkNow(cam.id);
  assert.equal(st().get(cam.id)!.status, 'up');
  await eng.flushMail();
  assert.equal(mails.length, 1, 'события собраны в одно письмо');
  assert.match(mails[0].text, /Камера 3.*не в сети/);
  assert.match(mails[0].text, /Камера 3.*снова в сети/);
  await new Promise((r) => setTimeout(r, 1700));
  assert.ok(desktop.some((t) => /Не в сети: Камера 3/.test(t)));
  assert.ok(emitted.some((e) => e.type === 'monitor:states'));

  // письмо с паролем: пароль берётся из хранилища
  db.setSettings({ monitor: { ...db.getSettings().monitor, email: { ...db.getSettings().monitor.email, user: 'mon' } } });
  vault.storeApp(MAIL_PASSWORD_KEY, 'Secr3t');
  let seen: unknown;
  (eng as unknown as { deps: { mail: unknown } }).deps.mail = async (cfg: unknown) => void (seen = cfg);
  await eng.testMail();
  assert.equal((seen as { password: string }).password, 'Secr3t');

  // удаление узла удаляет и его community
  db.deleteMonitorNode(sw2.id);
  eng.reloadNodes();
  assert.equal(vault.hasApp(communityKey(sw2.id)), false);
  assert.equal(eng.status().counts.up + eng.status().counts.warn + eng.status().counts.down, 4);
  eng.stop();
});

test('карты мониторинга: сохранение расположения и связей, удаление узла убирает его с карты', async () => {
  const db = await freshDb();
  const a = db.saveMonitorNode(node({ name: 'core', host: '10.10.0.1' }));
  const b = db.saveMonitorNode(node({ name: 'acc', host: '10.10.1.11' }));
  const m = db.saveMonitorMap({ name: 'Этаж 1', background: '', width: 1600, height: 1000, items: [{ nodeId: a.id, x: 100.4, y: 50 }, { nodeId: b.id, x: 300, y: 200 }, { nodeId: 999, x: 1, y: 1 }], links: [{ a: a.id, b: b.id, label: 'trunk' }, { a: b.id, b: a.id, label: 'дубль' }, { a: a.id, b: a.id, label: 'петля' }] });
  assert.deepEqual(m.items, [{ nodeId: a.id, x: 100, y: 50 }, { nodeId: b.id, x: 300, y: 200 }]);
  assert.equal(m.links.length, 1);
  db.deleteMonitorNode(b.id);
  const after = db.listMonitorMaps()[0];
  assert.equal(after.items.length, 1);
  assert.equal(after.links.length, 0);
  db.deleteMonitorMap(m.id);
  assert.equal(db.listMonitorMaps().length, 0);
});

test('хранилище: секреты приложения перешифровываются при переходе на мастер-пароль и удаляются в режиме «запрашивать»', async () => {
  const db = await freshDb();
  db.setSettings({ vaultMode: 'os' });
  const v = new Vault(db, fakeOs());
  v.storeApp('monitor:smtp-password', 'Secr3t');
  v.setupMaster('master-pass-1');
  assert.equal(db.getAppSecret('monitor:smtp-password')!.scheme, 'master');
  assert.equal(v.readApp('monitor:smtp-password'), 'Secr3t');
  v.lock();
  assert.throws(() => v.readApp('monitor:smtp-password'), /заблокирован|locked/i);
  v.unlock('master-pass-1');
  v.switchMode('prompt');
  assert.equal(v.hasApp('monitor:smtp-password'), false);
});

test('ping: настоящая системная утилита отвечает для 127.0.0.1 (если ping установлен)', async (t) => {
  const { systemPing } = await import('../../src/main/monitor/engine');
  const r = await systemPing('127.0.0.1', 1500);
  if (r.text === 'утилита ping не найдена') return t.skip('ping не установлен');
  assert.equal(r.ok, true, r.text);
  assert.equal(typeof r.ms, 'number');
  assert.equal((await systemPing('bad host;rm', 500)).text, 'неверный адрес');
});

test('почта: STARTTLS с самоподписанным сертификатом (проверка сертификата и её отключение)', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tls = await import('node:tls');
  const dir = mkdtempSync(join(tmpdir(), 'nad-smtp-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  } catch {
    return t.skip('openssl не найден');
  }
  const ctx = tls.createSecureContext({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) });
  let got = '';
  const srv = net.createServer((raw) => {
    let s: net.Socket = raw;
    let buf = '';
    let data = false;
    const onLine = (line: string) => {
      if (data) {
        if (line === '.') {
          data = false;
          s.write('250 OK\r\n');
        } else got += `${line}\n`;
        return;
      }
      if (/^EHLO/.test(line)) s.write(s instanceof tls.TLSSocket ? '250-test\r\n250 AUTH PLAIN\r\n' : '250-test\r\n250 STARTTLS\r\n');
      else if (line === 'STARTTLS') {
        s.write('220 go ahead\r\n');
        raw.removeAllListeners('data');
        const sec = new tls.TLSSocket(raw, { isServer: true, secureContext: ctx });
        s = sec;
        buf = '';
        sec.on('data', feed);
        sec.on('error', () => undefined);
      } else if (/^AUTH PLAIN/.test(line)) s.write('235 OK\r\n');
      else if (/^(MAIL|RCPT)/.test(line)) s.write('250 OK\r\n');
      else if (line === 'DATA') {
        data = true;
        s.write('354 go\r\n');
      } else if (line === 'QUIT') s.end('221 bye\r\n');
    };
    const feed = (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 2);
        onLine(l);
      }
    };
    raw.on('data', feed);
    raw.on('error', () => undefined);
    raw.write('220 test\r\n');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as net.AddressInfo).port;
  const cfg = { host: '127.0.0.1', port, security: 'starttls' as const, user: 'mon', password: 'p', from: 'm@example.com', to: ['a@example.com'], timeoutMs: 5000 };
  try {
    await assert.rejects(sendMail(cfg, 'x', 'y'), /TLS|сертификат/);
    await sendMail({ ...cfg, allowInvalidCert: true }, 'Тест TLS', 'текст через TLS');
    assert.match(got, /Content-Transfer-Encoding: base64/);
  } finally {
    srv.close();
  }
});
