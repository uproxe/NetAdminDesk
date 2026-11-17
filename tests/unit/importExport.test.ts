import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedDatabase } from '../../src/main/seed';
import { Vault } from '../../src/main/vault';
import * as io from '../../src/main/importExport';
import { encryptBundle, decryptBundle } from '../../src/main/crypto';
import { USER_DIR, freshDb, tmpDir } from './helpers';

test('зашифрованный перенос: устройства, секреты, команды, ключи хостов', async () => {
  const dir = tmpDir();
  const src = await freshDb();
  seedDatabase(src, USER_DIR);
  const vs = new Vault(src, null);
  vs.setupMaster('source-master');
  const g = src.saveGroup({ name: 'OSNOVO', parentId: null, kind: 'group', sort: 0 });
  const d = src.saveDevice({ ...io.blankDevice(), name: 'osnovo-1', host: '10.10.102.117', username: 'admin', platform: 'osnovo', groupId: g.id });
  vs.store(d.id, 'password', 'Osn0vo!');
  src.saveKnownHost('10.10.102.117', 22, 'ssh-rsa', 'SHA256:xyz', 'AAAA');
  const cmd = src.listCommands().find((c) => c.platform === 'osnovo')!;
  src.setCommandFlags(cmd.id, { favorite: true });
  src.saveCommand({ ...cmd, id: undefined, uid: '', source: 'user', title: 'Моя команда', command: 'show bridge fdb vlan 102' });
  const file = join(dir, 'export.nadx');
  const counts = io.exportEncrypted(src, vs, file, 'export-password', { includeHistory: false });
  assert.equal(counts.secrets, 1);
  assert.ok(!readFileSync(file, 'utf8').includes('Osn0vo'));
  assert.throws(() => io.previewEncrypted(file, 'wrong-password'), /Неверный пароль/);

  const dst = await freshDb();
  seedDatabase(dst, USER_DIR);
  const vd = new Vault(dst, null);
  vd.setupMaster('target-master');
  const res = io.importEncrypted(dst, vd, file, 'export-password', { overwriteConflicts: false, importSettings: false });
  assert.equal(res.devices, 1);
  assert.equal(res.secrets, 1);
  const nd = dst.listDevices()[0];
  assert.equal(vd.read(nd.id, 'password'), 'Osn0vo!');
  assert.equal(dst.listGroups()[0].name, 'OSNOVO');
  assert.ok(dst.listCommands().some((c) => c.title === 'Моя команда'));
  assert.ok(dst.listCommands().find((c) => c.uid === cmd.uid)!.favorite);
  assert.equal(dst.getKnownHost('10.10.102.117', 22)!.fingerprint, 'SHA256:xyz');
  // повторный импорт не дублирует
  const res2 = io.importEncrypted(dst, vd, file, 'export-password', { overwriteConflicts: false, importSettings: false });
  assert.equal(res2.devices, 0);
  assert.equal(dst.listDevices().length, 1);
});

test('JSON: экспорт и импорт пользовательских данных', async () => {
  const dir = tmpDir();
  const a = await freshDb();
  seedDatabase(a, USER_DIR);
  a.saveNote({ title: 'VLAN камер', body: '101–107', tags: [] });
  a.saveDevice({ ...io.blankDevice(), name: 'srv', host: '10.0.0.5', platform: 'linux', username: 'root' });
  const f = join(dir, 'x.json');
  io.exportJson(a, f);
  assert.ok(!readFileSync(f, 'utf8').includes('"secrets"'));
  const b = await freshDb();
  const pv = io.previewJson(b, f);
  assert.ok(pv.commands.new > 150);
  io.importJson(b, f, { overwriteConflicts: false });
  assert.equal(b.listNotes()[0].title, 'VLAN камер');
  assert.equal(b.listDevices()[0].name, 'srv');
});

