import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p));

test('установщик Windows: закреплённая версия NetLoom описана без ошибок', () => {
  const text = read('build/netloom.nsh').toString('utf8');
  const def = (name: string) => {
    const m = text.match(new RegExp(`^!define ${name} "([^"]*)"`, 'm'));
    assert.ok(m, `нет !define ${name}`);
    return m[1];
  };
  const version = def('NETLOOM_VERSION');
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(
    def('NETLOOM_URL'),
    `https://github.com/uproxe/NetLoom/releases/download/v${version}/NetLoom-${version}-windows-x64-setup.exe`,
    'адрес должен указывать на установщик этой же версии в релизах NetLoom'
  );
  assert.match(def('NETLOOM_SHA256'), /^[0-9a-f]{64}$/);
  const bytes = Number(def('NETLOOM_BYTES'));
  assert.ok(Number.isInteger(bytes) && bytes > 1_000_000, 'размер файла в байтах');
  assert.equal(Number(def('NETLOOM_SIZE_MB')), Math.round(bytes / 1048576), 'размер в МБ для текста на странице');
});

test('установщик Windows: файлы с русским текстом сохранены в UTF-8 с BOM', () => {
  // NSIS и Windows PowerShell 5.1 читают файлы без BOM в кодировке системы — русский текст исказится
  for (const f of ['build/installer.nsh', 'build/netloom.nsh', 'build/netloom-install.ps1']) {
    const b = read(f);
    assert.deepEqual([...b.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${f}: нет BOM`);
  }
});

test('установщик Windows: NetLoom по умолчанию не ставится, предупреждение про интернет есть', () => {
  const nsh = read('build/installer.nsh').toString('utf8');
  assert.match(nsh, /^!ifndef BUILD_UNINSTALLER$/m, 'в деинсталлятор дополнения не попадают');
  assert.match(nsh, /StrCpy \$NetLoomWanted 0/, 'по умолчанию галочка снята');
  assert.match(nsh, /\$\{If\} \$NetLoomWanted == 1\s+\$\{NSD_Check\}/, 'галочка ставится только по ключу /NETLOOM=1');
  assert.match(nsh, /Понадобится интернет/);
  assert.match(nsh, /-Sha256 "\$\{NETLOOM_SHA256\}"/, 'загрузка проверяется по контрольной сумме');
  assert.match(nsh, /AtLeastWin10/, 'на старых Windows установщик сразу объясняет, почему нельзя');
});

test('пакеты Linux: deb, rpm, pacman и AppImage', () => {
  const yml = read('electron-builder.yml').toString('utf8');
  const linux = yml.slice(yml.indexOf('\nlinux:'), yml.indexOf('\ndeb:'));
  for (const t of ['deb', 'rpm', 'pacman', 'AppImage']) assert.match(linux, new RegExp(`- target: ${t}\\b`), `нет цели ${t}`);
  for (const s of ['rpm:', 'pacman:']) assert.ok(yml.includes(`\n${s}`), `нет раздела ${s} с зависимостями`);
});
