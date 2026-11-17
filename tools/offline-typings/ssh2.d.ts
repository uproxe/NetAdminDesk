// Минимальные заглушки типов ssh2 для офлайн-проверки (в CI используются @types/ssh2).
declare module 'ssh2' {
  import { EventEmitter } from 'node:events';
  import { Duplex } from 'node:stream';
  export interface ClientChannel extends Duplex {
    stderr: Duplex;
    setWindow(rows: number, cols: number, height: number, width: number): void;
    close(): void;
  }
  export interface Attrs { mode: number; size: number; mtime: number; atime: number; uid: number; gid: number }
  export interface FileEntry { filename: string; longname: string; attrs: Attrs }
  export interface SFTPWrapper {
    readdir(p: string, cb: (err: Error | undefined, list: FileEntry[]) => void): void;
    realpath(p: string, cb: (err: Error | undefined, abs: string) => void): void;
    fastGet(r: string, l: string, cb: (err?: Error) => void): void;
    fastPut(l: string, r: string, cb: (err?: Error) => void): void;
    mkdir(p: string, cb: (err?: Error) => void): void;
    rename(a: string, b: string, cb: (err?: Error) => void): void;
    rmdir(p: string, cb: (err?: Error) => void): void;
    unlink(p: string, cb: (err?: Error) => void): void;
    stat(p: string, cb: (err: Error | undefined, st: Attrs) => void): void;
  }
  export interface ConnectConfig {
    host?: string; port?: number; username?: string; password?: string; privateKey?: Buffer | string; passphrase?: string;
    agent?: string; readyTimeout?: number; keepaliveInterval?: number; keepaliveCountMax?: number; tryKeyboard?: boolean;
    hostVerifier?: unknown; algorithms?: Record<string, unknown>; sock?: unknown;
  }
  export const utils: Record<string, unknown>;
  export interface Prompt { prompt: string; echo?: boolean }
  export interface TcpConnectionDetails { destIP: string; destPort: number; srcIP: string; srcPort: number }
  export class Client extends EventEmitter {
    connect(cfg: ConnectConfig): this;
    end(): this;
    shell(win: Record<string, unknown>, cb: (err: Error | undefined, ch: ClientChannel) => void): this;
    exec(cmd: string, cb: (err: Error | undefined, ch: ClientChannel) => void): this;
    sftp(cb: (err: Error | undefined, s: SFTPWrapper) => void): this;
    forwardOut(sIP: string, sPort: number, dIP: string, dPort: number, cb: (err: Error | undefined, ch: ClientChannel) => void): this;
    forwardIn(addr: string, port: number, cb: (err: Error | undefined, port: number) => void): this;
    unforwardIn(addr: string, port: number, cb: (err?: Error) => void): this;
    on(ev: 'keyboard-interactive', l: (name: string, instructions: string, lang: string, prompts: Prompt[], finish: (answers: string[]) => void) => void): this;
    on(ev: 'tcp connection', l: (details: TcpConnectionDetails, accept: () => ClientChannel, reject: () => void) => void): this;
    on(ev: string, l: (...a: any[]) => void): this;
  }
}
