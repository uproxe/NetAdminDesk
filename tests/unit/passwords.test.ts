import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, tmpDir } from './helpers';
import { PasswordStore, PM_FILE_FORMAT } from '../../src/main/passwords';
import {
  DEFAULT_PM,
  detectDelimiter,
  estimateStrength,
  generatePassword,
  generatorEntropy,
  mapCsvRows,
  parseCsv,
  toCsv,
  withPmDefaults,
  type PmEntryInput
} from '../../src/shared/passwords';

// Облегчённый scrypt, чтобы тесты шли быстро; в программе — N=2^17.
const FAST_KDF = { N: 1 << 10, r: 8, p: 1 };
const MASTER = 'Correct-Horse-42';

function fakeClipboard() {
  let text = '';
  return { writeText: (t: string) => void (text = t), readText: () => text };
}

function entry(p: Partial<PmEntryInput>): PmEntryInput {
  return { title: 'Запись', username: '', password: '', url: '', notes: '', groupId: null, favorite: false, tags: [], ...p };
}

async function store(opts: { now?: () => number } = {}) {
  const db = await freshDb();
  const clipboard = fakeClipboard();
  const locks: string[] = [];
  const pm = new PasswordStore(db, { kdf: FAST_KDF, clipboard, now: opts.now, appVersion: '1.2.0', onLock: (r) => locks.push(r) });
  return { db, pm, clipboard, locks };
}

test('менеджер паролей: мастер-пароль, шифрование на диске, открытие и блокировка', async () => {
  const { db, pm, locks } = await store();
  assert.deepEqual({ ...pm.status(), retryAfterSec: 0 }, { configured: false, unlocked: false, entryCount: 0, lockedReason: 'startup', retryAfterSec: 0 });
  await assert.rejects(pm.setup('short'), /не короче 8/);
  await pm.setup(MASTER);
  assert.equal(pm.status().unlocked, true);
  await assert.rejects(pm.setup(MASTER), /уже создан/);

  const sw = pm.saveGroup({ name: 'Коммутаторы' });
  const e = pm.save(entry({ title: 'SW-CORE-1', username: 'admin', password: 'S3cret!Pass#2026', url: 'ssh://192.0.2.1', notes: 'Стойка 2, юнит 14', groupId: sw.id }));
  assert.equal(e.hasPassword, true);

  // В базе — только зашифрованные данные: ни пароля, ни логина, ни названий папок и записей
  const dump = JSON.stringify([db.pmRows('pm_entries'), db.pmRows('pm_groups'), db.getMeta('pm_master')]);
  for (const secret of ['S3cret!Pass#2026', 'admin', 'SW-CORE-1', 'Коммутаторы', 'Стойка 2', '192.0.2.1', MASTER]) assert.ok(!dump.includes(secret), `в базе открытым текстом: ${secret}`);

  pm.lock();
  assert.deepEqual(locks, ['manual']);
  assert.equal(pm.status().unlocked, false);
  assert.equal(pm.status().entryCount, 1, 'число записей известно и без расшифровки');
  assert.throws(() => pm.list(), /заблокирован/);
  assert.throws(() => pm.reveal(e.id), /заблокирован/);

  await assert.rejects(pm.unlock('wrong-password'), /Неверный мастер-пароль/);
  await pm.unlock(MASTER);
  const { entries, groups } = pm.list();
  assert.equal(entries.length, 1);
  assert.equal(groups[0].name, 'Коммутаторы');
  assert.equal(groups[0].count, 1);
  assert.equal(pm.reveal(e.id), 'S3cret!Pass#2026');
  assert.equal(pm.get(e.id).notes, 'Стойка 2, юнит 14');
  assert.equal((pm.get(e.id) as unknown as Record<string, unknown>).password, undefined, 'карточка не содержит пароля');
  assert.equal((entries[0] as unknown as Record<string, unknown>).password, undefined, 'список не содержит паролей');
});

