import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openDriver } from '../../src/main/db/driver';
import { AppDatabase } from '../../src/main/db/database';
import { seedDatabase } from '../../src/main/seed';
import { blankDevice } from '../../src/main/importExport';
import { BUILTIN_COMMANDS } from '../../data/index';
import { DRIVER, USER_DIR, freshDb, tmpDir } from './helpers';
import type { CommandInput, CommandRecord } from '../../src/shared/types';

test(`БД (${DRIVER}): миграции, первичное наполнение и импорт TXT`, async () => {
  const db = await freshDb();
  const res = seedDatabase(db, USER_DIR);
  assert.equal(res.builtin.inserted, BUILTIN_COMMANDS.length);
  assert.equal(res.reports.length, 2);
  for (const r of res.reports) assert.deepEqual(r.unaccounted, []);
  const all = db.listCommands();
  assert.ok(all.filter((c) => c.source === 'imported').length > 150);
  assert.ok(all.filter((c) => c.source === 'imported').length >= 10);
  assert.equal(db.integrityCheck(), 'ok');
  // повторный запуск не создаёт дубликатов
  const again = seedDatabase(db, USER_DIR);
  assert.equal(again.reports.length, 0);
  assert.equal(db.listCommands().length, all.length);
  db.close();
});

test(`БД (${DRIVER}): пользовательские изменения не перезаписываются обновлением справочника`, async () => {
  const db = await freshDb();
  seedDatabase(db, USER_DIR);
  const c = db.listCommands().find((x) => x.source === 'builtin' && x.kind === 'linux')!;
  db.setCommandFlags(c.id, { favorite: true, verified: true });
  const edited = db.saveCommand({ ...c, description: 'моё описание' });
  assert.ok(edited.userModified);
  const r = db.upsertSeedCommand({ ...c, id: undefined, description: 'новое встроенное описание' } as never);
  assert.equal(r.action, 'skipped');
  assert.equal(db.getCommand(c.id)!.description, 'моё описание');
  const other = db.listCommands().find((x) => x.source === 'builtin' && x.id !== c.id)!;
  db.setCommandFlags(other.id, { favorite: true });
  db.upsertSeedCommand({ ...other, title: 'обновлено', id: undefined } as never);
  const after = db.getCommand(other.id)!;
  assert.equal(after.title, 'обновлено');
  assert.equal(after.favorite, true);
  db.close();
});

test(`БД (${DRIVER}): устройства, группы, история, настройки, сохранение на диск`, async () => {
  const dir = tmpDir();
  const path = join(dir, 'netadmin.db');
  let db = new AppDatabase(await openDriver(path, DRIVER));
  db.migrate();
  const g = db.saveGroup({ name: 'Core-коммутаторы', parentId: null, kind: 'group', sort: 0 });
  const d = db.saveDevice({ ...blankDevice(), name: 'core-sw1', host: '10.10.1.1', username: 'admin', platform: 'cisco-ios', deviceType: 'cisco', groupId: g.id, tags: ['core'] });
  assert.equal(d.groupId, g.id);
  db.addHistory({ deviceId: d.id, deviceName: d.name, command: 'show version', source: 'reference', risk: 'info', result: 'sent', note: '' });
  db.setSettings({ theme: 'light', terminalFontSize: 15 });
  db.saveKnownHost('10.10.1.1', 22, 'ssh-ed25519', 'SHA256:abc', 'AAAA');
  db.close();
  db = new AppDatabase(await openDriver(path, DRIVER));
  db.migrate();
  assert.equal(db.listDevices()[0].name, 'core-sw1');
  assert.equal(db.listHistory()[0].command, 'show version');
  assert.equal(db.getSettings().theme, 'light');
  assert.equal(db.getKnownHost('10.10.1.1', 22)!.fingerprint, 'SHA256:abc');
  db.deleteGroup(g.id);
  assert.equal(db.getDevice(d.id)!.groupId, null);
  db.deleteDevice(d.id);
  assert.equal(db.listDevices().length, 0);
  db.close();
});

test(`БД (${DRIVER}): удаление встроенной записи — мягкое, восстановление возможно`, async () => {
  const db = await freshDb();
  seedDatabase(db, USER_DIR);
  const n = db.listCommands().length;
  const c = db.listCommands().find((x) => x.source === 'imported')!;
  db.deleteCommand(c.id);
  assert.equal(db.listCommands().length, n - 1);
  assert.equal(db.upsertSeedCommand({ ...c, id: undefined } as never).action, 'skipped');
  assert.equal(db.restoreDeletedCommands(), 1);
  assert.equal(db.listCommands().length, n);
  db.close();
});

test(`БД (${DRIVER}): обновление до 1.0 — старые записи TXT заменяются, свои правки и избранное сохраняются, команды БД переезжают в SQL`, async () => {
  const db = await freshDb();
  seedDatabase(db, USER_DIR);
  const txt = db.listCommands().filter((c) => c.uid.startsWith('txt-main:'));
  const fav = txt[3];
  const changed = txt[5];
  db.setCommandFlags(fav.id, { favorite: true });
  // имитация старой версии: устаревшая строка, своя правка, другой текст записи, команда БД в разделе Linux
  const input = (c: CommandRecord): CommandInput => {
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = c;
    return rest;
  };
  const base = input(changed);
  db.insertCommand({ ...base, uid: 'txt-main:L9999', title: 'Старая запись', command: 'show old' });
  db.insertCommand({ ...base, uid: 'txt-main:L9998', title: 'Моя правка', command: 'show mine', userModified: true });
  db.updateCommand(changed.id, { ...base, command: 'старый текст' });
  const pg = db.listCommands().find((c) => c.uid === 'builtin:linux:pg-dump')!;
  db.updateCommand(pg.id, { ...input(pg), kind: 'linux', category: 'backup', platform: 'linux' });
  db.setCommandFlags(pg.id, { favorite: true });
  db.setMeta('seed_version', '2');
  db.setMeta('seedfile:txt-main', 'старая-контрольная-сумма');

  seedDatabase(db, USER_DIR);
  const all = db.listCommands();
  assert.ok(!all.some((c) => c.uid === 'txt-main:L9999'), 'устаревшая запись TXT удалена');
  assert.ok(all.some((c) => c.uid === 'txt-main:L9998'), 'своя правка сохранена');
  assert.equal(all.find((c) => c.id === changed.id)!.command, changed.command);
  assert.equal(all.find((c) => c.id === fav.id)!.favorite, true);
  const moved = all.find((c) => c.uid === 'builtin:linux:pg-dump')!;
  assert.equal(moved.kind, 'sql');
  assert.equal(moved.favorite, true);
  db.close();
});
