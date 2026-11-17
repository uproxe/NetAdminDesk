// Резервные копии конфигураций коммутаторов и файлов Linux-серверов, сравнение версий.
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDatabase } from './db/database';
import type { SessionManager } from './ssh/manager';
import type { BackupRecord } from '../shared/types';
import { getPlatform } from '../shared/platforms';
import { diffLines, diffStats, toHunks, VOLATILE_CONFIG_LINES } from '../shared/diff';
import { atomicWrite } from './db/driver';
import { sha256Hex } from './crypto';
import { sftpDownloadTree } from './ssh/extras';

export function safeName(s: string): string {
  return s.replace(/[^\w.\-а-яё]+/gi, '_').replace(/^_+|_+$/g, '') || 'device';
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export class BackupService {
  constructor(private db: AppDatabase, private sessions: SessionManager, private dir: string) {}

  /** Получение текущей конфигурации коммутатора командой платформы (видимо в терминале). */
  async fetchSwitchConfig(sessionId: string, opts: { command?: string; comment?: string } = {}): Promise<BackupRecord> {
    const device = this.sessions.device(sessionId);
    const platform = getPlatform(device.platform);
    if (platform.kind === 'linux') throw new Error('Для Linux-серверов используйте резервное копирование файлов через SFTP.');
    const command = opts.command?.trim() || platform.configCommand;
    if (!command) throw new Error(`Для платформы «${platform.name}» не задана команда получения конфигурации. Укажите её вручную.`);
    for (const c of platform.pagerOff) await this.sessions.capture(sessionId, c, { timeoutMs: 6000, idleMs: 800 }, { source: 'backup', risk: 'info' });
    const r = await this.sessions.capture(sessionId, command, { timeoutMs: 180000, idleMs: 5000, autoPager: true }, { source: 'backup', risk: 'info', note: 'резервная копия конфигурации' });
    const output = r.output.trim();
    if (!output) throw new Error('Команда не вернула конфигурацию (пустой вывод).');
    if (output.split('\n').length < 3 && /invalid|unknown|error|ошибк|incomplete/i.test(output)) {
      throw new Error(`Устройство вернуло ошибку вместо конфигурации: ${output}`);
    }
    const content = `${output}\n`;
    const sha = sha256Hex(content);
    const prev = this.db.listBackups(device.id).find((b) => b.kind === 'switch-config');
    const ts = new Date();
    const path = join(this.dir, safeName(device.name), `${stamp(ts)}.cfg`);
    atomicWrite(path, content);
    const comment = [opts.comment ?? '', r.timedOut ? 'внимание: вывод мог быть получен не полностью (превышено время ожидания)' : '', platform.configCommandVerified ? '' : `команда «${command}» не подтверждена для этой платформы`]
      .filter(Boolean)
      .join('; ');
    return this.db.addBackup({
      deviceId: device.id,
      deviceName: device.name,
      ts: ts.toISOString(),
      kind: 'switch-config',
      path,
      size: Buffer.byteLength(content),
      sha256: sha,
      comment,
      sameAsPrevious: prev?.sha256 === sha
    });
  }

  read(id: number): string {
    const b = this.db.getBackup(id);
    if (!b) throw new Error('Резервная копия не найдена');
    if (b.kind === 'linux-files') {
      const manifest = join(b.path, 'MANIFEST.txt');
      return existsSync(manifest) ? readFileSync(manifest, 'utf8') : `Каталог: ${b.path}`;
    }
    if (!existsSync(b.path)) throw new Error(`Файл не найден: ${b.path}`);
    return readFileSync(b.path, 'utf8');
  }

  diff(aId: number, bId: number, opts: { ignoreWhitespace?: boolean; ignoreVolatile?: boolean } = {}) {
    const ops = diffLines(this.read(aId), this.read(bId), {
      ignoreWhitespace: opts.ignoreWhitespace,
      ignorePattern: opts.ignoreVolatile === false ? undefined : VOLATILE_CONFIG_LINES
    });
    return { hunks: toHunks(ops, 3), stats: diffStats(ops) };
  }

  remove(id: number, deleteFile: boolean): void {
    const b = this.db.getBackup(id);
    if (!b) return;
    if (deleteFile && existsSync(b.path)) rmSync(b.path, { recursive: true, force: true });
    this.db.deleteBackup(id);
  }

  /** Загрузка выбранных файлов и каталогов Linux-сервера через SFTP. */
  async downloadLinux(sessionId: string, paths: string[], comment = ''): Promise<BackupRecord> {
    const device = this.sessions.device(sessionId);
    const sftp = await this.sessions.session(sessionId).sftp();
    const ts = new Date();
    const dest = join(this.dir, safeName(device.name), `files_${stamp(ts)}`);
    mkdirSync(dest, { recursive: true });
    const manifest: string[] = [`Сервер: ${device.name} (${device.host})`, `Дата: ${ts.toISOString()}`, ''];
    let bytes = 0;
    const errors: string[] = [];
    for (const p of paths.map((x) => x.trim()).filter(Boolean)) {
      const r = await sftpDownloadTree(sftp, p, dest);
      bytes += r.bytes;
      manifest.push(`# ${p}: файлов ${r.files.length}`);
      manifest.push(...r.files.map((f) => `  ${f}`));
      errors.push(...r.errors);
    }
    if (errors.length) manifest.push('', 'Ошибки (обычно — нет прав на чтение):', ...errors.map((e) => `  ${e}`));
    const text = manifest.join('\n');
    writeFileSync(join(dest, 'MANIFEST.txt'), text);
    this.db.addHistory({ deviceId: device.id, deviceName: device.name, command: `[SFTP] загрузка: ${paths.join(', ')}`, source: 'backup', risk: 'info', result: 'done', note: `${bytes} байт` });
    return this.db.addBackup({
      deviceId: device.id,
      deviceName: device.name,
      ts: ts.toISOString(),
      kind: 'linux-files',
      path: dest,
      size: bytes,
      sha256: sha256Hex(text),
      comment: [comment, errors.length ? `ошибок: ${errors.length}` : ''].filter(Boolean).join('; '),
      sameAsPrevious: false
    });
  }
}

/** Автоматические резервные копии файла базы (раз в сутки, хранится 14 последних). */
export function autoBackupDatabase(dbPath: string, dir: string, keep = 14): string | null {
  if (!existsSync(dbPath)) return null;
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const target = join(dir, `netadmin-${day}.db`);
  if (!existsSync(target)) copyFileSync(dbPath, target);
  const files = readdirSync(dir)
    .filter((f) => /^netadmin-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) rmSync(join(dir, f), { force: true });
  return target;
}

export function listAutoBackups(dir: string): { name: string; size: number; mtime: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { name: f, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}