test('менеджер паролей: подмена зашифрованных данных обнаруживается', async () => {
  const { db, pm } = await store();
  await pm.setup(MASTER);
  const a = pm.save(entry({ title: 'A', password: 'aaaaaaaa1' }));
  const b = pm.save(entry({ title: 'B', password: 'bbbbbbbb2' }));
  pm.lock();
  // blob записи A подставлен в строку B: привязка к идентификатору (AAD) не даст расшифровать
  const rows = db.pmRows('pm_entries');
  const blobA = rows.find((r) => r.uid === a.id)!.blob;
  db.pmPut('pm_entries', b.id, blobA);
  await assert.rejects(pm.unlock(MASTER), /повреждена или изменена/);
  assert.equal(pm.status().unlocked, false);
});

test('менеджер паролей: история паролей, повторы и слабые пароли, папки', async () => {
  let t = Date.parse('2026-11-23T10:00:00Z');
  const { pm } = await store({ now: () => t });
  await pm.setup(MASTER);
  const g = pm.saveGroup({ name: 'Серверы' });
  assert.throws(() => pm.saveGroup({ name: 'серверы' }), /уже есть/);
  const e = pm.save(entry({ title: 'srv-db-1', username: 'root', password: 'First-Pass-111', groupId: g.id }));
  t += 60_000;
  pm.save({ ...entry({ title: 'srv-db-1', username: 'root', groupId: g.id }), id: e.id, password: 'Second-Pass-222' });
  t += 60_000;
  // password не передан — пароль и история не меняются
  pm.save({ ...entry({ title: 'srv-db-1 (основной)', username: 'root', groupId: g.id }), id: e.id, password: undefined });
  const d = pm.get(e.id);
  assert.equal(d.title, 'srv-db-1 (основной)');
  assert.equal(d.historyCount, 1);
  assert.equal(pm.reveal(e.id), 'Second-Pass-222');
  assert.equal(pm.reveal(e.id, 0), 'First-Pass-111');
  assert.equal(d.passwordChangedAt, '2026-11-23T10:01:00.000Z');

  pm.save(entry({ title: 'Камера 1', username: 'admin', password: 'admin123' }));
  pm.save(entry({ title: 'Камера 2', username: 'admin', password: 'admin123' }));
  const list = pm.list().entries;
  const cam = list.filter((x) => x.title.startsWith('Камера'));
  assert.ok(cam.every((x) => x.weak && x.reused), 'admin123 — слабый и повторяется');
  assert.ok(!list.find((x) => x.id === e.id)!.weak);

  pm.removeGroup(g.id);
  assert.equal(pm.get(e.id).groupId, null, 'записи из удалённой папки остаются без папки');
  pm.remove(e.id);
  assert.throws(() => pm.get(e.id), /не найдена/);
  assert.throws(() => pm.save(entry({ title: '  ' })), /название/);
  assert.throws(() => pm.save(entry({ title: 'x', groupId: 'нет-такой' })), /Папка не найдена/);
});

test('менеджер паролей: смена мастер-пароля перешифровывает записи', async () => {
  const { db, pm } = await store();
  await pm.setup(MASTER);
  const e = pm.save(entry({ title: 'VPN', password: 'vpn-Pass-3344' }));
  const before = db.pmRows('pm_entries')[0].blob;
  await assert.rejects(pm.changeMaster('не тот', 'New-Master-555'), /неверно/);
  await assert.rejects(pm.changeMaster(MASTER, 'short'), /не короче/);
  await pm.changeMaster(MASTER, 'New-Master-555');
  assert.notEqual(db.pmRows('pm_entries')[0].blob, before);
  pm.lock();
  await assert.rejects(pm.unlock(MASTER), /Неверный/);
  await pm.unlock('New-Master-555');
  assert.equal(pm.reveal(e.id), 'vpn-Pass-3344');
});

