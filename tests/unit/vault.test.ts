import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDriver } from '../../src/main/db/driver';
import { AppDatabase } from '../../src/main/db/database';
import { Vault, VaultLockedError, type OsCrypto } from '../../src/main/vault';
import { blankDevice } from '../../src/main/importExport';
import { DRIVER, freshDb, tmpDir } from './helpers';

const fakeOs = (backend = 'gnome_libsecret'): OsCrypto => ({
  isAvailable: () => true,
  backend: () => backend,
  encrypt: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decrypt: (b) => Buffer.from(b.toString().slice(4), 'base64').toString()
});

test('режим системного хранилища выбирается автоматически, если backend защищённый', async () => {
  const db = await freshDb();
  const v = new Vault(db, fakeOs());
  v.autoInit();
  assert.equal(v.status().mode, 'os');
  const d = db.saveDevice({ ...blankDevice(), name: 'x', host: '1.1.1.1' });
  v.store(d.id, 'password', 'P@ss');
  assert.equal(v.read(d.id, 'password'), 'P@ss');
  assert.ok(!db.getSecret(d.id, 'password')!.blob.includes('P@ss'));
});

test('Linux без keyring (basic_text) не считается защищённым', async () => {
  const db = await freshDb();
  const v = new Vault(db, fakeOs('basic_text'));
  v.autoInit();
  assert.equal(v.status().mode, 'unset');
  assert.equal(v.status().osSecure, false);
  assert.equal(v.canStore(), false);
});

test('мастер-пароль: шифрование, блокировка, неверный пароль', async () => {
  const dir = tmpDir();
  const path = join(dir, 'v.db');
  const db = new AppDatabase(await openDriver(path, DRIVER));
  db.migrate();
  const v = new Vault(db, null);
  v.setupMaster('очень-секретно-123');
  const d = db.saveDevice({ ...blankDevice(), name: 'sw', host: '10.0.0.1' });
  v.store(d.id, 'password', 'SwitchPassword!42');
  v.store(d.id, 'enablePassword', 'EnableSecret#7');
  assert.deepEqual(v.state(d.id), { password: true, keyPassphrase: false, enablePassword: true });
  v.lock();
  assert.throws(() => v.read(d.id, 'password'), VaultLockedError);
  assert.equal(v.unlock('неверно'), false);
  assert.equal(v.unlock('очень-секретно-123'), true);
  assert.equal(v.read(d.id, 'password'), 'SwitchPassword!42');
  db.close();
  const raw = readFileSync(path).toString('latin1');
  assert.ok(!raw.includes('SwitchPassword'), 'пароль не должен храниться в открытом виде');
  assert.ok(!raw.includes('EnableSecret'));
});

test('смена режима перешифровывает секреты', async () => {
  const db = await freshDb();
  const v = new Vault(db, fakeOs());
  v.autoInit();
  const d = db.saveDevice({ ...blankDevice(), name: 'x', host: '1.1.1.1' });
  v.store(d.id, 'password', 'abc12345');
  v.setupMaster('master-password');
  assert.equal(db.getSecret(d.id, 'password')!.scheme, 'master');
  assert.equal(v.read(d.id, 'password'), 'abc12345');
  v.switchMode('prompt');
  assert.equal(db.getSecret(d.id, 'password'), undefined);
});
