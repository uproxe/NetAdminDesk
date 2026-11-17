// Тесты новых модулей 0.11: калькулятор подсетей, Telnet, подсветка вывода, SSH-ключи, разбор адреса, меню.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { inSubnet, parseIPv4, parseNetInput, prefixForHosts, prefixFromMask, splitSubnet, subnetInfo } from '../../src/shared/netcalc';
import { TelnetParser, encodeTelnetInput, IAC, humanizeTelnetError } from '../../src/main/ssh/telnet';
import { highlightRanges } from '../../src/shared/termHighlight';
import { encodeOpenSshPrivate, fingerprint, newEd25519, publicLine } from '../../src/main/sshkey';
import { parseQuickAddress } from '../../src/shared/address';
import { toolCommand, validHost } from '../../src/main/tools';
import { NAV, isNavShown, hiddenNavCount } from '../../src/renderer/lib/navigation';

test('калькулятор подсетей: маска, wildcard, сеть, диапазон', () => {
  const p = parseNetInput('10.10.5.17 255.255.252.0');
  assert.ok(!('error' in p));
  if ('error' in p) return;
  assert.equal(p.prefix, 22);
  assert.equal(p.given, 'mask');
  const i = subnetInfo(p.ip, p.prefix);
  assert.equal(i.network, '10.10.4.0');
  assert.equal(i.broadcast, '10.10.7.255');
  assert.equal(i.firstHost, '10.10.4.1');
  assert.equal(i.lastHost, '10.10.7.254');
  assert.equal(i.wildcard, '0.0.3.255');
  assert.equal(i.hosts, 1022);
  assert.match(i.kind, /частный/);
  // wildcard из ACL
  const w = parseNetInput('10.10.41.0 0.0.0.255');
  assert.ok(!('error' in w) && w.prefix === 24 && w.given === 'wildcard');
  // /31 и /32
  assert.equal(subnetInfo(parseIPv4('10.0.0.0')!, 31).hosts, 2);
  assert.equal(subnetInfo(parseIPv4('10.0.0.5')!, 32).firstHost, '10.0.0.5');
  // ошибки
  assert.ok('error' in parseNetInput('10.0.0.300/24'));
  assert.ok('error' in parseNetInput('10.0.0.1 255.0.255.0'));
  assert.equal(prefixFromMask(parseIPv4('255.255.255.128')!), 25);
  assert.equal(prefixFromMask(parseIPv4('255.0.255.0')!), null);
  assert.equal(splitSubnet(parseIPv4('192.168.0.0')!, 24, 26).length, 4);
  assert.equal(splitSubnet(parseIPv4('192.168.0.0')!, 24, 26)[3].network, '192.168.0.192/26');
  assert.equal(prefixForHosts(50), 26);
  assert.ok(inSubnet(parseIPv4('192.168.1.200')!, parseIPv4('192.168.1.0')!, 24));
  assert.ok(!inSubnet(parseIPv4('192.168.2.1')!, parseIPv4('192.168.1.0')!, 24));
  assert.match(subnetInfo(parseIPv4('100.64.1.1')!, 10).kind, /CGNAT/);
});

test('Telnet: согласование опций, NAWS, TTYPE, данные без IAC', () => {
  const sent: number[][] = [];
  const p = new TelnetParser((b) => sent.push(b), { termType: 'VT100', size: () => ({ cols: 132, rows: 40 }) });
  // Сервер: DO NAWS, WILL ECHO, DO 99 (неизвестная), текст «login:», команда разрезана между кусками
  const a = p.feed(Buffer.from([IAC, 253, 31, IAC, 251, 1, IAC, 253]));
  const b = p.feed(Buffer.from([99, ...Buffer.from('login: '), IAC, IAC]));
  assert.equal(a.length, 0);
  assert.equal(b.toString('latin1'), 'login: \xff');
  const flat = sent.map((x) => x.join(','));
  assert.ok(flat.includes([IAC, 251, 31].join(',')), 'WILL NAWS');
  assert.ok(flat.includes([IAC, 250, 31, 0, 132, 0, 40, IAC, 240].join(',')), 'размер окна');
  assert.ok(flat.includes([IAC, 253, 1].join(',')), 'DO ECHO');
  assert.ok(flat.includes([IAC, 252, 99].join(',')), 'WONT для неизвестной опции');
  // Повторный DO NAWS не порождает ответов (нет зацикливания)
  const before = sent.length;
  p.feed(Buffer.from([IAC, 253, 31]));
  assert.equal(sent.length, before);
  // TTYPE SEND
  p.feed(Buffer.from([IAC, 253, 24, IAC, 250, 24, 1, IAC, 240]));
  assert.ok(sent.some((x) => x.join(',') === [IAC, 250, 24, 0, ...Buffer.from('VT100'), IAC, 240].join(',')));
  // Ввод: Enter → CR LF, 0xFF удваивается
  assert.deepEqual([...encodeTelnetInput('ab\r')], [97, 98, 13, 10]);
  assert.deepEqual([...encodeTelnetInput('x\r\n')], [120, 13, 10]);
  assert.match(humanizeTelnetError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), { host: 'h', port: 23 }).message, /закрыт/);
});