test('TXT: экспорт сохраняет исходный текст записей', async () => {
  const dir = tmpDir();
  const db = await freshDb();
  seedDatabase(db, USER_DIR);
  const f = join(dir, 'out.txt');
  io.exportTxt(db, f, { kinds: ['switch'], sources: ['imported'] });
  const text = readFileSync(f, 'utf8');
  assert.ok(text.includes('show mac address-table address 0011.2233.4466 - показывает в каком Vlan'));
  const sensitive = db.listCommands(true).filter((c) => c.sensitive && c.source === 'imported');
  assert.ok(sensitive.length > 0);
  for (const c of sensitive) {
    const own = (c.rawText ?? c.description).trim();
    if (own.length > 10) assert.ok(!text.includes(own), 'чувствительные записи не экспортируются');
  }
});

test('CSV и ~/.ssh/config', async () => {
  const dir = tmpDir();
  const db = await freshDb();
  const csv = join(dir, 'd.csv');
  writeFileSync(csv, 'Название;IP;Порт;Логин;Тип;Группа;Пароль\ncore;10.10.1.1;22;admin;Cisco;Core;secret\nosn;10.10.102.117;;admin;OSNOVO;Access;\n');
  const pv = io.previewDevicesCsv(db, csv);
  assert.equal(pv.devices.length, 2);
  assert.equal(pv.devices[1].platform, 'osnovo');
  assert.ok(pv.hasPasswordColumn);
  const v = new Vault(db, null);
  v.setupMaster('12345678');
  assert.equal(io.importDevicesCsv(db, v, csv, { importPasswords: false, skipDuplicates: true }), 2);
  assert.equal(db.getSecret(db.listDevices()[0].id, 'password'), undefined, 'пароли без согласия не импортируются');
  assert.equal(db.listGroups().length, 2);
  const cfg = join(dir, 'config');
  writeFileSync(cfg, 'Host *\n  ServerAliveInterval 30\nHost old-sw\n  HostName 10.10.5.5\n  User admin\n  KexAlgorithms +diffie-hellman-group1-sha1\nHost web\n  HostName 10.0.0.7\n  Port 2222\n  IdentityFile ~/.ssh/id_ed25519\n');
  const sp = io.previewSshConfig(db, cfg);
  assert.equal(sp.devices.length, 2);
  assert.equal(sp.devices[0].legacyAlgorithms, true);
  assert.equal(sp.devices[1].authMethod, 'key');
  assert.equal(sp.devices[1].port, 2222);
});

test('формат зашифрованного пакета', () => {
  const b = encryptBundle({ a: 1 }, 'password123', { schemaVersion: 1, appVersion: 't' });
  assert.equal(b.format, 'netadmin-desk-export');
  assert.deepEqual(decryptBundle(b, 'password123'), { a: 1 });
  assert.throws(() => decryptBundle(b, 'password124'));
  assert.throws(() => encryptBundle({}, 'short', { schemaVersion: 1, appVersion: 't' }));
});

