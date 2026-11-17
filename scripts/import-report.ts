// Подробный отчёт разбора встроенных (обезличенных) TXT-заметок — тем же разборщиком, что и в приложении.
//   npm run import-report                       → docs/IMPORT_REPORT.md
//   npm run import-report -- --out report.md
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_FILES } from '../data/index';
import { decodeText, importTxt } from '../src/shared/txtImport';
import { categoryName } from '../src/shared/categories';
import { RISK_LABELS } from '../src/shared/risk';
import type { CommandInput, TxtParseReport, TxtReportIssue } from '../src/shared/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const outPath = outArg > 0 ? resolve(process.argv[outArg + 1]) : join(root, 'docs/IMPORT_REPORT.md');

const md: string[] = [];
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const code = (s: string) => (s ? `\`${s.replace(/`/g, "'").replace(/\n/g, '` <br> `')}\`` : '');

md.push('# Отчёт разбора встроенных TXT-заметок');
md.push('');
md.push('Отчёт сформирован скриптом `npm run import-report` тем же разборщиком, который приложение использует при первом запуске и при импорте через «Настройки → Импорт и экспорт».');
md.push('Исходный текст каждой записи сохраняется в приложении без изменений (поле «Исходный текст»); ниже — результат структурного разбора.');
md.push('');
md.push('Обозначения: **⚠** — «Требует проверки», **?** — производитель в файле не указан (раздел до `###SG300###` и т. п.), **🔒** — чувствительные данные (текст в отчёте скрыт).');
md.push('');

function issues(title: string, list: TxtReportIssue[], hide = false): void {
  md.push(`### ${title} (${list.length})`);
  md.push('');
  if (!list.length) {
    md.push('Нет.');
    md.push('');
    return;
  }
  md.push('| Строка | Текст | Причина |');
  md.push('|---:|---|---|');
  for (const i of list) md.push(`| ${i.line} | ${hide ? '(скрыто)' : code(i.text)} | ${esc(i.reason)} |`);
  md.push('');
}

function summary(r: TxtParseReport): void {
  md.push('| Показатель | Значение |');
  md.push('|---|---|');
  md.push(`| SHA-256 | \`${r.sha256}\` |`);
  md.push(`| Кодировка | ${r.encoding} |`);
  md.push(`| Строк всего / непустых | ${r.totalLines} / ${r.nonEmptyLines} |`);
  md.push(`| Записей | ${r.entries} (команд: ${r.byType.command}, последовательностей: ${r.byType.sequence}, заметок: ${r.byType.note}) |`);
  md.push(`| Строк команд / примеров вывода / заголовков / заметок | ${r.commandLines} / ${r.outputLines} / ${r.headingLines} / ${r.noteLines} |`);
  md.push(`| Разделы производителей | ${r.headers.map((h) => `стр. ${h.line}: \`${h.text}\` → ${h.vendorLabel}`).join('<br>') || '—'} |`);
  md.push(`| Записей по производителям | ${Object.entries(r.byPlatform).map(([k, n]) => `${k}: ${n}`).join(', ')} |`);
  md.push(`| Производитель не указан | ${r.vendorUnknown} |`);
  md.push(`| Без описания | ${r.noDescription} |`);
  md.push(`| Требует проверки | ${r.needsReview.length} |`);
  md.push(`| Чувствительные данные | ${r.sensitive.length} |`);
  md.push(`| Пропущено | ${r.skipped.length} |`);
  md.push(`| Ошибки разбора | ${r.errors.length} |`);
  md.push(`| Нераспознанные строки | ${r.unaccounted.length ? r.unaccounted.join(', ') : 'нет — каждая непустая строка вошла в запись'} |`);
  md.push('');
}

function entries(recs: CommandInput[]): void {
  md.push('| Строка | Запись | Команда (как в файле) | Производитель | Категория | Риск | Пометки |');
  md.push('|---:|---|---|---|---|---|---|');
  for (const c of recs) {
    const flags = [c.needsReview ? '⚠' : '', c.vendorUnknown ? '?' : '', c.sensitive ? '🔒' : '', c.entryType === 'sequence' ? 'последовательность' : c.entryType === 'note' ? 'заметка' : ''].filter(Boolean).join(' ');
    const cmd = c.sensitive ? '(скрыто)' : code(c.command);
    md.push(`| ${c.originLine ?? ''} | ${esc(c.sensitive ? 'Запись с учётными данными' : c.title)} | ${cmd} | ${esc(c.vendorLabel)} | ${esc(categoryName(c.kind, c.category))} | ${RISK_LABELS[c.risk]} | ${flags} |`);
  }
  md.push('');
}

let totalEntries = 0;
let totalUnaccounted = 0;
for (const f of SEED_FILES) {
  const bytes = readFileSync(join(root, 'data/user', f.file));
  const { text, encoding } = decodeText(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { records, report } = importTxt(text, { fileLabel: f.label, sourceKey: f.key, source: f.source }, { sha256, encoding });
  totalEntries += report.entries;
  totalUnaccounted += report.unaccounted.length;
  md.push(`## ${f.label}`);
  md.push('');
  md.push(`Файл в проекте: \`data/user/${f.file}\`. Источник записей в приложении: «${f.source === 'user_txt' ? 'Из моего TXT-файла' : 'Импортировано из файла'}».`);
  md.push('');
  summary(report);
  issues('Требует проверки', report.needsReview);
  issues('Чувствительные данные', report.sensitive, true);
  issues('Пропущено', report.skipped);
  issues('Ошибки разбора', report.errors);
  md.push(`### Все записи (${records.length})`);
  md.push('');
  entries(records);
}

md.splice(7, 0, `**Итого:** записей — ${totalEntries}, нераспознанных строк — ${totalUnaccounted}.`, '');
writeFileSync(outPath, md.join('\n'));
console.log(`Отчёт: ${outPath} (записей: ${totalEntries}, нераспознанных строк: ${totalUnaccounted})`);
