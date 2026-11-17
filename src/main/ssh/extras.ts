// SFTP и SSH-туннели (local / remote / dynamic SOCKS5).
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Client, SFTPWrapper } from 'ssh2';
import type { SftpEntry, TunnelInfo, TunnelSpec } from '../../shared/types';

// ---------- SFTP ----------

function modeString(mode: number): string {
  const type = (mode & 0o170000) === 0o040000 ? 'd' : (mode & 0o170000) === 0o120000 ? 'l' : '-';
  const bits = ['r', 'w', 'x'];
  let s = type;
  for (let i = 8; i >= 0; i--) s += mode & (1 << i) ? bits[(8 - i) % 3] : '-';
  return s;
}

export function sftpList(sftp: SFTPWrapper, path: string): Promise<SftpEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) return reject(new Error(`Не удалось открыть ${path}: ${err.message}`));
      resolve(
        list
          .map((e) => ({
            name: e.filename,
            path: posix.join(path, e.filename),
            isDir: (e.attrs.mode & 0o170000) === 0o040000,
            size: e.attrs.size,
            mtime: e.attrs.mtime * 1000,
            mode: modeString(e.attrs.mode)
          }))
          .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
      );
    });
  });
}

export function sftpRealpath(sftp: SFTPWrapper, path = '.'): Promise<string> {
  return new Promise((resolve, reject) => sftp.realpath(path, (err, p) => (err ? reject(err) : resolve(p))));
}

export function sftpDownload(sftp: SFTPWrapper, remote: string, local: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.fastGet(remote, local, (err) => (err ? reject(new Error(`Ошибка загрузки ${remote}: ${err.message}`)) : resolve())));
}

export function sftpUpload(sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.fastPut(local, remote, (err) => (err ? reject(new Error(`Ошибка выгрузки в ${remote}: ${err.message}`)) : resolve())));
}

export function sftpMkdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.mkdir(path, (err) => (err ? reject(err) : resolve())));
}

export function sftpRename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.rename(from, to, (err) => (err ? reject(err) : resolve())));
}

export function sftpRemove(sftp: SFTPWrapper, path: string, isDir: boolean): Promise<void> {
  return new Promise((resolve, reject) => (isDir ? sftp.rmdir(path, (err) => (err ? reject(err) : resolve())) : sftp.unlink(path, (err) => (err ? reject(err) : resolve()))));
}

function sftpStat(sftp: SFTPWrapper, path: string): Promise<{ isDir: boolean; size: number }> {
  return new Promise((resolve, reject) =>
    sftp.stat(path, (err, st) => (err ? reject(new Error(`${path}: ${err.message}`)) : resolve({ isDir: (st.mode & 0o170000) === 0o040000, size: st.size })))
  );
}