test('менеджер паролей: пауза после неверных паролей, автоблокировка, сброс', async () => {
  let t = 1_000_000;
  const { db, pm, locks } = await store({ now: () => t });
  await pm.setup(MASTER);
  pm.save(entry({ title: 'x', password: 'xxxxxxxx' }));
  pm.lock();
  for (let i = 0; i < 3; i++) await assert.rejects(pm.unlock('bad'), /Неверный/);
  assert.equal(pm.status().retryAfterSec, 1);
  await assert.rejects(pm.unlock(MASTER), /Подождите/);
  t += 1500;
  await pm.unlock(MASTER);

  pm.tick(10);
  assert.equal(pm.status().unlocked, true);
  t += 9 * 60_000;
  pm.touch();
  t += 9 * 60_000;
  pm.tick(10);
  assert.equal(pm.status().unlocked, true, 'действие продлевает время до блокировки');
  t += 2 * 60_000;
  pm.tick(10);
  assert.equal(pm.status().unlocked, false);
  assert.equal(pm.status().lockedReason, 'idle');
  assert.equal(locks.at(-1), 'idle');

  assert.throws(() => pm.reset('да'), /УДАЛИТЬ/);
  pm.reset('УДАЛИТЬ');
  assert.equal(pm.status().configured, false);
  assert.equal(db.pmCount(), 0);
  assert.equal(db.getMeta('pm_master'), undefined);
});

test('менеджер паролей: буфер обмена очищается по таймеру и при блокировке', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pm, clipboard } = await store();
  await pm.setup(MASTER);
  const e = pm.save(entry({ title: 'x', username: 'operator', password: 'Clip-Pass-777' }));
  assert.deepEqual(pm.copy(e.id, 'password', 20), { clearAfterSec: 20 });
  assert.equal(clipboard.readText(), 'Clip-Pass-777');
  t.mock.timers.tick(19_000);
  assert.equal(clipboard.readText(), 'Clip-Pass-777');
  t.mock.timers.tick(1_000);
  assert.equal(clipboard.readText(), '', 'через 20 с пароль удалён из буфера');

  // если пользователь скопировал что-то своё — буфер не трогаем
  pm.copy(e.id, 'password', 20);
  clipboard.writeText('мой текст');
  t.mock.timers.tick(20_000);
  assert.equal(clipboard.readText(), 'мой текст');

  // логин копируется без очистки; пароль удаляется при блокировке
  assert.deepEqual(pm.copy(e.id, 'username', 20), { clearAfterSec: 0 });
  pm.copy(e.id, 'password', 20);
  pm.lock();
  assert.equal(clipboard.readText(), '');
});

test('менеджер паролей: экспорт .nadpass и импорт с предпросмотром, дубликаты, папки', async () => {
  const dir = tmpDir();
  const src = await store();
  await src.pm.setup(MASTER);
  const g = src.pm.saveGroup({ name: 'Камеры' });
  src.pm.save(entry({ title: 'Камера 1', username: 'admin', password: 'Cam-Pass-1-xyz', url: 'http://192.0.2.51', notes: 'вход 2', groupId: g.id, favorite: true }));
  src.pm.save(entry({ title: 'Почта', username: 'it@example.org', password: 'Mail-Pass-9-abc' }));
  await assert.rejects(src.pm.exportNadpass('short'), /не короче 8/);
  const out = await src.pm.exportNadpass('Export-Pass-123');
  assert.equal(out.count, 2);
  const file = JSON.parse(out.content);
  assert.equal(file.format, PM_FILE_FORMAT);
  for (const s of ['Cam-Pass-1-xyz', 'Камера 1', 'it@example.org']) assert.ok(!out.content.includes(s), `в файле открытым текстом: ${s}`);
  const path = join(dir, 'passwords.nadpass');
  writeFileSync(path, out.content);

  const dst = await store();
  await dst.pm.setup('Other-Master-321');
  dst.pm.save(entry({ title: 'Почта', username: 'it@example.org', password: 'старый' }));
  const p1 = dst.pm.importOpen(path);
  assert.equal(p1.kind, 'nadpass');
  assert.equal(p1.needsPassword, true);
  assert.equal(p1.rows.length, 0, 'до ввода пароля файла записей не видно');
  await assert.rejects(dst.pm.importDecrypt(p1.token, 'wrong-password'), /Неверный пароль файла/);
  const p2 = await dst.pm.importDecrypt(p1.token, 'Export-Pass-123');
  assert.equal(p2.rows.length, 2);
  assert.deepEqual(p2.groups, ['Камеры']);
  const dup = p2.rows.find((r) => r.title === 'Почта')!;
  assert.equal(dup.duplicate, true);
  assert.equal((dup as unknown as Record<string, unknown>).password, undefined, 'предпросмотр без паролей');
  // выбрана только не повторяющаяся запись
  const r = dst.pm.importCommit(p2.token, { indexes: p2.rows.filter((x) => !x.duplicate).map((x) => x.index), groupMode: 'file', targetGroupId: null });
  assert.deepEqual(r, { added: 1, skipped: 1, groupsCreated: 1 });
  const cam = dst.pm.list().entries.find((x) => x.title === 'Камера 1')!;
  assert.equal(dst.pm.reveal(cam.id), 'Cam-Pass-1-xyz');
  assert.equal(cam.favorite, true);
  assert.equal(dst.pm.list().groups[0].name, 'Камеры');
  assert.throws(() => dst.pm.importCommit(p2.token, { indexes: [0], groupMode: 'file', targetGroupId: null }), /откройте файл заново/);
});

