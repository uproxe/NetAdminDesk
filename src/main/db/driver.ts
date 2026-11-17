// Абстракция над SQLite: sql.js (WebAssembly, без нативных модулей) — в приложении,
// node:sqlite — для тестов и разработки. Оба драйвера используют позиционные параметры «?».
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

export type SqlValue = string | number | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqlDriver {
  readonly name: string;
  exec(sql: string): void;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): RunResult;
  /** Сохранить изменения на диск (для драйверов, работающих в памяти). */
  flush(): void;
  close(): void;
}

function normParams(params: unknown[] = []): SqlValue[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number' || typeof p === 'string') return p;
    if (p instanceof Uint8Array) return p;
    if (typeof p === 'bigint') return Number(p);
    return JSON.stringify(p);
  });
}

/** Атомарная запись файла: во временный файл, fsync, затем переименование. */
export function atomicWrite(path: string, data: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  try {
    const fd = openSync(tmp, 'r+');
    fsyncSync(fd);
    closeSync(fd);
  } catch {
    /* fsync может быть недоступен на некоторых ФС */
  }
  renameSync(tmp, path);
}

// ---------- node:sqlite ----------

export class NodeSqliteDriver implements SqlDriver {
  readonly name = 'node:sqlite';
  private db: {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...p: SqlValue[]): unknown[];
      get(...p: SqlValue[]): unknown;
      run(...p: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
    close(): void;
  };

  constructor(path: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => NodeSqliteDriver['db'] };
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  all<T>(sql: string, params?: unknown[]): T[] {
    return this.db.prepare(sql).all(...normParams(params)) as T[];
  }

  get<T>(sql: string, params?: unknown[]): T | undefined {
    return (this.db.prepare(sql).get(...normParams(params)) as T) ?? undefined;
  }

  run(sql: string, params?: unknown[]): RunResult {
    const r = this.db.prepare(sql).run(...normParams(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  flush(): void {
    /* файл обновляется сразу */
  }

  close(): void {
    this.db.close();
  }
}

// ---------- sql.js ----------

interface SqlJsStatement {
  bind(values: SqlValue[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): boolean;
}
interface SqlJsDatabase {
  exec(sql: string): unknown;
  run(sql: string, params?: SqlValue[]): unknown;
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  getRowsModified(): number;
  close(): void;
}
interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

export class SqlJsDriver implements SqlDriver {
  readonly name = 'sql.js';
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private inTx = 0;

  private constructor(private db: SqlJsDatabase, private path: string) {}

  static async open(path: string, wasmPath?: string): Promise<SqlJsDriver> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require('sql.js') as (cfg: Record<string, unknown>) => Promise<SqlJsStatic>;
    const wasm = wasmPath ?? require.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ wasmBinary: readFileSync(wasm) });
    const data = path !== ':memory:' && existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    const drv = new SqlJsDriver(new SQL.Database(data), path);
    drv.db.exec('PRAGMA foreign_keys = ON;');
    return drv;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.inTx > 0 || this.path === ':memory:') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  exec(sql: string): void {
    const t = sql.trim().toUpperCase();
    if (t.startsWith('BEGIN')) this.inTx++;
    this.db.exec(sql);
    if (t.startsWith('COMMIT') || t.startsWith('ROLLBACK') || t.startsWith('END')) this.inTx = Math.max(0, this.inTx - 1);
    if (!/^(SELECT|PRAGMA (INTEGRITY|QUICK)_CHECK|BEGIN)/.test(t)) this.markDirty();
  }

  all<T>(sql: string, params?: unknown[]): T[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(normParams(params));
      const rows: T[] = [];
      while (st.step()) rows.push(st.getAsObject() as T);
      return rows;
    } finally {
      st.free();
    }
  }

  get<T>(sql: string, params?: unknown[]): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  run(sql: string, params?: unknown[]): RunResult {
    const st = this.db.prepare(sql);
    try {
      st.bind(normParams(params));
      st.step();
    } finally {
      st.free();
    }
    const changes = this.db.getRowsModified();
    const id = this.get<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0;
    this.markDirty();
    return { changes, lastInsertRowid: Number(id) };
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || this.path === ':memory:' || this.inTx > 0) return;
    const data = this.db.export();
    // export() пересоздаёт соединение и сбрасывает PRAGMA
    this.db.exec('PRAGMA foreign_keys = ON;');
    atomicWrite(this.path, data);
    this.dirty = false;
  }

  close(): void {
    this.flush();
    this.db.close();
  }
}

export async function openDriver(path: string, kind: 'sqljs' | 'node' = 'sqljs', wasmPath?: string): Promise<SqlDriver> {
  if (kind === 'node') return new NodeSqliteDriver(path);
  return SqlJsDriver.open(path, wasmPath);
}
