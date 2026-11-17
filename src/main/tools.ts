// Сетевые утилиты с этого компьютера: ping, трассировка, проверка TCP-портов, создание SSH-ключа.
// Запускаются только по кнопке пользователя; точная команда показывается в интерфейсе, вывод — целиком.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { generateEd25519 } from './sshkey';

export type LocalTool = 'ping' | 'traceroute';

/** Имя узла или IP-адрес (без пробелов и управляющих символов): защита от подстановки аргументов. */
export function validHost(h: string): boolean {
  return /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9.\-]*[a-zA-Z0-9])?$/.test(h) || /^[0-9a-fA-F:]+$/.test(h);
}

export function toolCommand(tool: LocalTool, host: string, platform: NodeJS.Platform = process.platform): { file: string; args: string[]; fallback?: { file: string; args: string[] } } {
  if (tool === 'ping') {
    if (platform === 'win32') return { file: 'ping', args: ['-n', '4', '-w', '2000', host] };
    if (platform === 'darwin') return { file: 'ping', args: ['-c', '4', '-W', '2000', host] };
    return { file: 'ping', args: ['-c', '4', '-W', '2', host] };
  }
  if (platform === 'win32') return { file: 'tracert', args: ['-d', '-w', '1000', '-h', '20', host] };
  return { file: 'traceroute', args: ['-n', '-w', '2', '-m', '20', host], fallback: { file: 'tracepath', args: ['-n', host] } };
}

export class LocalTools {
  private runs = new Map<string, ChildProcess>();
  constructor(private emit: (e: { type: 'tools:output'; runId: string; chunk: string } | { type: 'tools:done'; runId: string; code: number | null }) => void) {}

  run(tool: LocalTool, host: string): { runId: string; commandLine: string } {
    host = host.trim();
    if (!validHost(host)) throw new Error('Укажите IP-адрес или имя узла без пробелов и спецсимволов');
    const cmd = toolCommand(tool, host);
    const runId = randomUUID();
    const start = (c: { file: string; args: string[] }, canFallback: boolean) => {
      const p = spawn(c.file, c.args, { windowsHide: true });
      this.runs.set(runId, p);
      // В Windows консольные утилиты пишут в кодировке OEM (для русской Windows — CP866).
      const dec = new TextDecoder(process.platform === 'win32' ? 'ibm866' : 'utf-8');
      const out = (b: Buffer) => this.emit({ type: 'tools:output', runId, chunk: dec.decode(b, { stream: true }) });
      p.stdout?.on('data', out);
      p.stderr?.on('data', out);
      p.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT' && canFallback && cmd.fallback) {
          this.emit({ type: 'tools:output', runId, chunk: `${c.file} не установлен, пробую ${cmd.fallback.file}…\n` });
          return start(cmd.fallback, false);
        }
        this.emit({ type: 'tools:output', runId, chunk: e.code === 'ENOENT' ? `Программа ${c.file} не найдена в системе.${tool === 'traceroute' ? ' В Debian/Ubuntu: sudo apt install traceroute' : ''}\n` : `${e.message}\n` });
        this.runs.delete(runId);
        this.emit({ type: 'tools:done', runId, code: null });
      });
      p.on('close', (code) => {
        if (this.runs.get(runId) !== p) return;
        this.runs.delete(runId);
        this.emit({ type: 'tools:done', runId, code });
      });
    };
    start(cmd, true);
    // Страховка от зависшей утилиты
    setTimeout(() => this.stop(runId), 120000);
    return { runId, commandLine: [cmd.file, ...cmd.args].join(' ') };
  }

  stop(runId: string): void {
    const p = this.runs.get(runId);
    if (p) {
      p.kill();
      this.runs.delete(runId);
      this.emit({ type: 'tools:done', runId, code: null });
    }
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id);
  }
}

export interface TcpCheck {
  port: number;
  ok: boolean;
  ms: number;
  text: string;
}

const PORT_NAMES: Record<number, string> = { 22: 'SSH', 23: 'Telnet', 80: 'HTTP', 443: 'HTTPS', 161: 'SNMP', 3389: 'RDP', 445: 'SMB', 3306: 'MySQL', 5432: 'PostgreSQL', 554: 'RTSP (камеры)', 8080: 'HTTP-alt', 10050: 'Zabbix agent', 10051: 'Zabbix server' };

export function tcpCheck(host: string, ports: number[], timeoutMs = 3000): Promise<TcpCheck[]> {
  host = host.trim();
  if (!validHost(host)) return Promise.reject(new Error('Укажите IP-адрес или имя узла'));
  const list = [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0 && p < 65536))].slice(0, 32);
  return Promise.all(
    list.map(
      (port) =>
        new Promise<TcpCheck>((resolve) => {
          const t0 = Date.now();
          const name = PORT_NAMES[port] ? ` (${PORT_NAMES[port]})` : '';
          const sock = net.connect({ host, port });
          const done = (ok: boolean, text: string) => {
            clearTimeout(timer);
            sock.destroy();
            resolve({ port, ok, ms: Date.now() - t0, text: `${port}${name}: ${text}` });
          };
          const timer = setTimeout(() => done(false, 'нет ответа (фильтруется или узел недоступен)'), timeoutMs);
          sock.on('connect', () => done(true, 'открыт'));
          sock.on('error', (e: NodeJS.ErrnoException) =>
            done(false, e.code === 'ECONNREFUSED' ? 'закрыт (служба не запущена)' : e.code === 'ENOTFOUND' ? 'имя не найдено в DNS' : e.code === 'EHOSTUNREACH' ? 'нет маршрута' : (e.code ?? e.message))
          );
        })
    )
  );
}

/** Создать ключ ed25519 и записать пару файлов: path (приватный, права 600) и path.pub. */
export function createSshKey(path: string, comment: string, passphrase: string | undefined, ssh2Utils: unknown, overwrite = false): { path: string; publicKey: string; fingerprint: string } {
  if (!path.trim()) throw new Error('Не указан файл ключа');
  if (!overwrite && (existsSync(path) || existsSync(`${path}.pub`))) throw new Error(`Файл ${path} уже существует. Выберите другое имя, чтобы не затереть рабочий ключ.`);
  const k = generateEd25519(comment, passphrase || undefined, ssh2Utils as Parameters<typeof generateEd25519>[2]);
  writeFileSync(path, k.privateKey, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* в Windows права задаются иначе */
  }
  writeFileSync(`${path}.pub`, `${k.publicKey}\n`, { mode: 0o644 });
  return { path, publicKey: k.publicKey, fingerprint: k.fingerprint };
}
