// Точка входа main-процесса NetAdmin Desk.
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, Notification, powerMonitor, safeStorage, session, shell, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDriver } from './db/driver';
import { AppDatabase } from './db/database';
import { makePaths, resolveDataDir, type DataPaths } from './paths';
import { seedDatabase } from './seed';
import { Vault, type OsCrypto } from './vault';
import { SessionManager } from './ssh/manager';
import { TunnelManager } from './ssh/extras';
import { BackupService, autoBackupDatabase, listAutoBackups } from './backups';
import { RendererPromptBridge, RendererSerialBridge, registerIpc, sendEvent, type SerialPortChoice } from './ipc';
import { maskSecrets } from '../shared/risk';
import { LocalTools } from './tools';
import { MonitorEngine } from './monitor/engine';
import { PasswordStore, PM_KDF } from './passwords';
import { deriveKeyAsync, open as openSealed, seal } from './crypto';
import { randomBytes } from 'node:crypto';

declare const __APP_VERSION__: string;

const SMOKE = process.argv.includes('--smoke-test');
let win: BrowserWindow | null = null;
let db: AppDatabase | null = null;
let sessions: SessionManager | null = null;
let tunnels: TunnelManager | null = null;
let localTools: LocalTools | null = null;
let monitor: MonitorEngine | null = null;
let passwords: PasswordStore | null = null;
let tray: Tray | null = null;
/** true — приложение действительно закрывается (а не прячется в область уведомлений). */
let quitting = false;
let trayHintShown = false;
const START_HIDDEN = process.argv.includes('--hidden');
let paths: DataPaths;
let rendererReady: () => void = () => {};
const rendererReadyPromise = new Promise<void>((r) => (rendererReady = r));
/** Ошибки консоли интерфейса — для самопроверки (--smoke-test). */
const rendererErrors: string[] = [];

// Каталоги данных определяются до готовности приложения (профиль Chromium — внутри каталога данных).
{
  const resolved = resolveDataDir({ platform: process.platform, appDataDir: app.getPath('appData'), execPath: process.execPath, env: process.env });
  paths = makePaths(resolved.dir, resolved.portable);
  app.setPath('userData', join(paths.dataDir, 'electron'));
}

// Страховка: необработанная ошибка в главном процессе не должна показывать системное окно
// «A JavaScript error occurred» и останавливать работу. Ошибка записывается в logs/main.log
// (пароли маскируются) и показывается в интерфейсе уведомлением.
function logMainError(kind: string, e: unknown): void {
  const text = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  try {
    const dir = join(paths.dataDir, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'main.log'), `[${new Date().toISOString()}] ${kind}: ${maskSecrets(text)}\n`);
  } catch {
    /* журнал необязателен */
  }
  console.error(`[main] ${kind}:`, text);
  if (SMOKE) rendererErrors.push(`main ${kind}: ${text.split('\n')[0]}`);
  try {
    sendEvent(win, { type: 'app:error', message: maskSecrets(text.split('\n')[0]).slice(0, 300) });
  } catch {
    /* окна может ещё не быть */
  }
}
process.on('uncaughtException', (e) => logMainError('uncaughtException', e));
process.on('unhandledRejection', (e) => logMainError('unhandledRejection', e));

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

function osCrypto(): OsCrypto {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    backend: () => {
      if (process.platform === 'linux') {
        const fn = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend;
        return fn ? fn() : 'unknown';
      }
      return process.platform === 'darwin' ? 'keychain' : 'dpapi';
    },
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b)
  };
}

function isSqlite(path: string): boolean {
  try {
    return readFileSync(path).subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000';
  } catch {
    return false;
  }
}