/** Рекурсивная загрузка файлов и каталогов. Возвращает список загруженных файлов и общий размер. */
export async function sftpDownloadTree(
  sftp: SFTPWrapper,
  remote: string,
  localDir: string,
  limits = { maxFiles: 5000, maxBytes: 2 * 1024 ** 3 }
): Promise<{ files: string[]; bytes: number; errors: string[] }> {
  const files: string[] = [];
  const errors: string[] = [];
  let bytes = 0;
  const walk = async (r: string, l: string) => {
    if (files.length >= limits.maxFiles || bytes >= limits.maxBytes) return;
    let st: { isDir: boolean; size: number };
    try {
      st = await sftpStat(sftp, r);
    } catch (e) {
      errors.push((e as Error).message);
      return;
    }
    if (st.isDir) {
      mkdirSync(l, { recursive: true });
      let entries: SftpEntry[] = [];
      try {
        entries = await sftpList(sftp, r);
      } catch (e) {
        errors.push((e as Error).message);
        return;
      }
      for (const e of entries) if (e.name !== '.' && e.name !== '..') await walk(e.path, join(l, e.name));
    } else {
      try {
        mkdirSync(join(l, '..'), { recursive: true });
        await sftpDownload(sftp, r, l);
        files.push(r);
        bytes += statSync(l).size;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  };
  await walk(remote, join(localDir, remote.replace(/^\/+/, '').replace(/[:*?"<>|]/g, '_')));
  return { files, bytes, errors };
}

// ---------- Туннели ----------

interface TunnelEntry {
  info: TunnelInfo;
  client: Client;
  close: () => void;
}

export class TunnelManager {
  private tunnels = new Map<string, TunnelEntry>();
  private remoteHandlers = new WeakMap<Client, Map<number, { host: string; port: number; id: string }>>();
  onChange: (list: TunnelInfo[]) => void = () => {};

  list(): TunnelInfo[] {
    return [...this.tunnels.values()].map((t) => t.info);
  }

  private changed(): void {
    this.onChange(this.list());
  }

  async start(spec: TunnelSpec, client: Client): Promise<TunnelInfo> {
    const id = randomUUID();
    const info: TunnelInfo = { ...spec, id, status: 'listening', connections: 0 };
    if (spec.type === 'remote') {
      await new Promise<void>((resolve, reject) => client.forwardIn(spec.bindHost, spec.bindPort, (err) => (err ? reject(new Error(`forwardIn: ${err.message}`)) : resolve())));
      let map = this.remoteHandlers.get(client);
      if (!map) {
        map = new Map();
        this.remoteHandlers.set(client, map);
        const m = map;
        client.on('tcp connection', (details, accept, reject) => {
          const target = m.get(details.destPort);
          if (!target) return reject();
          const ch = accept();
          const sock = net.connect(target.port, target.host);
          const t = this.tunnels.get(target.id);
          if (t) {
            t.info.connections++;
            this.changed();
          }
          ch.pipe(sock).pipe(ch);
          sock.on('error', () => ch.close());
          ch.on('close', () => {
            sock.destroy();
            if (t) {
              t.info.connections = Math.max(0, t.info.connections - 1);
              this.changed();
            }
          });
        });
      }
      map.set(spec.bindPort, { host: spec.targetHost, port: spec.targetPort, id });
      this.tunnels.set(id, {
        info,
        client,
        close: () => {
          map!.delete(spec.bindPort);
          client.unforwardIn(spec.bindHost, spec.bindPort, () => undefined);
        }
      });
      this.changed();
      return info;
    }

    const server = net.createServer((sock) => {
      const entry = this.tunnels.get(id);
      if (entry) {
        entry.info.connections++;
        this.changed();
      }
      sock.on('close', () => {
        if (entry) {
          entry.info.connections = Math.max(0, entry.info.connections - 1);
          this.changed();
        }
      });
      sock.on('error', () => sock.destroy());
      if (spec.type === 'local') {
        client.forwardOut(sock.remoteAddress ?? '127.0.0.1', sock.remotePort ?? 0, spec.targetHost, spec.targetPort, (err, ch) => {
          if (err) return sock.destroy();
          sock.pipe(ch).pipe(sock);
        });
      } else {
        handleSocks5(sock, client);
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', (e) => reject(new Error(`Не удалось открыть порт ${spec.bindHost}:${spec.bindPort}: ${e.message}`)));
      server.listen(spec.bindPort, spec.bindHost, () => resolve());
    });
    // Порт 0 — система выбирает свободный порт; показываем фактический.
    const addr = server.address();
    if (addr && typeof addr === 'object') info.bindPort = addr.port;
    this.tunnels.set(id, { info, client, close: () => server.close() });
    this.changed();
    return info;
  }

  stop(id: string): void {
    const t = this.tunnels.get(id);
    if (!t) return;
    try {
      t.close();
    } catch {
      /* ignore */
    }
    this.tunnels.delete(id);
    this.changed();
  }

  stopForSession(sessionId: string): void {
    for (const [id, t] of this.tunnels) if (t.info.sessionId === sessionId) this.stop(id);
  }

  stopAll(): void {
    for (const id of [...this.tunnels.keys()]) this.stop(id);
  }
}

/** Минимальный SOCKS5 (без аутентификации, команда CONNECT). */
export function handleSocks5(sock: net.Socket, client: Client): void {
  sock.once('data', (greet: Buffer) => {
    if (greet[0] !== 0x05) return sock.destroy();
    sock.write(Buffer.from([0x05, 0x00]));
    sock.once('data', (req: Buffer) => {
      if (req[0] !== 0x05 || req[1] !== 0x01) {
        sock.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        return;
      }
      let host = '';
      let offset = 4;
      if (req[3] === 0x01) {
        host = [...req.subarray(4, 8)].join('.');
        offset = 8;
      } else if (req[3] === 0x03) {
        const len = req[4];
        host = req.subarray(5, 5 + len).toString('utf8');
        offset = 5 + len;
      } else if (req[3] === 0x04) {
        const parts: string[] = [];
        for (let i = 0; i < 16; i += 2) parts.push(req.readUInt16BE(4 + i).toString(16));
        host = parts.join(':');
        offset = 20;
      } else {
        sock.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        return;
      }
      const port = req.readUInt16BE(offset);
      client.forwardOut('127.0.0.1', 0, host, port, (err, ch) => {
        if (err) {
          sock.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return;
        }
        sock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        sock.pipe(ch).pipe(sock);
      });
    });
  });
}
