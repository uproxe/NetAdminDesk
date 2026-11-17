// Каталоги данных: изменяемые данные никогда не хранятся в папке установленного приложения.
//   Windows: %APPDATA%\NetAdmin Desk
//   macOS:   ~/Library/Application Support/NetAdmin Desk
//   Linux:   $XDG_DATA_HOME/netadmin-desk или ~/.local/share/netadmin-desk
// Переносимый режим: папка «netadmin-data» рядом с исполняемым файлом (если существует и доступна на запись).
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface DataPaths {
  dataDir: string;
  dbPath: string;
  backupsDir: string;
  autoBackupsDir: string;
  sessionLogsDir: string;
  portable: boolean;
}

export function resolveDataDir(opts: { platform: NodeJS.Platform; appDataDir: string; execPath: string; env: NodeJS.ProcessEnv }): { dir: string; portable: boolean } {
  if (opts.env.NETADMIN_DESK_DATA) return { dir: opts.env.NETADMIN_DESK_DATA, portable: false };
  const portableDir = join(dirname(opts.execPath), 'netadmin-data');
  if (existsSync(portableDir)) {
    try {
      accessSync(portableDir, constants.W_OK);
      return { dir: portableDir, portable: true };
    } catch {
      /* каталог не доступен на запись — обычный режим */
    }
  }
  if (opts.platform === 'linux') {
    const base = opts.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    return { dir: join(base, 'netadmin-desk'), portable: false };
  }
  return { dir: join(opts.appDataDir, 'NetAdmin Desk'), portable: false };
}

export function makePaths(dir: string, portable: boolean): DataPaths {
  const p: DataPaths = {
    dataDir: dir,
    dbPath: join(dir, 'netadmin.db'),
    backupsDir: join(dir, 'backups'),
    autoBackupsDir: join(dir, 'auto-backups'),
    sessionLogsDir: join(dir, 'session-logs'),
    portable
  };
  for (const d of [p.dataDir, p.backupsDir, p.autoBackupsDir]) mkdirSync(d, { recursive: true });
  return p;
}
