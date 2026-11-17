import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchIndex, layoutSwap, type SearchDoc } from '../../src/shared/search';
import { BUILTIN_COMMANDS } from '../../data/index';
import { importTxt } from '../../src/shared/txtImport';
import { MAIN_TXT } from './helpers';

const recs = [...BUILTIN_COMMANDS, ...importTxt(MAIN_TXT, { fileLabel: 'x', sourceKey: 'x', source: 'user_txt' }).records];
const docs: SearchDoc[] = recs.map((c, i) => ({
  id: String(i),
  group: c.kind,
  title: c.title,
  fields: [
    { text: c.title, weight: 3 },
    { text: c.command, weight: 3 },
    { text: c.description, weight: 1.5 },
    { text: c.tags.join(' '), weight: 2 }
  ],
  facets: { platform: c.platform, category: c.category, risk: c.risk, source: c.source, sensitive: c.sensitive },
  ref: c
}));
const idx = new SearchIndex(docs);

test('поиск по русским синонимам', () => {
  const hits = idx.search('мак порт', {}, 20);
  assert.ok(hits.length > 0);
  assert.ok(hits.slice(0, 10).some((h) => /mac|fdb|address-table/.test((h.doc.ref as { command: string }).command)));
});

test('набор в неверной раскладке', () => {
  assert.equal(layoutSwap('ырщц'), 'show');
  const hits = idx.search('ырщц мдфт', {}, 10);
  assert.ok(hits.some((h) => /show vlan/.test((h.doc.ref as { command: string }).command)));
});

test('фильтры по группе и платформе', () => {
  const hits = idx.search('журнал', { groups: ['linux'] }, 50);
  assert.ok(hits.length > 0 && hits.every((h) => h.doc.group === 'linux'));
  const osnovo = idx.search('', { platform: 'osnovo' }, 500);
  assert.ok(osnovo.length >= 10 && osnovo.every((h) => h.doc.facets.platform === 'osnovo'));
});

test('чувствительные записи скрыты по умолчанию', () => {
  assert.equal(idx.search('Telesis пароль', {}, 50).filter((h) => h.doc.facets.sensitive).length, 0);
  assert.ok(idx.search('Telesis пароль', { includeSensitive: true }, 50).some((h) => h.doc.facets.sensitive));
});

test('поиск быстрый', () => {
  const t = performance.now();
  for (let i = 0; i < 50; i++) idx.search('проверка дисков');
  const per = (performance.now() - t) / 50;
  assert.ok(per < 30, `слишком медленно: ${per.toFixed(1)} мс`);
});

test('русские словоформы и частичные совпадения', () => {
  const hits = idx.search('мак таблица', {}, 40);
  // Полные совпадения есть, а ниже них — записи вашего TXT с mac address-table
  assert.ok(hits.length > 3, `найдено только ${hits.length}`);
  assert.ok(hits.some((h) => (h.doc.ref as { source: string }).source === 'user_txt' && /mac/.test((h.doc.ref as { command: string }).command)));
  const forms = idx.search('таблицу', {}, 40).length;
  assert.ok(forms > 0);
});

test('морфология: основы слов, звучание, опечатки', async () => {
  const { stemRussian, cyrKey, latinKeys, editDistance } = await import('../../src/shared/morph');
  for (const [a, b] of [['таблица', 'таблицу'], ['диска', 'дисков'], ['порта', 'портов'], ['пользователя', 'пользователей'], ['службы', 'службу']])
    assert.equal(stemRussian(a), stemRussian(b), `${a} / ${b}`);
  assert.equal(cyrKey('докер'), latinKeys('docker')[0]);
  assert.ok(latinKeys('apache')[0].startsWith(cyrKey('апач')));
  assert.equal(editDistance('interfase', 'interface', 1), 1);
  assert.equal(editDistance('abc', 'xyz', 1), 2);
});

test('русское название программы находит английскую команду', () => {
  const top = (q: string) => idx.search(q, {}, 5).filter((h) => !h.partial).map((h) => (h.doc.ref as { command: string }).command);
  assert.ok(top('апач').some((c) => /apache/.test(c)), 'апач → apache');
  assert.ok(top('докер').some((c) => /docker/.test(c)), 'докер → docker');
  assert.ok(top('курл').some((c) => /curl/.test(c)), 'курл → curl');
  assert.ok(top('постгрес').some((c) => /postgres|psql|pg_/.test(c)), 'постгрес → postgresql');
  assert.match(top('перезапустить апач')[0] ?? '', /restart apache2/);
});

test('вопрос обычными словами и опечатки', () => {
  const first = (q: string) => (idx.search(q, {}, 3)[0]?.doc.ref as { command: string } | undefined)?.command ?? '';
  assert.match(first('как перезагрузить сервер'), /reboot/);
  assert.match(first('как удалить папку'), /rm -r/);
  assert.ok(idx.search('ошибкии портов', {}, 10).some((h) => /counter|error|statistics/i.test((h.doc.ref as { command: string }).command)));
  assert.ok(idx.search('interfase status', {}, 5).some((h) => /interfaces? status/.test((h.doc.ref as { command: string }).command)));
  // частичные совпадения помечаются
  const hits = idx.search('мак абракадабра', {}, 20);
  assert.ok(hits.length && hits.every((h) => h.partial));
});