async function openDatabase(): Promise<AppDatabase> {
  const kind = process.env.NAD_DB_DRIVER === 'node' ? 'node' : 'sqljs';
  let driver = await openDriver(paths.dbPath, kind);
  let database = new AppDatabase(driver);
  let integrity = 'ok';
  try {
    integrity = database.integrityCheck();
  } catch (e) {
    integrity = (e as Error).message;
  }
  if (integrity !== 'ok') {
    const backupsList = listAutoBackups(paths.autoBackupsDir);
    const buttons = backupsList.length ? ['Восстановить последнюю автокопию', 'Продолжить', 'Выход'] : ['Продолжить', 'Выход'];
    const r = SMOKE
      ? { response: buttons.length - 2 }
      : await dialog.showMessageBox({
          type: 'error',
          title: 'NetAdmin Desk — проверка базы данных',
          message: 'Проверка целостности базы данных выявила ошибки.',
          detail: `${integrity.slice(0, 600)}\n\nФайл: ${paths.dbPath}`,
          buttons
        });
    const choice = buttons[r.response];
    if (choice === 'Выход') {
      app.exit(1);
      throw new Error('exit');
    }
    if (choice?.startsWith('Восстановить')) {
      driver.close();
      copyFileSync(paths.dbPath, `${paths.dbPath}.damaged-${Date.now()}`);
      copyFileSync(join(paths.autoBackupsDir, backupsList[0].name), paths.dbPath);
      driver = await openDriver(paths.dbPath, kind);
      database = new AppDatabase(driver);
    }
  }
  return database;
}

function restoreDatabase(path: string): void {
  if (!isSqlite(path)) throw new Error('Выбранный файл не является базой данных SQLite');
  sessions?.disconnectAll();
  db?.close();
  db = null;
  copyFileSync(paths.dbPath, `${paths.dbPath}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  copyFileSync(path, paths.dbPath);
  app.relaunch();
  app.exit(0);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d1117',
    title: 'NetAdmin Desk',
    icon: existsSync(join(__dirname, '../renderer/icon.png')) ? join(__dirname, '../renderer/icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: true
    }
  });
  win.once('ready-to-show', () => {
    if (SMOKE) return;
    if (START_HIDDEN && keepRunningInBackground()) ensureTray();
    else win?.show();
  });
  // Закрытие окна при включённом мониторинге в фоне: окно прячется, проверки продолжаются.
  win.on('close', (e: { preventDefault(): void }) => {
    if (quitting || SMOKE || !keepRunningInBackground()) return;
    e.preventDefault();
    win?.hide();
    ensureTray();
    if (!trayHintShown) {
      trayHintShown = true;
      notify('NetAdmin Desk работает в фоне', 'Мониторинг продолжается. Открыть окно или выйти — через значок в области уведомлений.');
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Сигнатура события различается между версиями Electron: поддерживаются обе.
  win.webContents.on('console-message', ((e: { level?: string | number; message?: string }, level?: number, message?: string) => {
    const lvl = e?.level ?? level;
    const msg = e?.message ?? message ?? '';
    if (lvl === 'error' || lvl === 3) rendererErrors.push(String(msg).slice(0, 500));
  }) as never);
  win.webContents.on('render-process-gone', (_e, d) => rendererErrors.push(`render-process-gone: ${d.reason}`));
  win.webContents.on('preload-error', (_e, p, err) => rendererErrors.push(`preload-error ${p}: ${err.message}`));
  // Менеджер паролей: блокировка при сворачивании или скрытии окна (если включено в настройках).
  const lockOnHide = () => {
    if (db && db.getSettings().passwords.lockOnMinimize) passwords?.lock('minimize');
  };
  win.on('minimize', lockOnHide);
  win.on('hide', lockOnHide);
  win.on('closed', () => (win = null));
  void win.loadFile(join(__dirname, '../renderer/index.html'));
}

function keepRunningInBackground(): boolean {
  if (!db) return false;
  const m = db.getSettings().monitor;
  return m.enabled && m.background.keepRunning && db.listMonitorNodes().length > 0;
}

function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', () => showWindow('monitor'));
    n.show();
  } catch {
    /* уведомления недоступны в этой системе */
  }
}

function showWindow(section?: string): void {
  if (!win) createWindow();
  win?.show();
  win?.focus();
  if (section) sendEvent(win, { type: 'menu', action: `section:${section}` });
}

function trayMenu(): void {
  if (!tray || !monitor) return;
  const c = monitor.status().counts;
  tray.setToolTip(`NetAdmin Desk — в сети ${c.up}, проблемы ${c.warn}, не в сети ${c.down}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть NetAdmin Desk', click: () => showWindow() },
      { label: 'Открыть мониторинг', click: () => showWindow('monitor') },
      { type: 'separator' },
      { label: `Не в сети: ${c.down}${c.warn ? `, с проблемами: ${c.warn}` : ''}`, enabled: false } as MenuItemConstructorOptions,
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

function ensureTray(): void {
  if (tray && !tray.isDestroyed()) return trayMenu();
  tray = new Tray(trayImage());
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
  trayMenu();
}

/**
 * Значок в области уведомлений. Рядом лежит вариант @2x — Electron сам берёт его на
 * экранах высокой плотности. В строке меню macOS — силуэт-шаблон: цвет подставит система.
 */
function trayImage(): NativeImage {
  const dir = join(__dirname, '../renderer');
  const mac = process.platform === 'darwin';
  const file = join(dir, mac ? 'trayTemplate.png' : 'tray.png');
  if (existsSync(file)) {
    const img = nativeImage.createFromPath(file);
    if (mac) img.setTemplateImage(true);
    if (!img.isEmpty()) return img;
  }
  const icon = join(dir, 'icon.png');
  return existsSync(icon) ? nativeImage.createFromPath(icon).resize({ width: mac ? 18 : 16 }) : nativeImage.createEmpty();
}

/** Автозапуск при входе в систему (скрыто, в область уведомлений) — по настройке мониторинга. */
function applyBackgroundSettings(): void {
  if (!db || SMOKE) return;
  const m = db.getSettings().monitor;
  try {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: m.background.openAtLogin, args: ['--hidden'] });
  } catch {
    /* не поддерживается в этой системе */
  }
  if (!keepRunningInBackground() && tray && win?.isVisible()) {
    tray.destroy();
    tray = null;
  }
}