test('перенос устройств: файл без паролей, выбор устройств, узел-посредник, группы, ключи хостов', async () => {
  const dir = tmpDir();
  const src = await freshDb();
  seedDatabase(src, USER_DIR);
  const parent = src.saveGroup({ name: 'Площадка 1', parentId: null, kind: 'folder', sort: 0 });
  const g = src.saveGroup({ name: 'Коммутаторы доступа', parentId: parent.id, kind: 'group', sort: 0 });
  const other = src.saveGroup({ name: 'Не нужна', parentId: null, kind: 'group', sort: 0 });
  const jump = src.saveDevice({ ...io.blankDevice(), name: 'bastion', host: '10.10.0.2', username: 'admin', platform: 'linux', groupId: other.id });
  const sw = src.saveDevice({ ...io.blankDevice(), name: 'SW-ACCESS-1', host: '10.10.1.11', username: 'admin', platform: 'cisco-ios', groupId: g.id, jumpDeviceId: jump.id, tags: ['этаж 2'] });
  src.saveDevice({ ...io.blankDevice(), name: 'лишний', host: '10.10.9.9', username: 'u', platform: 'linux' });
  src.saveKnownHost('10.10.1.11', 22, 'ssh-ed25519', 'SHA256:sw', 'AAAA');
  src.saveKnownHost('10.10.9.9', 22, 'ssh-ed25519', 'SHA256:other', 'BBBB');
  const vs = new Vault(src, null);
  vs.setupMaster('m-pass-1');
  vs.store(sw.id, 'password', 'Sw1tch!pass');

  const f = join(dir, 'devices.nadevices');
  const r = io.exportDevices(src, vs, f, { deviceIds: [sw.id], knownHosts: true, secrets: false });
  assert.deepEqual([r.devices, r.jumpAdded, r.secrets, r.encrypted, r.knownHosts], [2, 1, 0, 0, 1]);
  const text = readFileSync(f, 'utf8');
  assert.ok(!text.includes('Sw1tch!pass') && !text.includes('"secrets"'));
  assert.ok(!text.includes('лишний') && !text.includes('"commands": [\n    {'));
  assert.throws(() => io.exportDevices(src, vs, f + '2', { knownHosts: false, secrets: true }), /задайте пароль/);

  const dst = await freshDb();
  seedDatabase(dst, USER_DIR);
  const vd = new Vault(dst, null);
  const pv = io.previewDevicesFile(dst, f);
  assert.equal(pv.encrypted, false);
  assert.equal(pv.content, 'devices');
  assert.equal(pv.devices.length, 2);
  assert.equal(pv.devices.find((d) => d.name === 'SW-ACCESS-1')!.group, 'Коммутаторы доступа');
  const res = io.importDevicesFile(dst, vd, f, { overwrite: false, knownHosts: true, secrets: false });
  assert.equal(res.devices, 2);
  assert.equal(res.knownHosts, 1);
  const nsw = dst.listDevices().find((d) => d.name === 'SW-ACCESS-1')!;
  const nj = dst.listDevices().find((d) => d.name === 'bastion')!;
  assert.equal(nsw.jumpDeviceId, nj.id);
  assert.deepEqual(nsw.tags, ['этаж 2']);
  const ng = dst.listGroups().find((x) => x.id === nsw.groupId)!;
  assert.equal(ng.name, 'Коммутаторы доступа');
  assert.equal(dst.listGroups().find((x) => x.id === ng.parentId)!.name, 'Площадка 1');
  assert.equal(dst.getKnownHost('10.10.1.11', 22)!.fingerprint, 'SHA256:sw');
  assert.ok(!dst.getKnownHost('10.10.9.9', 22));
  // повторный импорт: дубликаты пропускаются
  const again = io.importDevicesFile(dst, vd, f, { overwrite: false, knownHosts: true, secrets: false });
  assert.deepEqual([again.devices, again.devicesSkipped, again.knownHosts], [0, 2, 0]);
  assert.equal(io.previewDevicesFile(dst, f).devices.every((d) => d.duplicateOf), true);
});