test('подсветка: состояния портов, ненулевые ошибки, адреса', () => {
  const kinds = (s: string) => highlightRanges(s).map((r) => `${s.slice(r.start, r.start + r.len)}:${r.kind}`);
  assert.deepEqual(kinds('gi1/0/6  1G-Copper  --  Down'), ['gi1/0/6:iface', 'Down:bad']);
  assert.ok(kinds('Gi1/0/1 is up, line protocol is up').includes('up:good'));
  assert.ok(kinds('Fa0/3 is administratively down').includes('administratively down:warn'));
  assert.ok(kinds('     12 input errors, 3 CRC, 0 frame').includes('12 input errors:bad'));
  assert.ok(!kinds('     0 input errors, 0 CRC').some((x) => x.endsWith(':bad')), 'нулевые счётчики не красные');
  assert.ok(kinds('Gi0/2  err-disabled').includes('err-disabled:bad'));
  assert.ok(kinds('● nginx.service - active (running)').includes('active:good'));
  assert.ok(kinds('demo.service loaded failed failed').includes('failed:bad'));
  assert.ok(kinds('ens18  inactive').includes('inactive:warn'), '«inactive» — не «active»');
  assert.ok(kinds('10   00:11:22:33:44:55  gi1/0/5').includes('00:11:22:33:44:55:addr'));
  assert.ok(kinds('ip 192.168.1.10/24').includes('192.168.1.10/24:addr'));
  assert.ok(kinds('% Invalid input detected at marker').some((x) => x.endsWith(':bad')));
  assert.deepEqual(kinds('backup shutdown uptime'), [], 'слова-части не подсвечиваются');
});

test('SSH-ключ ed25519: формат OpenSSH и согласованность открытого и закрытого ключа', () => {
  const k = newEd25519();
  const pem = encodeOpenSshPrivate(k, 'test@nad', 0x01020304);
  assert.match(pem, /^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
  const body = Buffer.from(pem.split('\n').slice(1, -2).join(''), 'base64');
  assert.equal(body.subarray(0, 15).toString('binary'), 'openssh-key-v1\0');
  assert.ok(body.includes(Buffer.from('test@nad')));
  assert.ok(body.includes(k.pub));
  // Закрытая часть действительно соответствует открытой: подпись проверяется открытым ключом
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), k.seed]);
  const priv = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pubDer = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), k.pub]);
  const pub = createPublicKey({ key: pubDer, format: 'der', type: 'spki' });
  const sig = sign(null, Buffer.from('x'), priv);
  assert.ok(verify(null, Buffer.from('x'), pub, sig));
  assert.match(publicLine(k.pub, 'c'), /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI\S+ c$/);
  assert.match(fingerprint(k.pub), /^SHA256:[A-Za-z0-9+/]{43}$/);
});

test('быстрое подключение: разбор адреса', () => {
  assert.deepEqual(parseQuickAddress('admin@10.0.0.1'), { protocol: 'ssh', host: '10.0.0.1', port: 22, username: 'admin' });
  assert.deepEqual(parseQuickAddress('telnet://10.0.0.2'), { protocol: 'telnet', host: '10.0.0.2', port: 23, username: '' });
  assert.deepEqual(parseQuickAddress('root@srv.local:2222'), { protocol: 'ssh', host: 'srv.local', port: 2222, username: 'root' });
  assert.deepEqual(parseQuickAddress('com3'), { protocol: 'serial', host: 'COM3', port: 0, username: '' });
  assert.equal(parseQuickAddress('/dev/ttyUSB0')?.protocol, 'serial');
  assert.equal(parseQuickAddress('core-sw1'), null, 'слово без точки — поиск по названию');
  assert.equal(parseQuickAddress('10.0.0.1:70000'), null);
});

test('локальные утилиты: проверка адреса и команды для ОС', () => {
  assert.ok(validHost('10.0.0.1') && validHost('srv.local') && validHost('fe80::1'));
  assert.ok(!validHost('10.0.0.1; rm -rf /') && !validHost('-c 100 host') && !validHost(''));
  assert.deepEqual(toolCommand('ping', 'h', 'win32').args, ['-n', '4', '-w', '2000', 'h']);
  assert.equal(toolCommand('traceroute', 'h', 'win32').file, 'tracert');
  assert.equal(toolCommand('traceroute', 'h', 'linux').fallback?.file, 'tracepath');
});

test('меню: простой режим прячет редкие разделы, ручные настройки важнее режима', () => {
  const simple = { uiMode: 'simple' as const, navOverrides: {}, navCollapsed: [] };
  const shown = NAV.filter((n) => isNavShown(n, simple)).map((n) => n.id);
  assert.ok(shown.includes('switches') && shown.includes('scenarios') && shown.includes('settings'));
  assert.ok(!shown.includes('history') && !shown.includes('backups'));
  assert.equal(hiddenNavCount({ ...simple, uiMode: 'full' }), 0);
  assert.ok(isNavShown(NAV.find((n) => n.id === 'history')!, { ...simple, navOverrides: { history: 'show' } }));
  assert.ok(!isNavShown(NAV.find((n) => n.id === 'linux')!, { ...simple, uiMode: 'full', navOverrides: { linux: 'more' } }));
});
