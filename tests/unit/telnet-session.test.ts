// Telnet-сессия против локального тестового сервера: согласование, автовход, захват вывода, закрытие.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { TelnetSession, IAC } from '../../src/main/ssh/telnet';

function fakeSwitch(): Promise<{ port: number; server: net.Server; got: string[] }> {
  const got: string[] = [];
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let stage: 'user' | 'pass' | 'cli' = 'user';
      let line = '';
      // Как настоящий коммутатор: сначала согласование (DO NAWS, WILL ECHO, WILL SGA), затем приглашение
      sock.write(Buffer.from([IAC, 253, 31, IAC, 251, 1, IAC, 251, 3]));
      sock.write('\r\nUser Name:');
      sock.on('data', (buf: Buffer) => {
        // Пропускаем ответы клиента на согласование
        const clean: number[] = [];
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === IAC) {
            if (buf[i + 1] === 250) {
              const end = buf.indexOf(240, i);
              i = end < 0 ? buf.length : end;
            } else i += 2;
            continue;
          }
          clean.push(buf[i]);
        }
        for (const ch of Buffer.from(clean).toString('utf8')) {
          if (ch === '\n' || ch === '\0') continue;
          if (ch !== '\r') {
            line += ch;
            continue;
          }
          got.push(line);
          if (stage === 'user') {
            stage = 'pass';
            sock.write('\r\nPassword:');
          } else if (stage === 'pass') {
            stage = 'cli';
            sock.write(line === 'Secret123' ? '\r\nsw1#' : '\r\nAccess denied\r\nUser Name:');
          } else if (line === 'show clock') {
            sock.write('\r\n12:00:00 MSK Tue Nov 17 2026\r\nsw1#');
          } else if (line === 'exit') {
            sock.end('\r\nbye\r\n');
          } else sock.write('\r\nsw1#');
          line = '';
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, server, got }));
  });
}

test('Telnet: подключение, автовход по сохранённому паролю, захват вывода и закрытие', async () => {
  const { port, server, got } = await fakeSwitch();
  const s = new TelnetSession({ deviceId: 1, deviceName: 'sw1', host: '127.0.0.1', platform: 'cisco-sg300', port, username: 'admin', password: 'Secret123', timeoutSec: 5, keepaliveSec: 0 });
  const typed: string[] = [];
  s.on('typed', (t: { line: string }) => typed.push(t.line));
  let out = '';
  s.on('data', (d: string) => (out += d));
  await s.connect({ cols: 100, rows: 30 });
  assert.equal(s.info.status, 'ready');
  assert.equal(s.info.protocol, 'telnet');
  await s.waitQuiet(300, 3000);
  assert.ok(out.includes('sw1#'), 'вход выполнен');
  assert.deepEqual(got.slice(0, 2), ['admin', 'Secret123']);
  assert.ok(!out.includes('\xff'), 'команды Telnet не попадают в вывод');
  const r = await s.capture('show clock', { timeoutMs: 3000, idleMs: 300 });
  assert.match(r.output, /12:00:00 MSK/);
  assert.ok(!typed.includes('Secret123'), 'пароль не учитывается как введённая команда');
  const closed = new Promise<void>((res) => s.once('closed', () => res()));
  s.write('exit\r');
  await closed;
  assert.equal(s.info.status, 'closed');
  server.close();
});

test('Telnet: закрытый порт — понятная ошибка', async () => {
  const srv = net.createServer();
  const port = await new Promise<number>((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as net.AddressInfo).port)));
  await new Promise<void>((r) => srv.close(() => r()));
  const s = new TelnetSession({ deviceId: 1, deviceName: 'x', host: '127.0.0.1', platform: 'cisco-ios', port, username: '', timeoutSec: 5, keepaliveSec: 0 });
  await assert.rejects(s.connect({ cols: 80, rows: 24 }), /закрыт/);
});