test('менеджер паролей: экспорт CSV только с мастер-паролем, импорт CSV разных программ', async () => {
  const dir = tmpDir();
  const { pm } = await store();
  await pm.setup(MASTER);
  const g = pm.saveGroup({ name: 'Сеть' });
  pm.save(entry({ title: 'Роутер, "главный"', username: 'admin', password: 'p,a"ss;word', notes: 'строка 1\nстрока 2', groupId: g.id }));
  await assert.rejects(pm.exportCsv('неверный'), /неверно/);
  const csv = await pm.exportCsv(MASTER);
  assert.ok(csv.content.startsWith('﻿"Group","Title","Username","Password","URL","Notes"'));
  const back = mapCsvRows(parseCsv(csv.content));
  assert.equal(back.rows[0].password, 'p,a"ss;word');
  assert.equal(back.rows[0].notes, 'строка 1\nстрока 2');
  assert.equal(back.rows[0].group, 'Сеть');
  assert.equal(back.rows[0].title, 'Роутер, "главный"');

  // KeePassXC: путь группы Root/…; Bitwarden; Chrome; KeePass; Firefox (без названия — берём адрес)
  const files: Record<string, string> = {
    keepassxc: '"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n"Root/Сеть/Коммутаторы","SW-1","admin","kx-pass-1","","","","0","2026-01-01","2026-01-01"\n',
    bitwarden: 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nСерверы,1,login,srv-1,,,0,https://srv.example.org,root,bw-pass-1,\n',
    chrome: 'name,url,username,password,note\nexample.org,https://example.org/login,user1,ch-pass-1,\n',
    keepass: '"Account","Login Name","Password","Web Site","Comments"\n"Почта","it","kp-pass-1","https://mail.example.org","заметка"\n',
    firefox: 'url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\nhttps://portal.example.org,ivan,ff-pass-1,,https://portal.example.org,{x},1,1,1\n',
    excelRu: 'Название;Логин;Пароль;Адрес;Заметки;Папка\nКамера 7;admin;xl-pass-1;http://192.0.2.7;;Камеры\n'
  };
  const expect: Record<string, { source: RegExp; title: string; password: string; group: string; favorite?: boolean }> = {
    keepassxc: { source: /KeePassXC/, title: 'SW-1', password: 'kx-pass-1', group: 'Сеть/Коммутаторы' },
    bitwarden: { source: /Bitwarden/, title: 'srv-1', password: 'bw-pass-1', group: 'Серверы', favorite: true },
    chrome: { source: /Chrome/, title: 'example.org', password: 'ch-pass-1', group: '' },
    keepass: { source: /^KeePass$/, title: 'Почта', password: 'kp-pass-1', group: '' },
    firefox: { source: /Firefox/, title: 'portal.example.org', password: 'ff-pass-1', group: '' },
    excelRu: { source: /CSV/, title: 'Камера 7', password: 'xl-pass-1', group: 'Камеры' }
  };
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, `${name}.csv`);
    writeFileSync(path, text);
    const prev = pm.importOpen(path);
    const exp = expect[name];
    assert.match(prev.source, exp.source, name);
    assert.equal(prev.rows[0].title, exp.title, name);
    assert.equal(prev.rows[0].group, exp.group, name);
    const res = pm.importCommit(prev.token, { indexes: [0], groupMode: 'file', targetGroupId: null });
    assert.equal(res.added, 1, name);
    const e = pm.list().entries.find((x) => x.title === exp.title)!;
    assert.equal(pm.reveal(e.id), exp.password, name);
    if (exp.favorite) assert.equal(e.favorite, true, name);
  }
  // всё в одну папку
  const p = pm.importOpen(join(dir, 'chrome.csv'));
  pm.importCommit(p.token, { indexes: [0], groupMode: 'target', targetGroupId: g.id });
  assert.equal(pm.list().entries.filter((x) => x.title === 'example.org' && x.groupId === g.id).length, 1);

  writeFileSync(join(dir, 'bad.csv'), 'a,b,c\n1,2,3\n');
  assert.throws(() => pm.importOpen(join(dir, 'bad.csv')), /не найден столбец с паролем/);
  writeFileSync(join(dir, 'other.json'), '{"format":"something"}');
  assert.throws(() => pm.importOpen(join(dir, 'other.json')), /не файл менеджера паролей/);
  assert.ok(readFileSync(join(dir, 'chrome.csv'), 'utf8').length > 0);
});

