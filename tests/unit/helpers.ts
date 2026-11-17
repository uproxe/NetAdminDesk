import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDriver } from '../../src/main/db/driver';
import { AppDatabase } from '../../src/main/db/database';

export const ROOT = join(__dirname, '..', '..');
export const USER_DIR = join(ROOT, 'data', 'user');
export const MAIN_TXT = readFileSync(join(USER_DIR, 'komandy-kommutatorov.txt'), 'utf8');
export const ACL_TXT = readFileSync(join(USER_DIR, 'acl-notes.txt'), 'utf8');

export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'nad-test-'));
}

export const DRIVER = (process.env.NAD_DB_DRIVER === 'sqljs' ? 'sqljs' : 'node') as 'sqljs' | 'node';

export async function freshDb(path = ':memory:'): Promise<AppDatabase> {
  const db = new AppDatabase(await openDriver(path, DRIVER));
  db.migrate();
  return db;
}
