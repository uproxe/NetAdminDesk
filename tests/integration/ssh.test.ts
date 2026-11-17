// Интеграционная проверка SSH против настоящего OpenSSH-сервера (в CI — docker-контейнер, см. .github/workflows/build.yml).
// Локально: NAD_SSH_HOST=127.0.0.1 NAD_SSH_PORT=2222 NAD_SSH_USER=nad NAD_SSH_PASS=... npm run test:ssh
// Без переменных окружения тесты пропускаются.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { freshDb } from '../unit/helpers';
import { Vault } from '../../src/main/vault';
import { SessionManager, type PromptBridge } from '../../src/main/ssh/manager';
import { blankDevice } from '../../src/main/importExport';
import { TunnelManager, sftpDownload, sftpList, sftpRealpath, sftpRemove, sftpUpload } from '../../src/main/ssh/extras';
import type { HostKeyPrompt } from '../../src/shared/types';

const HOST = process.env.NAD_SSH_HOST;
const PORT = Number(process.env.NAD_SSH_PORT ?? 2222);
const USER = process.env.NAD_SSH_USER ?? 'nad';
const PASS = process.env.NAD_SSH_PASS ?? '';
const skip = HOST ? false : 'NAD_SSH_HOST не задан: тест выполняется в CI против docker sshd';

async function setup(answer: 'accept' | 'reject' | 'replace' = 'accept') {
  const db = await freshDb();
  const vault = new Vault(db, null);
  vault.setupMaster('integration-test-master');
  const dev = db.saveDevice({ ...blankDevice(), name: 'ci-sshd', host: HOST!, port: PORT, username: USER, platform: 'linux', deviceType: 'linux', authMethod: 'password', disablePagerOnConnect: false });
  vault.store(dev.id, 'password', PASS);
  const prompts: HostKeyPrompt[] = [];
  const bridge: PromptBridge = {
    hostKey: async (p) => (prompts.push(p), answer),
    kbd: async () => [PASS],
    credentials: async () => PASS
  };
  const mgr = new SessionManager(db, vault, bridge);
  return { db, vault, dev, prompts, mgr, setAnswer: (a: typeof answer) => (answer = a) };
}

test('первое подключение: запрос отпечатка, сохранение ключа, exec', { skip }, async () => {
  const { db, dev, prompts, mgr } = await setup('accept');
  const info = await mgr.connect(dev.id, { cols: 120, rows: 32 });
  assert.equal(info.status, 'ready');
  assert.equal(prompts.length, 1, 'при первом подключении должен быть запрос ключа');
  assert.equal(prompts[0].mismatch, false);
  assert.match(prompts[0].fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.ok(db.getKnownHost(HOST!, PORT), 'ключ должен быть сохранён');
  const r = await mgr.exec(info.id, 'echo nad-$((40+2)); uname -s', { source: 'diagnostic', risk: 'info' });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /nad-42\s+Linux/);
  mgr.disconnect(info.id);

  // Повторное подключение: ключ известен, запроса нет
  const info2 = await mgr.connect(dev.id, { cols: 120, rows: 32 });
  assert.equal(prompts.length, 1);
  mgr.disconnect(info2.id);
});

test('изменившийся ключ хоста блокирует подключение без явного подтверждения', { skip }, async () => {
  const { db, dev, prompts, mgr, setAnswer } = await setup('accept');
  const a = await mgr.connect(dev.id, { cols: 80, rows: 24 });
  mgr.disconnect(a.id);
  const real = db.getKnownHost(HOST!, PORT)!;
  db.saveKnownHost(HOST!, PORT, real.keyType, 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AAAA');
  // 'accept' не подходит для смены ключа — подключение отклоняется
  await assert.rejects(mgr.connect(dev.id, { cols: 80, rows: 24 }));
  assert.equal(prompts.at(-1)?.mismatch, true);
  assert.equal(db.getKnownHost(HOST!, PORT)?.fingerprint, 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'ключ не должен меняться без «replace»');
  setAnswer('reject');
  await assert.rejects(mgr.connect(dev.id, { cols: 80, rows: 24 }));
  // Явная замена — после сверки пользователем
  setAnswer('replace');
  const b = await mgr.connect(dev.id, { cols: 80, rows: 24 });
  assert.equal(db.getKnownHost(HOST!, PORT)?.fingerprint, real.fingerprint);
  mgr.disconnect(b.id);
});

test('интерактивная оболочка: ввод, вывод и захват команды', { skip }, async () => {
  const { dev, mgr } = await setup('accept');
  const info = await mgr.connect(dev.id, { cols: 120, rows: 32 });
  let out = '';
  mgr.on('data', (_id: string, chunk: string) => (out += chunk));
  mgr.write(info.id, 'echo marker-$((6*7))\r');
  const t0 = Date.now();
  while (!/marker-42/.test(out) && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
  assert.match(out, /marker-42/);
  mgr.disconnect(info.id);
});

test('история: пароли в командах маскируются', { skip }, async () => {
  const { db, dev, mgr } = await setup('accept');
  const info = await mgr.connect(dev.id, { cols: 120, rows: 32 });
  await mgr.exec(info.id, 'echo "mysql -u root -pSecret123" >/dev/null', { source: 'reference', risk: 'info' });
  const h = db.listHistory({ limit: 20 });
  assert.ok(h.length > 0);
  assert.ok(h.every((e) => !e.command.includes('Secret123')), 'пароль не должен попадать в историю');
  mgr.disconnect(info.id);
});

test('SFTP: загрузка, список, скачивание, удаление', { skip }, async () => {
  const { dev, mgr } = await setup('accept');
  const info = await mgr.connect(dev.id, { cols: 120, rows: 32 });
  const sftp = await mgr.session(info.id).sftp();
  const home = await sftpRealpath(sftp, '.');
  const dir = mkdtempSync(join(tmpdir(), 'nad-sftp-'));
  const local = join(dir, 'up.txt');
  writeFileSync(local, 'привет, sftp\n');
  await sftpUpload(sftp, local, `${home}/nad-up.txt`);
  const list = await sftpList(sftp, home);
  assert.ok(list.some((e) => e.name === 'nad-up.txt' && !e.isDir));
  await sftpDownload(sftp, `${home}/nad-up.txt`, join(dir, 'down.txt'));
  assert.equal(readFileSync(join(dir, 'down.txt'), 'utf8'), 'привет, sftp\n');
  await sftpRemove(sftp, `${home}/nad-up.txt`, false);
  mgr.disconnect(info.id);
});

test('локальный туннель: порт пробрасывается к sshd внутри сервера', { skip }, async () => {
  const { dev, mgr } = await setup('accept');
  const info = await mgr.connect(dev.id, { cols: 120, rows: 32 });
  const tunnels = new TunnelManager();
  const t = await tunnels.start({ sessionId: info.id, type: 'local', bindHost: '127.0.0.1', bindPort: 0, targetHost: '127.0.0.1', targetPort: Number(process.env.NAD_SSH_INNER_PORT ?? 22) }, mgr.session(info.id).sshClient);
  assert.equal(t.status, 'listening');
  const banner = await new Promise<string>((resolve, reject) => {
    const sock = net.connect(t.bindPort, '127.0.0.1');
    sock.once('data', (d) => (resolve(d.toString()), sock.destroy()));
    sock.once('error', reject);
    setTimeout(() => reject(new Error('нет ответа через туннель')), 8000);
  });
  assert.match(banner, /^SSH-2\.0-/);
  tunnels.stopAll();
  mgr.disconnect(info.id);
});