test('CSV: разбор кавычек, переводов строк, разделителя; запись с экранированием', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('"a,b";c;d'), ';', 'запятая в кавычках не считается');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.deepEqual(parseCsv('﻿a,"b ""q""","c\r\nd"\r\n1,,3\r\n\r\n'), [['a', 'b "q"', 'c\r\nd'], ['1', '', '3']]);
  const rows = [['x', 'a"b', 'c,d', 'e\nf']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('генератор паролей: длина, наборы символов, похожие символы, энтропия; оценка стойкости', () => {
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword({ length: 16, lower: true, upper: true, digits: true, symbols: true, excludeAmbiguous: true }, randomInt);
    assert.equal(pw.length, 16);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[0-9]/);
    assert.match(pw, /[^a-zA-Z0-9]/);
    assert.doesNotMatch(pw, /[Il1O0o|?"'`\\ ]/, pw);
  }
  assert.match(generatePassword({ length: 12, lower: false, upper: false, digits: true, symbols: false }, randomInt), /^[2-9]{12}$/);
  assert.equal(generatePassword({ length: 2 }, randomInt).length, 4, 'длина не меньше 4');
  assert.equal(generatePassword({ lower: false, upper: false, digits: false, symbols: false, length: 10 }, randomInt).length, 10, 'без наборов — строчные');
  assert.equal(generatorEntropy({ length: 20, lower: true, upper: true, digits: true, symbols: true, excludeAmbiguous: false }), Math.round(20 * Math.log2(26 + 26 + 10 + 26)));

  assert.equal(estimateStrength('').level, 0);
  assert.equal(estimateStrength('qwerty').level, 0);
  assert.equal(estimateStrength('Password1!').level, 0, 'распространённый пароль с цифрами в конце');
  assert.equal(estimateStrength('aaaaaaaa').level, 0);
  assert.ok(estimateStrength('Lk8#vQ2!pZ7&wR4m').level >= 3);
  assert.ok(estimateStrength('Тёплый-Вечер-2026').bits > estimateStrength('теплыйвечер').bits);
  assert.deepEqual(withPmDefaults({ autoLockMin: -5, clipboardClearSec: 9999 }), { ...DEFAULT_PM, autoLockMin: 0, clipboardClearSec: 600 });
});

test('менеджер паролей: блокировка во время долгих операций не теряет данные и не пишет пустые файлы', async () => {
  const dir = tmpDir();
  const { db, pm } = await store();
  await pm.setup(MASTER);
  const e = pm.save(entry({ title: 'Ядро', password: 'Core-Pass-0001' }));
  const metaBefore = db.getMeta('pm_master');
  const rowsBefore = JSON.stringify(db.pmRows('pm_entries'));

  // смена мастер-пароля, а пока вычисляется ключ — автоблокировка
  const change = pm.changeMaster(MASTER, 'Brand-New-Master-1');
  pm.lock('idle');
  await assert.rejects(change, /заблокирован/);
  assert.equal(db.getMeta('pm_master'), metaBefore, 'параметры ключа не изменились');
  assert.equal(JSON.stringify(db.pmRows('pm_entries')), rowsBefore, 'записи не перезаписаны');
  await pm.unlock(MASTER);
  assert.equal(pm.reveal(e.id), 'Core-Pass-0001', 'старый мастер-пароль по-прежнему открывает записи');

  // экспорт во время блокировки — ошибка, а не пустой файл
  const exp = pm.exportNadpass('Export-Pass-123');
  pm.lock('screen');
  await assert.rejects(exp, /заблокирован/);
  await pm.unlock(MASTER);
  const csv = pm.exportCsv(MASTER);
  pm.lock('screen');
  await assert.rejects(csv, /заблокирован/);

  // расшифровка импорта во время блокировки — понятная ошибка
  await pm.unlock(MASTER);
  const out = await pm.exportNadpass('Export-Pass-123');
  writeFileSync(join(dir, 'p.nadpass'), out.content);
  const prev = pm.importOpen(join(dir, 'p.nadpass'));
  const dec = pm.importDecrypt(prev.token, 'Export-Pass-123');
  pm.lock('idle');
  await assert.rejects(dec, /заблокирован|откройте файл заново/);

  // разблокировка, во время которой заблокировали экран, не открывает менеджер
  const un = pm.unlock(MASTER);
  pm.lock('screen');
  await assert.rejects(un, /прервана/);
  assert.equal(pm.isUnlocked(), false);
  // двойной вызов разблокировки — один ключ, без ошибок
  const [a, b] = await Promise.all([pm.unlock(MASTER), pm.unlock(MASTER)]);
  assert.ok(a.unlocked && b.unlocked);
  assert.equal(pm.reveal(e.id), 'Core-Pass-0001');
});

test('менеджер паролей: CSV из русского Excel (Windows-1251) импортируется без искажений', async () => {
  const dir = tmpDir();
  const { pm } = await store();
  await pm.setup(MASTER);
  // Кодирование в Windows-1251 вручную: А–я → 0xC0–0xFF, Ё → 0xA8, ё → 0xB8
  const cp1251 = (s: string) => Buffer.from([...s].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) return c;
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
    if (c === 0x401) return 0xa8;
    if (c === 0x451) return 0xb8;
    throw new Error('нет в cp1251: ' + ch);
  }));
  writeFileSync(join(dir, 'excel.csv'), cp1251('Название;Логин;Пароль;Адрес;Заметки;Папка\r\nКоммутатор ёлка;админ;пароль-1;192.0.2.9;Стойка 3;Сеть\r\n'));
  const p = pm.importOpen(join(dir, 'excel.csv'));
  assert.equal(p.rows[0].title, 'Коммутатор ёлка');
  assert.equal(p.rows[0].username, 'админ');
  assert.equal(p.rows[0].group, 'Сеть');
  pm.importCommit(p.token, { indexes: [0], groupMode: 'file', targetGroupId: null });
  const e = pm.list().entries[0];
  assert.equal(pm.reveal(e.id), 'пароль-1');
});