test('перенос устройств: зашифрованный файл с паролями, чужой ключ хоста не заменяется', async () => {
  const dir = tmpDir();
  const src = await freshDb();
  const vs = new Vault(src, null);
  vs.setupMaster('m-pass-1');
  const d = src.saveDevice({ ...io.blankDevice(), name: 'srv-db', host: '10.10.5.20', username: 'admin', platform: 'linux' });
  vs.store(d.id, 'password', 'Secr3t-DB!');
  src.saveKnownHost('10.10.5.20', 22, 'ssh-ed25519', 'SHA256:real', 'AAAA');
  const f = join(dir, 'enc.nadevices');
  const r = io.exportDevices(src, vs, f, { knownHosts: true, secrets: true, password: 'transfer-pass' });
  assert.equal(r.secrets, 1);
  assert.equal(r.encrypted, 1);
  const raw = readFileSync(f, 'utf8');
  assert.ok(!raw.includes('Secr3t-DB!') && !raw.includes('srv-db') && !raw.includes('10.10.5.20'));

  const dst = await freshDb();
  dst.saveKnownHost('10.10.5.20', 22, 'ssh-ed25519', 'SHA256:different', 'CCCC');
  const vd = new Vault(dst, null);
  vd.setupMaster('other-master');
  const locked = io.previewDevicesFile(dst, f);
  assert.equal(locked.needsPassword, true);
  assert.equal(locked.devices.length, 0);
  assert.throws(() => io.previewDevicesFile(dst, f, 'wrong-pass'), /Неверный пароль/);
  assert.throws(() => io.importDevicesFile(dst, vd, f, { overwrite: false, knownHosts: true, secrets: true }), /введите пароль/);
  const pv = io.previewDevicesFile(dst, f, 'transfer-pass');
  assert.equal(pv.secrets, 1);
  assert.equal(pv.knownHostConflicts, 1);
  assert.equal(pv.devices[0].hasSecret, true);
  // пароли не импортируются без явного согласия
  const res0 = io.importDevicesFile(dst, vd, f, { password: 'transfer-pass', overwrite: false, knownHosts: true, secrets: false });
  const nd = dst.listDevices()[0];
  assert.equal(res0.secrets, undefined);
  assert.ok(!vd.read(nd.id, 'password'));
  assert.equal(res0.knownHostConflicts, 1);
  assert.equal(dst.getKnownHost('10.10.5.20', 22)!.fingerprint, 'SHA256:different');
  const res = io.importDevicesFile(dst, vd, f, { password: 'transfer-pass', overwrite: false, knownHosts: true, secrets: true });
  assert.equal(res.secrets, 1);
  assert.equal(vd.read(nd.id, 'password'), 'Secr3t-DB!');
});

test('перенос устройств: из полной копии берутся только устройства; CSV совместим с импортом CSV', async () => {
  const dir = tmpDir();
  const src = await freshDb();
  seedDatabase(src, USER_DIR);
  src.saveNote({ title: 'заметка', body: 'x', tags: [] });
  const g = src.saveGroup({ name: 'Серверы; Linux', parentId: null, kind: 'group', sort: 0 });
  src.saveDevice({ ...io.blankDevice(), name: 'srv "A"', host: '10.10.7.1', username: 'root', platform: 'linux', deviceType: 'linux', groupId: g.id, description: 'строка, с запятой' });
  src.saveDevice({ ...io.blankDevice(), name: 'console', host: 'COM3', port: 0, protocol: 'serial', serialBaud: 115200, platform: 'cisco-ios', deviceType: 'cisco' });
  const full = join(dir, 'full.json');
  io.exportJson(src, full);
  const dst = await freshDb();
  const vd = new Vault(dst, null);
  const pv = io.previewDevicesFile(dst, full);
  assert.equal(pv.content, 'data');
  assert.ok(pv.devices.find((d) => d.protocol === 'serial')!.warnings.some((w) => /COM-порт/.test(w)));
  io.importDevicesFile(dst, vd, full, { overwrite: false, knownHosts: false, secrets: false });
  assert.equal(dst.listDevices().length, 2);
  assert.equal(dst.listNotes().length, 0);
  assert.equal(dst.listCommands().filter((c) => c.source !== 'builtin').length, 0);

  const csv = join(dir, 'devices.csv');
  assert.equal(io.exportDevicesCsv(src, csv), 2);
  const bytes = readFileSync(csv);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(bytes.toString('utf8').split('\r\n')[0], '\ufeffname,host,port,protocol,username,type,model,group,location,description,tags,auth,key,baud');
  const back = io.previewDevicesCsv(await freshDb(), csv);
  assert.deepEqual(back.errors, []);
  const a = back.devices.find((d) => d.host === '10.10.7.1')!;
  assert.equal(a.name, 'srv "A"');
  assert.equal(a.description, 'строка, с запятой');
  assert.equal(a.deviceType, 'linux');
  assert.equal(back.groups[back.devices.indexOf(a)], 'Серверы; Linux');
  const c = back.devices.find((d) => d.host === 'COM3')!;
  assert.equal(c.protocol, 'serial');
  assert.equal(c.serialBaud, 115200);
});
