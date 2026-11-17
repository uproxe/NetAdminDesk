import test from 'node:test';
import assert from 'node:assert/strict';
import { importTxt, parseTxt, splitDescription, decodeText } from '../../src/shared/txtImport';
import { MAIN_TXT, ACL_TXT } from './helpers';

const OPTS = { fileLabel: 'Команды комутаторов.txt', sourceKey: 'txt-main', source: 'user_txt' as const };

test('основной TXT: каждая непустая строка учтена, ошибок разбора нет', () => {
  const { report } = parseTxt(MAIN_TXT, OPTS);
  assert.deepEqual(report.unaccounted, []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.skipped, []);
  const nonEmpty = MAIN_TXT.split(/\r?\n/).filter((l) => l.trim()).length;
  assert.equal(report.nonEmptyLines, nonEmpty);
  assert.equal(report.commandLines + report.outputLines + report.headingLines + report.noteLines + report.headers.length, nonEmpty);
});

test('основной TXT: заголовки разделов распознаны как производители', () => {
  const { report } = parseTxt(MAIN_TXT, OPTS);
  assert.deepEqual(
    report.headers.map((h) => h.platform),
    ['cisco-sg300', 'hp-procurve', 'linksys', 'at-8000s', 'alliedware', 'qtech', 'osnovo', 'tplink']
  );
});

test('основной TXT: раздел до ###SG300### помечен как «производитель не указан»', () => {
  const { records } = importTxt(MAIN_TXT, OPTS);
  const first = records.filter((r) => (r.originLine ?? 0) < 160);
  assert.ok(first.length > 50);
  assert.ok(first.every((r) => r.platform === 'unknown-ios' && r.vendorUnknown));
});

test('исходный текст сохраняется дословно', () => {
  const lines = MAIN_TXT.replace(/\r\n?/g, '\n').split('\n');
  const { records } = importTxt(MAIN_TXT, OPTS);
  for (const r of records) {
    assert.ok(r.rawText, `нет rawText у L${r.originLine}`);
    const start = r.originLine! - 1;
    assert.equal(lines.slice(start, start + r.rawText!.split('\n').length).join('\n'), r.rawText);
  }
});

test('синтаксис команд не изменяется (опечатки сохранены и помечены)', () => {
  const { records } = importTxt(MAIN_TXT, OPTS);
  const typo = records.find((r) => r.command === 'show int counerts');
  assert.ok(typo, 'команда с опечаткой должна сохраниться как есть');
  assert.ok(typo!.needsReview && /counters/.test(typo!.reviewNote ?? ''));
  const bang = records.find((r) => r.originLine === 1)!;
  assert.equal(bang.command, 'conf t');
  assert.ok(bang.needsReview);
  assert.equal(bang.rawText, '!!!! conf t');
});

test('многострочные конфигурации и примеры вывода', () => {
  const { records } = importTxt(MAIN_TXT, OPTS);
  const runIf = records.find((r) => r.originLine === 79)!;
  assert.equal(runIf.command, 'show running-config interface vlan 100');
  assert.equal(runIf.details.exampleOutput!.split('\n').length, 6);
  const og = records.find((r) => r.originLine === 109)!;
  assert.equal(og.entryType, 'sequence');
  assert.equal(og.command.split('\n').length, 4);
  assert.equal(og.template!.split('\n')[1], 'host {{IP}}');
  const sntp = records.find((r) => r.originLine === 148)!;
  assert.equal(sntp.entryType, 'sequence');
  assert.ok(/Установка синхронизации времени/.test(sntp.title));
  const osnovoSntp = records.find((r) => r.platform === 'osnovo' && r.title === 'Синхронизация времени')!;
  assert.equal(osnovoSntp.command.split('\n').length, 4);
  const telesisSh = records.find((r) => r.platform === 'alliedware' && r.command === 'sh config')!;
  assert.equal(telesisSh.details.exampleOutput!.split('\n').length, 2);
});

test('чувствительные данные помечены', () => {
  const { records, report } = importTxt(MAIN_TXT, OPTS);
  const note = records.find((r) => r.entryType === 'note' && /Telesis/.test(r.description))!;
  assert.ok(note.sensitive);
  assert.equal(report.sensitive.length, 1);
  const placeholder = records.find((r) => r.command.startsWith('username ИМЯ'))!;
  assert.equal(placeholder.sensitive, false);
  assert.equal(placeholder.template, 'username {{USERNAME}} password {{PASSWORD}} privilege');
});

test('второй файл: производитель из текста заметки, процедуры и плейсхолдеры', () => {
  const opts = { fileLabel: 'acl', sourceKey: 'txt-acl', source: 'imported' as const };
  const { records, report } = importTxt(ACL_TXT, opts);
  assert.deepEqual(report.unaccounted, []);
  assert.equal(records.find((r) => r.command === 'show bridge fdb interface ge1/5')!.platform, 'osnovo');
  assert.equal(records.find((r) => r.command === 'show mac address-table interface fa1')!.platform, 'cisco-ios');
  const proc = records.find((r) => r.command.startsWith('conf t\nobject-group'))!;
  assert.equal(proc.command.split('\n').length, 10);
  assert.ok(/делаем так/.test(proc.title));
  assert.ok(proc.needsReview && /whrite/.test(proc.reviewNote!));
  const embedded = records.find((r) => r.command === 'show interfaces status')!;
  assert.equal(embedded.description, 'посмотреть статус портов');
});

test('разделение команды и пояснения', () => {
  assert.deepEqual(splitDescription('show env all - просмотр параметров'), { command: 'show env all', note: 'просмотр параметров', emptyDash: false });
  assert.equal(splitDescription('macro auto disabled отключить макросы').command, 'macro auto disabled');
  assert.equal(splitDescription('no (номер строки) для удаления').command, 'no (номер строки)');
  assert.equal(splitDescription('interface d12 name -=CAM;10.0.0.1=- - подписать').command, 'interface d12 name -=CAM;10.0.0.1=-');
  assert.equal(splitDescription('show running-config interface vlan 408 - ').emptyDash, true);
  assert.equal(splitDescription('640 permit ip any (ip маска - если надо)').command, '640 permit ip any');
});

test('декодирование Windows-1251', () => {
  const bytes = Buffer.from([0xef, 0xf0, 0xee, 0xf1, 0xec, 0xee, 0xf2, 0xf0]); // «просмотр» в cp1251
  const r = decodeText(bytes);
  assert.equal(r.encoding, 'Windows-1251');
  assert.equal(r.text, 'просмотр');
});
