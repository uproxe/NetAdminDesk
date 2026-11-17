// Проверка встроенных данных: уникальность, категории, параметры шаблонов, ссылки руководств.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_COMMANDS, BUILTIN_SCENARIOS, GUIDES, builtinProfiles, SWITCH_TASKS } from '../../data/index';
import { LINUX_CATEGORIES, SQL_CATEGORIES, SWITCH_CATEGORIES } from '../../src/shared/categories';
import { BUILTIN_PARAMS, parseTemplate } from '../../src/shared/templates';
import { LINUX_CHECKS, LINUX_TASKS } from '../../src/shared/linuxDiag';
import { PLATFORMS } from '../../src/shared/platforms';
import { splitRow } from '../../src/shared/guideText';

const KNOWN = new Set(BUILTIN_PARAMS.map((p) => p.name));
const params = (t: string) => [...t.matchAll(/\{\{([A-Z_]+)(?::[^}]*)?\}\}/g)].map((m) => m[1]);

test('встроенные команды: уникальны, заполнены, категории существуют', () => {
  const uids = new Set<string>();
  const cats = { switch: new Set(SWITCH_CATEGORIES.map((c) => c.id)), linux: new Set(LINUX_CATEGORIES.map((c) => c.id)), sql: new Set(SQL_CATEGORIES.map((c) => c.id)) };
  for (const c of BUILTIN_COMMANDS) {
    assert.ok(!uids.has(c.uid), `повтор uid ${c.uid}`);
    uids.add(c.uid);
    assert.ok(c.title.trim() && c.command.trim() && c.description.trim(), `пустые поля: ${c.uid}`);
    assert.ok(cats[c.kind].has(c.category), `неизвестная категория ${c.category} у ${c.uid}`);
    for (const p of params(c.template ?? '')) assert.ok(KNOWN.has(p), `неизвестный параметр {{${p}}} в ${c.uid}`);
    if (c.template) assert.ok(!/\{\{/.test(c.command), `пример команды должен быть без {{…}}: ${c.uid}`);
  }
  assert.ok(BUILTIN_COMMANDS.filter((c) => c.kind === 'linux').length >= 400);
  assert.ok(BUILTIN_COMMANDS.filter((c) => c.kind === 'switch').length >= 250);
  assert.ok(BUILTIN_COMMANDS.filter((c) => c.tags.includes('основы')).length >= 200);
});

test('сценарии: не меньше 130, шаги заполнены, параметры известны', () => {
  assert.ok(BUILTIN_SCENARIOS.length >= 130, `сценариев ${BUILTIN_SCENARIOS.length}`);
  const uids = new Set<string>();
  for (const s of BUILTIN_SCENARIOS) {
    assert.ok(!uids.has(s.uid), `повтор ${s.uid}`);
    uids.add(s.uid);
    assert.ok(s.steps.length > 0 && s.platforms.length > 0, s.uid);
    for (const st of s.steps) {
      assert.ok(st.command.trim(), `${s.uid}: пустой шаг`);
      for (const p of params(st.command)) assert.ok(KNOWN.has(p), `${s.uid}: неизвестный параметр {{${p}}}`);
      assert.ok(Array.isArray(parseTemplate(st.command)));
    }
  }
});

test('руководства: ссылки ведут на существующие руководства, блоки кода закрыты', () => {
  const ids = new Set(GUIDES.map((g) => g.id));
  assert.equal(ids.size, GUIDES.length);
  assert.ok(GUIDES.length >= 40);
  for (const g of GUIDES) {
    for (const m of g.body.matchAll(/\[\[([a-z0-9-]+)/g)) assert.ok(ids.has(m[1]), `${g.id}: ссылка на ${m[1]}`);
    assert.equal((g.body.match(/^```/gm) ?? []).length % 2, 0, `${g.id}: незакрытый блок кода`);
  }
});

test('диагностика: задачи ссылаются на существующие проверки и профили', () => {
  const checks = new Set(LINUX_CHECKS.map((c) => c.id));
  assert.ok(LINUX_CHECKS.length >= 27);
  for (const t of LINUX_TASKS) for (const c of t.checks) assert.ok(checks.has(c), `${t.id}: ${c}`);
  const tasks = new Set(SWITCH_TASKS.map((t) => t.id));
  assert.ok(SWITCH_TASKS.length >= 26);
  for (const p of builtinProfiles()) assert.ok(tasks.has(p.task), p.task);
});

test('проект обезличен: нет адресов, имён и названий конкретной организации', () => {
  const { readFileSync, readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const { join, extname } = require('node:path') as typeof import('node:path');
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const root = join(__dirname, '..', '..');
  // Запрещённые слова хранятся только в виде хешей, чтобы сами названия не попадали в исходники.
  // [хеш, true — слово может быть началом более длинного слова]
  const FORBIDDEN = new Map<string, boolean>([
    ['e46c1b38e3d285c1', true],
    ['e98e67dc838af084', true],
    ['72e59f3efc6d98fb', true],
    ['fb55f1bf79244cff', true],
    ['5352cf4c46dbf149', true],
    ['a9579bc5b0d500d8', false],
    ['4a103dcc05d06d6d', true],
    ['a5d7995d4d4f294e', true],
    ['854d0b110e978f9a', true],
    ['0534b11acad2c1e2', true],
    ['fc494a50d6551392', true],
    ['d07819ff4deeeb04', false],
    ['bbed73be9d12d2b5', true],
    ['051f507791313ca5', false],
    ['b88683543057c42e', false],
    ['c8128ec3d92c7807', true],
    ['19e0730457bccff6', true]
  ]);
  const h = (s: string) => createHash('sha256').update('nad-anon:' + s).digest('hex').slice(0, 16);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return f === 'node_modules' || f.startsWith('dist') || f === 'screenshots' ? [] : walk(p);
      return ['.ts', '.tsx', '.txt', '.md', '.mjs', '.json', '.yml', '.css', '.html'].includes(extname(f)) ? [p] : [];
    });
  const files = [...['data', 'src', 'docs', 'tests', 'tools', 'scripts'].flatMap((d) => walk(join(root, d))), join(root, 'README.md'), join(root, 'CHANGELOG.md')];
  assert.ok(files.length > 50);
  for (const f of files) {
    const text = readFileSync(f, 'utf8').toLowerCase();
    const tokens = new Set<string>();
    for (const t of text.match(/[a-zа-яё0-9]+(?:-[a-zа-яё0-9]+)*/g) ?? []) {
      tokens.add(t);
      for (const part of t.split('-')) tokens.add(part);
    }
    for (const m of text.matchAll(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g)) tokens.add(`ip:${m[1]}.${m[2]}`);
    for (const t of tokens) {
      if (FORBIDDEN.has(h(t))) assert.fail(`${f}: найдено запрещённое слово «${t}»`);
      for (let k = 3; k < Math.min(t.length, 12); k++) if (FORBIDDEN.get(h(t.slice(0, k)))) assert.fail(`${f}: найдено запрещённое слово «${t}»`);
    }
  }
});

test('руководства: платформы блоков кода известны, у таблиц одинаковое число столбцов', () => {
  for (const g of GUIDES) {
    for (const m of g.body.matchAll(/^```(\S*)/gm)) if (m[1]) assert.ok(PLATFORMS.some((p) => p.id === m[1]), `${g.id}: платформа ${m[1]}`);
    const tables = g.body.split(/\n(?!\|)/).map((b) => b.split('\n').filter((l) => l.startsWith('|'))).filter((t) => t.length);
    for (const t of tables) {
      const n = splitRow(t[0]).length;
      for (const row of t) assert.equal(splitRow(row).length, n, `${g.id}: ${row}`);
    }
  }
  assert.deepEqual(splitRow('| порт занят | `ss -tlnp | grep 3306` | x |'), ['порт занят', '`ss -tlnp | grep 3306`', 'x']);
  assert.ok(GUIDES.filter((g) => g.section === 'db').length >= 8);
});
