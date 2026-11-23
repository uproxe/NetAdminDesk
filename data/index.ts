// Встроенные данные приложения.
import type { CommandInput, CommandSource } from '../src/shared/types';
import { SYSINFO_FILES } from './linux/sysinfo-files';
import { PERMS_PROCESSES } from './linux/perms-processes';
import { SYSTEMD_LOGS } from './linux/systemd-logs';
import { NETWORK_SSH } from './linux/network-ssh';
import { DISKS_PACKAGES } from './linux/disks-packages';
import { SECURITY_CRON_BACKUP } from './linux/security-cron-backup';
import { SERVICES } from './linux/services';
import { SWITCH_BUILTIN } from './switch/builtin';
import { LINUX_BASICS } from './linux/basics';
import { LINUX_ADMIN } from './linux/admin';
import { SWITCH_BASICS } from './switch/basics';
import { USERGATE_COMMANDS } from './switch/usergate';
import { SQL_COMMANDS, SQL_MOVED, moveToSql } from './sql';

import { BUILTIN_SCENARIOS as BASE_SCENARIOS } from './scenarios';
import { LIBRARY_SCENARIOS } from './scenarios-library';
import type { ScenarioInput } from '../src/shared/types';

/** Встроенные сценарии: базовые и библиотека типовых задач. */
export const BUILTIN_SCENARIOS: ScenarioInput[] = [...BASE_SCENARIOS, ...LIBRARY_SCENARIOS];
export { GUIDES, GUIDE_SECTIONS } from './guides/index';
export { builtinProfiles, SWITCH_TASKS, MAC_TABLE_DUMP, NEIGHBOR_COMMANDS } from './profiles';

/** Версия встроенных данных: при увеличении встроенные записи обновляются (кроме изменённых пользователем). */
export const SEED_VERSION = 4;

const LINUX_ALL: CommandInput[] = [
  ...LINUX_BASICS,
  ...LINUX_ADMIN,
  ...SYSINFO_FILES,
  ...PERMS_PROCESSES,
  ...SYSTEMD_LOGS,
  ...NETWORK_SSH,
  ...DISKS_PACKAGES,
  ...SECURITY_CRON_BACKUP,
  ...SERVICES
];

/** Linux-справочник без записей о базах данных — они перенесены в раздел SQL (без дублей). */
export const LINUX_BUILTIN: CommandInput[] = LINUX_ALL.filter((c) => !SQL_MOVED[c.uid]);

/** Раздел «Базы данных (SQL)»: MySQL, MariaDB, PostgreSQL. */
export const SQL_BUILTIN: CommandInput[] = [...SQL_COMMANDS, ...LINUX_ALL.filter((c) => SQL_MOVED[c.uid]).map(moveToSql)];

export const BUILTIN_COMMANDS: CommandInput[] = [...LINUX_BUILTIN, ...SWITCH_BUILTIN, ...SWITCH_BASICS, ...USERGATE_COMMANDS, ...SQL_BUILTIN];

export interface SeedFile {
  key: string;
  file: string;
  label: string;
  source: CommandSource;
}

/** Обезличенные рабочие заметки в формате TXT, импортируемые при первом запуске (тем же разборщиком, что и «Импорт TXT»). */
export const SEED_FILES: SeedFile[] = [
  { key: 'txt-main', file: 'komandy-kommutatorov.txt', label: 'Рабочие заметки по коммутаторам (TXT)', source: 'imported' },
  { key: 'txt-acl', file: 'acl-notes.txt', label: 'Заметки по ACL и object-group (TXT)', source: 'imported' }
];
