import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCaptured, endsWithPrompt, isPagerPrompt, isPasswordPrompt, renderLines, stripAnsi } from '../../src/shared/terminalText';
import { isOpenSshKeyEncrypted } from '../../src/main/ssh/keys';
import { LINUX_CHECKS, parseDf, parseFreeBytes } from '../../src/shared/linuxDiag';

test('очистка вывода коммутатора с постраничным выводом', () => {
  const raw = 'show running-config\r\nBuilding configuration...\r\nhostname sw1\r\n --More-- \b\b\b\b\b\b\b\b\b\b          \b\b\b\b\b\b\b\b\b\binterface Gi1/0/1\r\n description X\r\nsw1#';
  const out = cleanCaptured(raw, 'show running-config');
  assert.equal(out, 'Building configuration...\nhostname sw1\ninterface Gi1/0/1\n description X');
});

test('распознавание приглашений и запросов', () => {
  assert.ok(endsWithPrompt('...\r\nSW-CORE-1#'));
  assert.ok(endsWithPrompt('\r\nLab Switch_506> '));
  assert.ok(endsWithPrompt('\r\nadmin@srv:~$ '));
  assert.ok(!endsWithPrompt('\r\n --More-- '));
  assert.ok(isPagerPrompt('line\r\n--More--'));
  assert.ok(isPagerPrompt('-- MORE --, next page: Space, next line: Enter, quit: Control-C'));
  assert.ok(isPasswordPrompt('\r\nPassword: '));
  assert.ok(isPasswordPrompt('[sudo] password for admin: '));
  assert.equal(stripAnsi('\x1b[1;32mok\x1b[0m'), 'ok');
  assert.equal(renderLines('abc\rxy'), 'xyc');
});

test('ключ OpenSSH: определение шифрования', () => {
  const none = Buffer.concat([Buffer.from('openssh-key-v1\0'), Buffer.from([0, 0, 0, 4]), Buffer.from('none')]).toString('base64');
  const aes = Buffer.concat([Buffer.from('openssh-key-v1\0'), Buffer.from([0, 0, 0, 10]), Buffer.from('aes256-ctr')]).toString('base64');
  assert.equal(isOpenSshKeyEncrypted(`-----BEGIN OPENSSH PRIVATE KEY-----\n${none}\n-----END OPENSSH PRIVATE KEY-----`), false);
  assert.equal(isOpenSshKeyEncrypted(`-----BEGIN OPENSSH PRIVATE KEY-----\n${aes}\n-----END OPENSSH PRIVATE KEY-----`), true);
});

test('анализ Linux-диагностики', () => {
  const free = '               total        used        free      shared  buff/cache   available\nMem:     8000000000  7700000000   100000000     1000000   200000000   200000000\nSwap:    2000000000  1500000000   500000000';
  const f = parseFreeBytes(free)!;
  assert.equal(f.available, 200000000);
  const mem = LINUX_CHECKS.find((c) => c.id === 'memory')!.analyze([{ command: 'free -b', output: free }]);
  assert.equal(mem.status, 'crit');
  const df = 'Filesystem     1-blocks       Used  Available Capacity Mounted on\n/dev/sda1   100000000000 96000000000 4000000000      96% /\n/dev/sdb1   100000000000 50000000000 50000000000      50% /data';
  assert.equal(parseDf(df).length, 2);
  const disks = LINUX_CHECKS.find((c) => c.id === 'disks')!.analyze([{ command: '', output: df }, { command: '', output: '' }]);
  assert.equal(disks.status, 'crit');
  assert.ok(disks.findings[0].startsWith('/:'));
  const cpu = LINUX_CHECKS.find((c) => c.id === 'cpu')!.analyze([{ command: '', output: '4' }, { command: '', output: '0.50 0.60 0.70 1/200 1234' }, { command: '', output: '%Cpu(s):  2.0 us,  1.0 sy,  0.0 ni, 96.0 id,  1.0 wa' }]);
  assert.equal(cpu.status, 'ok');
  const svc = LINUX_CHECKS.find((c) => c.id === 'services')!.analyze([{ command: '', output: 'nginx.service loaded failed failed A high performance web server' }]);
  assert.equal(svc.status, 'crit');
  const dock = LINUX_CHECKS.find((c) => c.id === 'docker')!.analyze([{ command: '', output: 'NO_DOCKER' }]);
  assert.equal(dock.status, 'info');
});

test('диагностика Linux: состояние службы SSH', () => {
  const ssh = LINUX_CHECKS.find((c) => c.id === 'ssh')!;
  const run = (state: string, conf = 'NEED_ROOT') => ssh.analyze([{ command: ssh.commands[0], output: state }, { command: ssh.commands[1], output: conf }]);
  assert.equal(run('active\n').status, 'ok');
  // Сессия идёт по SSH — «inactive» по systemd означает проверить настройку, а не аварию
  assert.equal(run('inactive\n').status, 'warn');
  assert.equal(run('').status, 'unknown');
  assert.equal(run('active\n', 'permitrootlogin yes\npasswordauthentication yes').status, 'warn');
});
