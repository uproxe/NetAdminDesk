// Минимальные заглушки типов Electron для офлайн-проверки (в CI используются настоящие типы).
declare module 'electron' {
  import { EventEmitter } from 'node:events';
  export interface WebContents extends EventEmitter {
    send(channel: string, ...args: unknown[]): void;
    setZoomFactor(f: number): void;
    setWindowOpenHandler(h: (d: { url: string }) => { action: 'deny' | 'allow' }): void;
    on(event: string, l: (...a: any[]) => void): this;
  }
  export class BrowserWindow extends EventEmitter {
    constructor(opts: Record<string, unknown>);
    webContents: WebContents;
    isDestroyed(): boolean;
    isMinimized(): boolean;
    restore(): void;
    focus(): void;
    show(): void;
    hide(): void;
    isVisible(): boolean;
    loadFile(p: string): Promise<void>;
  }
  export interface NativeImage {
    resize(o: { width?: number; height?: number }): NativeImage;
    isEmpty(): boolean;
  }
  export const nativeImage: { createFromPath(p: string): NativeImage; createEmpty(): NativeImage };
  export const powerMonitor: EventEmitter;
  export class Tray extends EventEmitter {
    constructor(image: NativeImage | string);
    setToolTip(t: string): void;
    setContextMenu(m: unknown): void;
    destroy(): void;
    isDestroyed(): boolean;
  }
  export class Notification extends EventEmitter {
    constructor(o: { title: string; body?: string; silent?: boolean });
    static isSupported(): boolean;
    show(): void;
  }
  export interface IpcMainInvokeEvent { sender: WebContents }
  export const ipcMain: { handle(ch: string, h: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void };
  export interface IpcRendererEvent { sender: unknown }
  export const ipcRenderer: {
    invoke(ch: string, ...args: unknown[]): Promise<unknown>;
    on(ch: string, l: (e: IpcRendererEvent, ...args: any[]) => void): void;
    removeListener(ch: string, l: (...args: any[]) => void): void;
  };
  export const contextBridge: { exposeInMainWorld(key: string, api: unknown): void };
  export const app: {
    getPath(name: string): string;
    setPath(name: string, p: string): void;
    getVersion(): string;
    whenReady(): Promise<void>;
    on(ev: string, l: (...a: any[]) => void): void;
    quit(): void;
    exit(code?: number): void;
    relaunch(): void;
    requestSingleInstanceLock(): boolean;
    setLoginItemSettings(o: { openAtLogin: boolean; args?: string[] }): void;
    isPackaged: boolean;
  };
  export const dialog: {
    showOpenDialog(w: BrowserWindow, o: Record<string, unknown>): Promise<{ canceled: boolean; filePaths: string[] }>;
    showSaveDialog(w: BrowserWindow, o: Record<string, unknown>): Promise<{ canceled: boolean; filePath?: string }>;
    showMessageBox(o: Record<string, unknown>): Promise<{ response: number }>;
    showErrorBox(t: string, c: string): void;
  };
  export const shell: { openExternal(u: string): Promise<void>; showItemInFolder(p: string): void; openPath(p: string): Promise<string> };
  export const clipboard: { writeText(t: string): void; readText(): string };
  export const safeStorage: { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string };
  export const session: { defaultSession: { setPermissionRequestHandler(h: (wc: unknown, perm: string, cb: (ok: boolean) => void) => void): void } };
  export interface MenuItemConstructorOptions { label?: string; role?: string; type?: string; accelerator?: string; click?: () => void; submenu?: MenuItemConstructorOptions[] }
  export const Menu: { setApplicationMenu(m: unknown): void; buildFromTemplate(t: MenuItemConstructorOptions[]): unknown };
}
