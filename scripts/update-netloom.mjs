#!/usr/bin/env node
// Обновляет версию браузера NetLoom, которую предлагает установщик NetAdmin Desk для Windows.
//
//   node scripts/update-netloom.mjs 1.0.4
//
// Скачивает установщик NetLoom этой версии из релиза GitHub, считает SHA-256 и размер
// и переписывает build/netloom.nsh. Файл установщика никуда не сохраняется.
// После этого проверьте изменения (git diff build/netloom.nsh) и закоммитьте их.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Укажите версию NetLoom, например: node scripts/update-netloom.mjs 1.0.4');
  process.exit(1);
}

const file = `NetLoom-${version}-windows-x64-setup.exe`;
const url = `https://github.com/uproxe/NetLoom/releases/download/v${version}/${file}`;
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'netloom.nsh');

console.log(`Скачиваю ${url}`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok || !res.body) {
  console.error(`Не удалось скачать: HTTP ${res.status}. Есть ли в релизе v${version} файл ${file}?`);
  process.exit(1);
}
const hash = createHash('sha256');
let bytes = 0;
for await (const chunk of res.body) {
  hash.update(chunk);
  bytes += chunk.length;
}
const sha256 = hash.digest('hex');
const sizeMb = Math.round(bytes / 1048576);

const text = readFileSync(target, 'utf8');
const set = (src, name, value) => {
  const re = new RegExp(`^(!define ${name} )"[^"]*"`, 'm');
  if (!re.test(src)) throw new Error(`В build/netloom.nsh нет строки !define ${name}`);
  return src.replace(re, `$1"${value}"`);
};
let out = text;
out = set(out, 'NETLOOM_VERSION', version);
out = set(out, 'NETLOOM_URL', url);
out = set(out, 'NETLOOM_SHA256', sha256);
out = set(out, 'NETLOOM_BYTES', String(bytes));
out = set(out, 'NETLOOM_SIZE_MB', String(sizeMb));
writeFileSync(target, out, 'utf8');

console.log(`NetLoom ${version}: ${bytes} байт (~${sizeMb} МБ), SHA-256 ${sha256}`);
console.log('build/netloom.nsh обновлён.');
