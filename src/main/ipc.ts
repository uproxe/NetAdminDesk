// Регистрация обработчиков IPC. Каждый метод из API_SPEC имеет обработчик «nad:<namespace>.<method>».
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDatabase } from './db/database';
import type { Vault, SecretKind } from './vault';
import type { SessionManager, PromptBridge, CredentialPrompt } from './ssh/manager';
import type { TunnelManager } from './ssh/extras';
import { probeSsh } from './ssh/probe';
import { utils as ssh2Utils } from 'ssh2';
import { createSshKey, tcpCheck, type LocalTools } from './tools';
import { sftpDownload, sftpList, sftpMkdir, sftpRealpath, sftpRemove, sftpRename, sftpUpload } from './ssh/extras';
import type { BackupService } from './backups';
import { listAutoBackups } from './backups';
import type { DataPaths } from './paths';
import { API_SPEC, EVENT_CHANNEL, type NadEvent, type AnyPrompt, type DevicesExportOptions } from '../shared/ipc';
import type { AppInfo, CommandKind, DeviceInput, DeviceSecretsInput, HostKeyPrompt, KbdPrompt } from '../shared/types';
import { builtinProfiles } from '../../data/index';
import { importTxtBytes, previewTxtBytes } from './seed';
import * as io from './importExport';
import { sha256Hex } from './crypto';
import { SCHEMA_VERSION } from './db/schema';

declare const __APP_VERSION__: string;

export interface IpcContext {
  db: AppDatabase;
  vault: Vault;
  sessions: SessionManager;
  tunnels: TunnelManager;
  backups: BackupService;
  paths: DataPaths;
  getWindow: () => BrowserWindow | null;
  onRendererReady: () => void;
  restoreDatabase: (path: string) => void;
  serialBridge: RendererSerialBridge;
  localTools: LocalTools;
}

export interface SerialPortChoice {
  portId: string;
  portName: string;
  displayName?: string;
  vendorId?: string;
  productId?: string;
}

/**
 * Мост к Web Serial: порт открывается в окне программы (navigator.serial), а выбор порта
 * происходит здесь, в обработчике select-serial-port, — по имени из карточки устройства.
 */
export class RendererSerialBridge {
  private pending = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private wanted = '';
  private listMode = false;
  private lastList: SerialPortChoice[] = [];
  constructor(private getWindow: () => BrowserWindow | null) {}

  open(sessionId: string, opts: { portName: string; baudRate: number }): Promise<void> {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return Promise.reject(new Error('Окно приложения недоступно'));
    this.wanted = opts.portName.trim();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sessionId);
        reject(new Error(`Порт ${opts.portName} не открылся за 30 секунд.`));
      }, 30000);
      this.pending.set(sessionId, { resolve, reject, timer });
      sendEvent(win, { type: 'serial:open', id: sessionId, portName: opts.portName, baudRate: opts.baudRate });
    });
  }

  opened(sessionId: string, error?: string): void {
    const p = this.pending.get(sessionId);
    if (!p) return;
    this.pending.delete(sessionId);
    clearTimeout(p.timer);
    if (!error) return p.resolve();
    const list = this.lastList.map((x) => `${x.portName}${x.displayName && x.displayName !== x.portName ? ` (${x.displayName})` : ''}`).join(', ');
    if (error === 'not-found')
      p.reject(new Error(this.lastList.length ? `Порт «${this.wanted}» не найден. Подключённые порты: ${list}. Укажите нужный в карточке устройства.` : `Порт «${this.wanted}» не найден: к компьютеру не подключено ни одного COM-порта или USB-переходника. Проверьте кабель и драйвер (CH340, PL2303, FTDI).`));
    else p.reject(new Error(`Не удалось открыть порт ${this.wanted}: ${error}. Возможно, порт занят другой программой (PuTTY, другая сессия) или нет прав доступа (Linux: группа dialout).`));
  }

  write(sessionId: string, data: string): void {
    sendEvent(this.getWindow(), { type: 'serial:write', id: sessionId, data });
  }

  close(sessionId: string): void {
    sendEvent(this.getWindow(), { type: 'serial:close', id: sessionId });
  }

  /** Обработчик события select-serial-port: выбор порта по имени из карточки устройства. */
  select(ports: SerialPortChoice[], callback: (portId: string) => void): void {
    this.lastList = ports.map((p) => ({ portId: p.portId, portName: p.portName, displayName: p.displayName, vendorId: p.vendorId, productId: p.productId }));
    if (this.listMode) return callback('');
    const want = this.wanted.toLowerCase();
    const byName = (p: SerialPortChoice) => [p.portName, p.displayName].some((n) => !!n && n.toLowerCase() === want);
    const match = (want ? ports.find(byName) ?? ports.find((p) => p.portName.toLowerCase().endsWith(want)) : undefined) ?? (!want && ports.length === 1 ? ports[0] : undefined);
    callback(match ? match.portId : '');
  }

  beginList(): void {
    this.listMode = true;
    this.lastList = [];
  }

  endList(): SerialPortChoice[] {
    this.listMode = false;
    return this.lastList;
  }
}

