// Схема базы данных и миграции. Каждая миграция выполняется один раз; номер хранится в meta.schema_version.

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Начальная схема',
    sql: `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'command',
  platform TEXT NOT NULL,
  vendor_label TEXT NOT NULL DEFAULT '',
  model TEXT,
  os TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  command TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  raw_text TEXT,
  template TEXT,
  risk TEXT NOT NULL DEFAULT 'info',
  risk_manual INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'any',
  source TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  review_note TEXT,
  vendor_unknown INTEGER NOT NULL DEFAULT 0,
  sensitive INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  user_modified INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  origin_file TEXT,
  origin_line INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_commands_kind ON commands(kind, platform);

CREATE TABLE device_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES device_groups(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'group',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  vendor TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'generic-ssh',
  device_type TEXT NOT NULL DEFAULT 'other',
  os_version TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  auth_method TEXT NOT NULL DEFAULT 'password',
  key_path TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  group_id INTEGER REFERENCES device_groups(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  linux_distro TEXT NOT NULL DEFAULT '',
  linux_version TEXT NOT NULL DEFAULT '',
  hostname TEXT NOT NULL DEFAULT '',
  server_type TEXT NOT NULL DEFAULT '',
  services_notes TEXT NOT NULL DEFAULT '',
  connection_notes TEXT NOT NULL DEFAULT '',
  legacy_algorithms INTEGER NOT NULL DEFAULT 0,
  auto_enable INTEGER NOT NULL DEFAULT 0,
  disable_pager INTEGER NOT NULL DEFAULT 0,
  read_only INTEGER NOT NULL DEFAULT 0,
  keepalive_sec INTEGER NOT NULL DEFAULT 30,
  timeout_sec INTEGER NOT NULL DEFAULT 20,
  jump_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  last_connected_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'never',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE secrets (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  scheme TEXT NOT NULL,
  blob TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, kind)
);

CREATE TABLE known_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  key_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  key_b64 TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  UNIQUE (host, port)
);

CREATE TABLE scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  platforms TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  builtin INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  user_modified INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  device_id INTEGER,
  device_name TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL,
  source TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'info',
  result TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_history_ts ON history(ts);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER,
  device_name TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  same_as_previous INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER,
  device_name TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL,
  ts TEXT NOT NULL,
  report TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE profiles (
  platform TEXT NOT NULL,
  task TEXT NOT NULL,
  steps TEXT NOT NULL,
  note TEXT,
  user_modified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (platform, task)
);

CREATE TABLE template_params (
  name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  regex TEXT,
  description TEXT
);

CREATE TABLE import_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  file TEXT NOT NULL,
  report TEXT NOT NULL
);

CREATE TABLE custom_platforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT ''
);
`
  },
  {
    version: 2,
    description: 'Протокол подключения (SSH, Telnet, COM-порт), команды после входа, цвет устройства',
    sql: `
ALTER TABLE devices ADD COLUMN protocol TEXT NOT NULL DEFAULT 'ssh';
ALTER TABLE devices ADD COLUMN serial_baud INTEGER NOT NULL DEFAULT 9600;
ALTER TABLE devices ADD COLUMN login_commands TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN color TEXT NOT NULL DEFAULT '';
`
  },
  {
    version: 3,
    description: 'Мониторинг доступности: узлы, карты, события; секреты приложения (SNMP community, пароль почты)',
    sql: `
CREATE TABLE app_secrets (
  key TEXT PRIMARY KEY,
  scheme TEXT NOT NULL,
  blob TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE monitor_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  vendor TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'ping',
  snmp_version INTEGER NOT NULL DEFAULT 2,
  snmp_port INTEGER NOT NULL DEFAULT 161,
  tcp_port INTEGER NOT NULL DEFAULT 0,
  interval_sec INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE monitor_maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  background TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 1600,
  height INTEGER NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE monitor_map_items (
  map_id INTEGER NOT NULL REFERENCES monitor_maps(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES monitor_nodes(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL,
  PRIMARY KEY (map_id, node_id)
);
CREATE TABLE monitor_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL REFERENCES monitor_maps(id) ON DELETE CASCADE,
  a INTEGER NOT NULL REFERENCES monitor_nodes(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES monitor_nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT ''
);
CREATE TABLE monitor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  node_id INTEGER,
  node_name TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX idx_monitor_events_ts ON monitor_events(ts);
`
  },
  {
    // Менеджер паролей: всё содержимое записей и названия папок — в зашифрованных blob
    // (AES-256-GCM, ключ из отдельного мастер-пароля менеджера); параметры ключа — в meta.pm_master.
    version: 4,
    description: 'Менеджер паролей: зашифрованные записи и папки',
    sql: `
CREATE TABLE pm_groups (
  uid TEXT PRIMARY KEY,
  blob TEXT NOT NULL
);
CREATE TABLE pm_entries (
  uid TEXT PRIMARY KEY,
  blob TEXT NOT NULL
);
`
  }
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
