// Первичное наполнение базы: встроенные справочники, сценарии и импорт TXT-заметок.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDatabase, UpsertResult } from './db/database';
import { BUILTIN_COMMANDS, BUILTIN_SCENARIOS, SEED_FILES, SEED_VERSION } from '../../data/index';
import { decodeText, importTxt, type TxtImportOptions } from '../shared/txtImport';
import type { CommandInput, CommandRecord, ImportPreviewItem, TxtParseReport } from '../shared/types';
import { sha256Hex } from './crypto';
import { isKnownPlatform } from '../shared/platforms';

export interface SeedResult {
  builtin: Record<UpsertResult['action'], number>;
  reports: TxtParseReport[];
}

function count(): Record<UpsertResult['action'], number> {
  return { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
}

export function seedDatabase(db: AppDatabase, userFilesDir: string): SeedResult {
  const result: SeedResult = { builtin: count(), reports: [] };
  const seedVer = Number(db.getMeta('seed_version') ?? 0);
  if (seedVer < SEED_VERSION) {
    db.tx(() => {
      for (const c of BUILTIN_COMMANDS) result.builtin[db.upsertSeedCommand(c).action]++;
      for (const s of BUILTIN_SCENARIOS) db.upsertSeedScenario(s);
      db.setMeta('seed_version', String(SEED_VERSION));
    });
  }
  for (const f of SEED_FILES) {
    const path = join(userFilesDir, f.file);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    const sha = sha256Hex(bytes);
    if (db.getMeta(`seedfile:${f.key}`) === sha) continue;
    const report = importTxtBytes(db, bytes, { fileLabel: f.label, sourceKey: f.key, source: f.source }, { skipDuplicates: false, prunePrefix: `${f.key}:` });
    db.setMeta(`seedfile:${f.key}`, sha);
    result.reports.push(report);
  }
  db.flush();
  return result;
}

function sameCommand(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return n(a) === n(b);
}

/** Поиск дубликатов: та же команда для той же платформы среди существующих записей. */
export function findDuplicate(list: CommandRecord[], rec: CommandInput): string | undefined {
  if (!rec.command) return undefined;
  const existing = list.find((c) => c.uid !== rec.uid && c.platform === rec.platform && sameCommand(c.command, rec.command));
  return existing ? `${existing.title} (${existing.source === 'builtin' ? 'встроенный справочник' : existing.originFile ?? 'добавлено пользователем'})` : undefined;
}

export function previewTxtBytes(db: AppDatabase, bytes: Uint8Array, opts: TxtImportOptions): { report: TxtParseReport; items: ImportPreviewItem[] } {
  const { text, encoding } = decodeText(bytes);
  const { records, report } = importTxt(text, opts, { sha256: sha256Hex(Buffer.from(bytes)), encoding });
  const existing = db.listCommands();
  const items: ImportPreviewItem[] = records.map((r) => ({
    title: r.title,
    command: r.command,
    platform: r.platform,
    vendorLabel: r.vendorLabel,
    category: r.category,
    entryType: r.entryType,
    startLine: r.originLine ?? 0,
    flags: [
      ...(r.needsReview ? ['Требует проверки'] : []),
      ...(r.vendorUnknown ? ['Производитель не указан'] : []),
      ...(r.sensitive ? ['Чувствительные данные'] : [])
    ],
    duplicateOf: findDuplicate(existing, r)
  }));
  return { report, items };
}

export function importTxtBytes(db: AppDatabase, bytes: Uint8Array, opts: TxtImportOptions, o: { skipDuplicates: boolean; prunePrefix?: string }): TxtParseReport {
  const { text, encoding } = decodeText(bytes);
  const { records, report } = importTxt(text, opts, { sha256: sha256Hex(Buffer.from(bytes)), encoding });
  let imported = 0;
  let updated = 0;
  let unchanged = 0;
  const existing = db.listCommands();
  db.tx(() => {
    for (const h of report.headers) if (!isKnownPlatform(h.platform)) db.saveCustomPlatform(h.platform, h.vendorLabel);
    for (const r of records) {
      if (o.skipDuplicates && findDuplicate(existing, r)) {
        report.skipped.push({ line: r.originLine ?? 0, text: r.command.split('\n')[0], reason: 'дубликат существующей записи (пропущено по выбору пользователя)' });
        continue;
      }
      const res = db.upsertSeedCommand(r);
      if (res.action === 'inserted') imported++;
      else if (res.action === 'updated') updated++;
      else unchanged++;
    }
    // Новая версия встроенного файла заменяет старую целиком: записи, которых в ней нет, удаляются.
    if (o.prunePrefix) db.pruneSeedCommands(o.prunePrefix, new Set(records.map((r) => r.uid)));
  });
  report.imported = imported;
  report.updated = updated;
  report.unchanged = unchanged;
  db.addImportReport(opts.fileLabel, report);
  return report;
}