export function sendEvent(win: BrowserWindow | null, e: NadEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, e);
}

/** Мост запросов к пользователю (ключ хоста, пароли, keyboard-interactive) через интерфейс. */
export class RendererPromptBridge implements PromptBridge {
  private pending = new Map<string, (answer: unknown) => void>();
  constructor(private getWindow: () => BrowserWindow | null) {}

  private ask<T>(prompt: AnyPrompt): Promise<T> {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return Promise.reject(new Error('Окно приложения недоступно'));
    return new Promise<T>((resolve) => {
      this.pending.set(prompt.requestId, (a) => resolve(a as T));
      sendEvent(win, { type: 'prompt', prompt });
    });
  }

  respond(requestId: string, answer: unknown): void {
    const r = this.pending.get(requestId);
    if (r) {
      this.pending.delete(requestId);
      r(answer);
    }
  }

  hostKey(p: HostKeyPrompt): Promise<'accept' | 'reject' | 'replace'> {
    return this.ask({ kind: 'hostKey', ...p });
  }

  kbd(p: KbdPrompt): Promise<string[] | null> {
    return this.ask({ kind: 'kbd', ...p });
  }

  credentials(p: CredentialPrompt): Promise<string | null> {
    return this.ask({ kind: 'credentials', requestId: p.requestId, deviceName: p.deviceName, secretKind: p.kind, message: p.message });
  }
}

type Handler = (...args: never[]) => unknown;