function buildMenu(): void {
  const send = (action: string) => () => sendEvent(win, { type: 'menu', action });
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Файл',
      submenu: [
        { label: 'Новое устройство', accelerator: 'CmdOrCtrl+N', click: send('new-device') },
        { label: 'Быстрый поиск', accelerator: 'CmdOrCtrl+K', click: send('search') },
        { type: 'separator' },
        { label: 'Импорт команд из TXT…', click: send('import-txt') },
        { label: 'Импорт и экспорт данных…', click: send('import-export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Выход' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Боковая панель', accelerator: 'CmdOrCtrl+B', click: send('toggle-sidebar') },
        { label: 'Терминал + справочник', accelerator: 'CmdOrCtrl+\\', click: send('toggle-split') },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Увеличить', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { role: 'resetZoom', label: 'Исходный масштаб' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' }
      ]
    },
    {
      label: 'Справка',
      submenu: [
        { label: 'Горячие клавиши', accelerator: 'F1', click: send('hotkeys') },
        { label: 'О программе', click: send('about') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function runSmokeTest(vault: Vault, seedReports: number): Promise<void> {
  const out: Record<string, unknown> = { version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev', platform: process.platform, arch: process.arch };
  let ok = true;
  const check = (name: string, cond: boolean, detail?: unknown) => {
    out[name] = { ok: cond, detail };
    if (!cond) ok = false;
  };
  try {
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 45000));
    const ready = await Promise.race([rendererReadyPromise.then(() => 'ready' as const), timeout]);
    check('rendererReady', ready === 'ready');
    check('integrity', db!.integrityCheck() === 'ok');
    const cmds = db!.listCommands();
    check('commands', cmds.length > 300, cmds.length);
    check('linuxCommands', cmds.filter((c) => c.kind === 'linux').length >= 200, cmds.filter((c) => c.kind === 'linux').length);
    const reports = db!.listImportReports();
    check('userTxtImported', reports.length >= 1 || seedReports === 0, reports.map((r) => ({ file: r.file, entries: r.report.entries, unaccounted: r.report.unaccounted.length })));
    check('noUnaccountedLines', reports.every((r) => r.report.unaccounted.length === 0));
    check('vault', true, vault.status());
    // Менеджер паролей: схема базы и scrypt с рабочими параметрами в криптобиблиотеке Electron
    check('passwordManagerSchema', Number(db!.getMeta('schema_version')) >= 4, { entries: db!.pmCount() });
    const pmStart = Date.now();
    const pmKey = await deriveKeyAsync('smoke-test-only', { name: 'scrypt', ...PM_KDF, salt: randomBytes(16).toString('base64') });
    const pmBack = openSealed(pmKey, seal(pmKey, 'nad-smoke', 'nad-pm:smoke'), 'nad-pm:smoke').toString('utf8');
    check('passwordManagerCrypto', pmKey.length === 32 && pmBack === 'nad-smoke', { scryptMs: Date.now() - pmStart });
    check('dbDriver', true, db!.driver.name);
    // Логотип: иконка окна и значок области уведомлений попали в пакет и читаются
    const tray = trayImage();
    check('appIcons', existsSync(join(__dirname, '../renderer/icon.png')) && !tray.isEmpty(), tray.getSize());
    // Небольшая пауза, чтобы ошибки отрисовки успели попасть в журнал.
    await new Promise((r) => setTimeout(r, 1500));
    check('rendererNoErrors', rendererErrors.length === 0, rendererErrors);
  } catch (e) {
    check('exception', false, (e as Error).message);
  }
  out.result = ok ? 'PASS' : 'FAIL';
  const text = JSON.stringify(out, null, 2);
  console.log(text);
  if (process.env.NAD_SMOKE_OUT) writeFileSync(process.env.NAD_SMOKE_OUT, text);
  db?.close();
  app.exit(ok ? 0 : 1);
}

async function init(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // COM-порт (Web Serial): разрешён только доступ к последовательным портам; остальные разрешения запрещены.
  const serialBridge = new RendererSerialBridge(() => win);
  const ses = session.defaultSession as unknown as {
    on(ev: 'select-serial-port', l: (e: { preventDefault(): void }, ports: SerialPortChoice[], wc: unknown, cb: (portId: string) => void) => void): void;
    setPermissionCheckHandler?(h: (wc: unknown, permission: string) => boolean): void;
    setDevicePermissionHandler?(h: (d: { deviceType: string }) => boolean): void;
  };
  ses.on('select-serial-port', (e, ports, _wc, cb) => {
    e.preventDefault();
    serialBridge.select(ports, cb);
  });
  ses.setPermissionCheckHandler?.((_wc, permission) => permission === 'serial');
  ses.setDevicePermissionHandler?.((d) => d.deviceType === 'serial');

  db = await openDatabase();
  db.migrate();
  autoBackupDatabase(paths.dbPath, paths.autoBackupsDir);
  const seed = seedDatabase(db, join(__dirname, '../data/user'));

  const vault = new Vault(db, osCrypto());
  vault.autoInit();
  const bridge = new RendererPromptBridge(() => win);
  sessions = new SessionManager(db, vault, bridge, { sessionLogDir: paths.sessionLogsDir, serialBridge });
  tunnels = new TunnelManager();
  localTools = new LocalTools((e) => sendEvent(win, e));
  const backups = new BackupService(db, sessions, paths.backupsDir);
  monitor = new MonitorEngine(
    db,
    vault,
    (e) => {
      sendEvent(win, e);
      if (e.type === 'monitor:status' && tray) trayMenu();
    },
    { desktopNotify: (t, b) => notify(t, b) }
  );
  passwords = new PasswordStore(db, {
    clipboard,
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : app.getVersion(),
    onLock: (reason) => sendEvent(win, { type: 'pm:locked', reason })
  });
  const pmTimer = setInterval(() => {
    if (db) passwords?.tick(db.getSettings().passwords.autoLockMin);
  }, 15_000);
  pmTimer.unref?.();
  const lockOnScreen = () => {
    if (db && db.getSettings().passwords.lockOnScreenLock) passwords?.lock('screen');
  };
  powerMonitor.on('lock-screen', lockOnScreen);
  powerMonitor.on('suspend', lockOnScreen);
  registerIpc(
    {
      db,
      vault,
      sessions,
      tunnels,
      backups,
      paths,
      getWindow: () => win,
      onRendererReady: () => rendererReady(),
      restoreDatabase,
      serialBridge,
      localTools,
      monitor,
      passwords,
      onMonitorSettings: applyBackgroundSettings
    },
    bridge
  );
  buildMenu();
  createWindow();
  if (!SMOKE) {
    void monitor.start();
    applyBackgroundSettings();
  }
  if (SMOKE) void runSmokeTest(vault, seed.reports.length);
}

app.whenReady().then(init).catch((e) => {
  if ((e as Error).message === 'exit') return;
  dialog.showErrorBox('NetAdmin Desk — ошибка запуска', String((e as Error)?.stack ?? e));
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (keepRunningInBackground() && !quitting && !SMOKE) return;
  if (process.platform !== 'darwin' || SMOKE) app.quit();
});

app.on('activate', () => {
  if (!win && db) createWindow();
  else win?.show();
});

app.on('before-quit', () => {
  quitting = true;
  try {
    passwords?.lock('quit');
    monitor?.stop();
    tray?.destroy();
    tunnels?.stopAll();
    localTools?.stopAll();
    sessions?.disconnectAll();
    db?.close();
    db = null;
  } catch {
    /* ignore */
  }
});