export function registerIpc(ctx: IpcContext, bridge: RendererPromptBridge): void {
  const { db, vault, sessions, tunnels, backups, paths } = ctx;
  const changed = (what: 'commands' | 'devices' | 'scenarios' | 'history' | 'settings' | 'all') => sendEvent(ctx.getWindow(), { type: 'data:changed', what });

  const handlers: Record<string, Record<string, Handler>> = {
    app: {
      info: (): AppInfo => ({
        version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        dataDir: paths.dataDir,
        dbPath: paths.dbPath,
        portable: paths.portable,
        electron: process.versions.electron ?? '',
        node: process.versions.node,
        chrome: process.versions.chrome ?? '',
        schemaVersion: SCHEMA_VERSION,
        dbDriver: db.driver.name
      }),
      openExternal: async (url: string) => {
        if (!/^https?:\/\//i.test(url)) throw new Error('Разрешены только ссылки http(s)');
        await shell.openExternal(url);
      },
      showItemInFolder: (p: string) => shell.showItemInFolder(p),
      openPath: (p: string) => shell.openPath(p),
      selectFile: async (o: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
        const r = await dialog.showOpenDialog(ctx.getWindow()!, { title: o.title, filters: o.filters, properties: ['openFile'] });
        return r.canceled ? null : r.filePaths[0];
      },
      selectSaveFile: async (o: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
        const r = await dialog.showSaveDialog(ctx.getWindow()!, { title: o.title, defaultPath: o.defaultPath, filters: o.filters });
        return r.canceled ? null : r.filePath ?? null;
      },
      selectDirectory: async (o: { title?: string }) => {
        const r = await dialog.showOpenDialog(ctx.getWindow()!, { title: o.title, properties: ['openDirectory', 'createDirectory'] });
        return r.canceled ? null : r.filePaths[0];
      },
      clipboardWrite: (t: string) => clipboard.writeText(t),
      clipboardRead: () => clipboard.readText(),
      setZoom: (f: number) => ctx.getWindow()?.webContents.setZoomFactor(Math.min(2, Math.max(0.6, f))),
      relaunch: () => {
        app.relaunch();
        app.exit(0);
      },
      readTextFile: (p: string) => readFileSync(p, 'utf8'),
      writeTextFile: (p: string, c: string) => writeFileSync(p, c),
      ready: () => ctx.onRendererReady()
    },
    settings: {
      get: () => db.getSettings(),
      set: (patch: Record<string, unknown>) => {
        const { vaultMode: _vm, ...rest } = patch;
        const r = db.setSettings(rest);
        db.flush();
        return r;
      }
    },
    commands: {
      list: () => db.listCommands(),
      save: (c: Parameters<AppDatabase['saveCommand']>[0]) => {
        const r = db.saveCommand(c);
        changed('commands');
        return r;
      },
      remove: (id: number) => {
        db.deleteCommand(id);
        changed('commands');
      },
      setFlags: (id: number, f: { favorite?: boolean; verified?: boolean }) => db.setCommandFlags(id, f),
      restoreDeleted: () => {
        const n = db.restoreDeletedCommands();
        changed('commands');
        return n;
      }
    },
    devices: {
      list: () => db.listDevices(),
      save: (d: DeviceInput, secrets?: DeviceSecretsInput) => {
        const saved = db.saveDevice(d);
        if (secrets) {
          const kinds: [keyof DeviceSecretsInput, SecretKind][] = [
            ['password', 'password'],
            ['keyPassphrase', 'keyPassphrase'],
            ['enablePassword', 'enablePassword']
          ];
          for (const [k, sk] of kinds) {
            const v = secrets[k];
            if (v === undefined) continue;
            if (v !== null && v !== '' && !vault.canStore()) {
              throw new Error(
                vault.status().mode === 'master'
                  ? 'Хранилище паролей заблокировано — разблокируйте его мастер-паролем.'
                  : 'Сохранение паролей недоступно: выберите режим хранения в настройках (системное хранилище или мастер-пароль).'
              );
            }
            vault.store(saved.id, sk, v);
          }
        }
        changed('devices');
        return saved;
      },
      remove: (id: number) => {
        db.deleteDevice(id);
        changed('devices');
      },
      duplicate: (id: number) => {
        const d = db.getDevice(id);
        if (!d) throw new Error('Устройство не найдено');
        const { id: _i, createdAt: _c, updatedAt: _u, lastConnectedAt: _l, lastStatus: _s, lastError: _e, ...rest } = d;
        const copy = db.saveDevice({ ...rest, name: `${d.name} (копия)` });
        changed('devices');
        return copy;
      },
      setFavorite: (id: number, fav: boolean) => {
        const d = db.getDevice(id);
        if (d) db.saveDevice({ ...d, favorite: fav });
        changed('devices');
      },
      secretsState: (id: number) => vault.state(id),
      knownHosts: () => db.listKnownHosts().map(({ keyB64: _k, ...rest }) => rest),
      forgetHostKey: (host: string, port: number) => {
        db.deleteKnownHost(host, port);
        db.addHistory({ deviceId: null, deviceName: host, command: `[ключ хоста удалён пользователем] ${host}:${port}`, source: 'reference', risk: 'change', result: 'done', note: '' });
      }
    },
    groups: {
      list: () => db.listGroups(),
      save: (g: Parameters<AppDatabase['saveGroup']>[0]) => {
        const r = db.saveGroup(g);
        changed('devices');
        return r;
      },
      remove: (id: number) => {
        db.deleteGroup(id);
        changed('devices');
      }
    },
    scenarios: {
      list: () => db.listScenarios(),
      save: (s: Parameters<AppDatabase['saveScenario']>[0]) => {
        const r = db.saveScenario(s);
        changed('scenarios');
        return r;
      },
      remove: (id: number) => {
        db.deleteScenario(id);
        changed('scenarios');
      },
      setFavorite: (id: number, fav: boolean) => db.setScenarioFavorite(id, fav)
    },
    history: {
      list: (f?: Parameters<AppDatabase['listHistory']>[0]) => db.listHistory(f),
      clear: () => db.clearHistory(),
      add: (e: Parameters<AppDatabase['addHistory']>[0]) => db.addHistory(e)
    },
    notes: {
      list: () => db.listNotes(),
      save: (n: Parameters<AppDatabase['saveNote']>[0]) => db.saveNote(n),
      remove: (id: number) => db.deleteNote(id)
    },
    vault: {
      status: () => vault.status(),
      setupMaster: (pw: string) => {
        vault.setupMaster(pw);
        db.flush();
        return vault.status();
      },
      unlock: (pw: string) => vault.unlock(pw),
      lock: () => vault.lock(),
      changeMaster: (o: string, n: string) => vault.changeMaster(o, n),
      switchMode: (m: 'os' | 'prompt') => {
        vault.switchMode(m);
        db.flush();
        return vault.status();
      }
    },
    ssh: {
      connect: (deviceId: number, size: { cols: number; rows: number }) => sessions.connect(deviceId, size),
      write: (id: string, data: string) => sessions.write(id, data),
      resize: (id: string, c: number, r: number) => sessions.resize(id, c, r),
      disconnect: (id: string) => {
        tunnels.stopForSession(id);
        sessions.disconnect(id);
      },
      list: () => sessions.list(),
      send: (id: string, cmd: string, meta: Parameters<SessionManager['sendCommand']>[2]) => sessions.sendCommand(id, cmd, meta),
      capture: (id: string, cmd: string, o: { timeoutMs?: number; idleMs?: number }, meta: Parameters<SessionManager['capture']>[3]) => sessions.capture(id, cmd, o, meta),
      exec: (id: string, cmd: string, meta: Parameters<SessionManager['exec']>[2], t?: number) => sessions.exec(id, cmd, meta, t),
      sendEnable: (id: string) => sessions.sendEnablePassword(id),
      probe: (deviceId: number) => {
        const d = db.getDevice(deviceId);
        if (!d) throw new Error('Устройство не найдено');
        if (d.protocol === 'serial')
          return { ok: true, steps: [{ step: 'tcp', ok: true, text: `Подключение через COM-порт ${d.host}, сеть не используется` }], conclusion: 'Для консольного кабеля сеть не проверяется. Если в терминале пусто: нажмите Enter, проверьте номер порта, скорость (обычно 9600 или 115200) и что кабель подключён к порту Console.' };
        return probeSsh(d.host, d.port, 7000, d.protocol === 'telnet' ? 'telnet' : 'ssh');
      }
    },
    tools: {
      run: (tool: 'ping' | 'traceroute', host: string) => ctx.localTools.run(tool, host),
      stop: (runId: string) => ctx.localTools.stop(runId),
      tcpCheck: (host: string, ports: number[]) => tcpCheck(host, ports),
      createKey: (o: { path: string; comment: string; passphrase?: string }) => createSshKey(o.path, o.comment, o.passphrase, ssh2Utils)
    },
    serial: {
      feed: (id: string, text: string) => sessions.serial(id)?.feed(text),
      opened: (id: string, error?: string) => ctx.serialBridge.opened(id, error),
      closed: (id: string, reason?: string) => sessions.serial(id)?.portClosed(reason),
      listBegin: () => ctx.serialBridge.beginList(),
      listEnd: () => ctx.serialBridge.endList()
    },
    prompts: {
      respond: (requestId: string, answer: unknown) => bridge.respond(requestId, answer)
    },
    sftp: {
      list: async (id: string, p: string) => sftpList(await sessions.session(id).sftp(), p),
      download: async (id: string, r: string, l: string) => {
        await sftpDownload(await sessions.session(id).sftp(), r, l);
        const d = sessions.device(id);
        db.addHistory({ deviceId: d.id, deviceName: d.name, command: `[SFTP] скачан ${r} → ${l}`, source: 'reference', risk: 'info', result: 'done', note: '' });
      },
      upload: async (id: string, l: string, r: string) => {
        await sftpUpload(await sessions.session(id).sftp(), l, r);
        const d = sessions.device(id);
        db.addHistory({ deviceId: d.id, deviceName: d.name, command: `[SFTP] загружен ${l} → ${r}`, source: 'reference', risk: 'change', result: 'done', note: '' });
      },
      mkdir: async (id: string, p: string) => sftpMkdir(await sessions.session(id).sftp(), p),
      rename: async (id: string, a: string, b: string) => sftpRename(await sessions.session(id).sftp(), a, b),
      remove: async (id: string, p: string, isDir: boolean) => {
        await sftpRemove(await sessions.session(id).sftp(), p, isDir);
        const d = sessions.device(id);
        db.addHistory({ deviceId: d.id, deviceName: d.name, command: `[SFTP] удалён ${p}`, source: 'reference', risk: 'danger', result: 'done', note: '' });
      },
      home: async (id: string) => sftpRealpath(await sessions.session(id).sftp(), '.')
    },
    tunnels: {
      list: () => tunnels.list(),
      start: (spec: Parameters<TunnelManager['start']>[0]) => tunnels.start(spec, sessions.session(spec.sessionId).sshClient),
      stop: (id: string) => tunnels.stop(id)
    },
    backups: {
      list: (deviceId?: number) => db.listBackups(deviceId),
      fetchSwitchConfig: (id: string, o?: { command?: string; comment?: string }) => backups.fetchSwitchConfig(id, o),
      read: (id: number) => backups.read(id),
      diff: (a: number, b: number, o?: { ignoreWhitespace?: boolean; ignoreVolatile?: boolean }) => backups.diff(a, b, o),
      remove: (id: number, del: boolean) => backups.remove(id, del),
      downloadLinux: (id: string, p: string[], c?: string) => backups.downloadLinux(id, p, c)
    },
    diagnostics: {
      save: (deviceId: number | null, name: string, task: string, report: Parameters<AppDatabase['saveDiagnostic']>[3]) => db.saveDiagnostic(deviceId, name, task, report),
      list: (deviceId?: number, task?: string) => db.listDiagnostics(deviceId, task)
    },
    profiles: {
      list: () => {
        const overrides = db.listProfileOverrides();
        const key = (p: { platform: string; task: string }) => `${p.platform}:${p.task}`;
        const map = new Map(builtinProfiles().map((p) => [key(p), p]));
        for (const o of overrides) map.set(key(o), o);
        return [...map.values()];
      },
      save: (p: Parameters<AppDatabase['saveProfile']>[0]) => db.saveProfile(p),
      reset: (platform: string, task: string) => db.resetProfile(platform, task)
    },
    templates: {
      listParams: () => db.listTemplateParams(),
      saveParam: (p: Parameters<AppDatabase['saveTemplateParam']>[0]) => db.saveTemplateParam(p),
      removeParam: (n: string) => db.deleteTemplateParam(n)
    },
    io: {
      previewTxt: (p: string) => {
        const bytes = readFileSync(p);
        return previewTxtBytes(db, bytes, { fileLabel: p.split(/[\\/]/).pop() ?? p, sourceKey: `txt-${sha256Hex(bytes).slice(0, 10)}`, source: 'imported' });
      },
      importTxt: (p: string, o: { skipDuplicates: boolean }) => {
        const bytes = readFileSync(p);
        const r = importTxtBytes(db, bytes, { fileLabel: p.split(/[\\/]/).pop() ?? p, sourceKey: `txt-${sha256Hex(bytes).slice(0, 10)}`, source: 'imported' }, o);
        changed('commands');
        return r;
      },
      exportTxt: (p: string, o: { kinds: CommandKind[]; sources?: string[] }) => io.exportTxt(db, p, o),
      exportJson: (p: string) => io.exportJson(db, p),
      previewJson: (p: string) => io.previewJson(db, p),
      importJson: (p: string, o: { overwriteConflicts: boolean }) => {
        const r = io.importJson(db, p, o);
        changed('all');
        return r;
      },
      previewDevicesCsv: (p: string) => {
        const { passwords: _p, groups: _g, ...rest } = io.previewDevicesCsv(db, p);
        return rest;
      },
      importDevicesCsv: (p: string, o: { importPasswords: boolean; skipDuplicates: boolean }) => {
        const n = io.importDevicesCsv(db, vault, p, o);
        changed('devices');
        return n;
      },
      previewSshConfig: (p?: string) => io.previewSshConfig(db, p),
      importSshConfig: (p: string | undefined, o: { skipDuplicates: boolean }) => {
        const n = io.importSshConfig(db, p, o);
        changed('devices');
        return n;
      },
      exportEncrypted: (p: string, pw: string, o: { includeHistory: boolean }) => io.exportEncrypted(db, vault, p, pw, o),
      exportDevices: (p: string, o: DevicesExportOptions) => io.exportDevices(db, vault, p, o),
      exportDevicesCsv: (p: string, ids?: number[]) => io.exportDevicesCsv(db, p, ids),
      previewDevicesFile: (p: string, pw?: string) => io.previewDevicesFile(db, p, pw),
      importDevicesFile: (p: string, o: { password?: string; overwrite: boolean; knownHosts: boolean; secrets: boolean }) => {
        const r = io.importDevicesFile(db, vault, p, o);
        changed('devices');
        return r;
      },
      previewEncrypted: (p: string, pw: string) => io.previewEncrypted(p, pw),
      importEncrypted: (p: string, pw: string, o: { overwriteConflicts: boolean; importSettings: boolean }) => {
        const r = io.importEncrypted(db, vault, p, pw, o);
        changed('all');
        return r;
      },
      backupDatabase: (p: string) => {
        db.flush();
        copyFileSync(paths.dbPath, p);
      },
      restoreDatabase: (p: string) => ctx.restoreDatabase(p),
      importReports: () => db.listImportReports()
    },
    db: {
      integrity: () => db.integrityCheck(),
      autoBackups: () => listAutoBackups(paths.autoBackupsDir),
      restoreAutoBackup: (name: string) => {
        const p = join(paths.autoBackupsDir, name.replace(/[\\/]/g, ''));
        if (!existsSync(p)) throw new Error('Файл автоматической копии не найден');
        ctx.restoreDatabase(p);
      }
    }
  };

  for (const [ns, methods] of Object.entries(API_SPEC)) {
    for (const m of methods) {
      const h = handlers[ns]?.[m];
      if (!h) throw new Error(`Нет обработчика IPC для ${ns}.${m}`);
      ipcMain.handle(`nad:${ns}.${m}`, async (_e, ...args: unknown[]) => {
        try {
          const r = await (h as (...a: unknown[]) => unknown)(...args);
          db.flush();
          return r;
        } catch (err) {
          throw new Error((err as Error).message);
        }
      });
    }
  }

  // Пакетная передача вывода терминала (снижает нагрузку на IPC при большом выводе)
  const buffers = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;
  sessions.on('data', (id: string, chunk: string) => {
    buffers.set(id, (buffers.get(id) ?? '') + chunk);
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        for (const [sid, data] of buffers) sendEvent(ctx.getWindow(), { type: 'ssh:data', id: sid, data });
        buffers.clear();
      }, 8);
    }
  });
  sessions.on('status', (info) => sendEvent(ctx.getWindow(), { type: 'ssh:status', info }));
  sessions.on('closed', (id: string) => {
    tunnels.stopForSession(id);
    sendEvent(ctx.getWindow(), { type: 'ssh:closed', id });
  });
  tunnels.onChange = (list) => sendEvent(ctx.getWindow(), { type: 'tunnels:changed', tunnels: list });
}
