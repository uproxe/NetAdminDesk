// SSH-сессия: интерактивный PTY-shell (для коммутаторов и Linux), захват вывода команд,
// exec (только Linux), SFTP, проверка ключа хоста, устаревшие алгоритмы — по устройству.
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import type { ExecResult } from '../../shared/types';
import { ShellSession } from './shell';

export interface HostKeyInfo {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  keyB64: string;
  deviceName: string;
}

export interface SessionCallbacks {
  verifyHostKey(info: HostKeyInfo): Promise<boolean>;
  keyboardInteractive(req: { deviceName: string; name: string; instructions: string; prompts: { prompt: string; echo: boolean }[] }): Promise<string[] | null>;
}

export interface ConnectTarget {
  deviceId: number;
  deviceName: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key' | 'agent' | 'keyboard-interactive';
  password?: string;
  privateKey?: Buffer;
  passphrase?: string;
  legacyAlgorithms: boolean;
  keepaliveSec: number;
  timeoutSec: number;
  platform: string;
  /** Тип ключа, ранее принятого для этого хоста (для приоритета алгоритма). */
  knownKeyType?: string;
  /** Дополнительное время на рукопожатие, если возможен диалог с пользователем (новый ключ хоста, keyboard-interactive). */
  extraReadyMs?: number;
}

export function readSshString(buf: Buffer, offset = 0): string {
  if (buf.length < offset + 4) return 'unknown';
  const len = buf.readUInt32BE(offset);
  return buf.subarray(offset + 4, offset + 4 + len).toString('ascii');
}

export function fingerprintSha256(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** Устаревшие алгоритмы добавляются только для конкретного устройства (RegExp — только поддерживаемые). */
export function legacyAlgorithms(): ConnectConfig['algorithms'] {
  return {
    kex: { append: [/^diffie-hellman-group-exchange-sha1$/, /^diffie-hellman-group14-sha1$/, /^diffie-hellman-group1-sha1$/] },
    cipher: { append: [/^aes(128|192|256)-cbc$/, /^3des-cbc$/] },
    serverHostKey: { append: [/^ssh-rsa$/, /^ssh-dss$/] },
    hmac: { append: [/^hmac-sha1$/, /^hmac-md5$/] }
  } as unknown as ConnectConfig['algorithms'];
}

function defaultAgent(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK;
  if (process.platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent';
  return undefined;
}

export function buildConnectConfig(t: ConnectTarget, cb: SessionCallbacks, sock?: NodeJS.ReadableStream): ConnectConfig {
  const algorithms: Record<string, unknown> = t.legacyAlgorithms ? { ...(legacyAlgorithms() as object) } : {};
  if (t.knownKeyType) {
    const prefer = t.knownKeyType === 'ssh-rsa' ? ['rsa-sha2-512', 'rsa-sha2-256'] : [t.knownKeyType];
    const cur = (algorithms.serverHostKey as Record<string, unknown>) ?? {};
    algorithms.serverHostKey = { remove: prefer, prepend: prefer, ...(cur.append ? { append: cur.append } : {}) };
  }
  const cfg: ConnectConfig = {
    host: t.host,
    port: t.port,
    username: t.username,
    readyTimeout: Math.max(5, t.timeoutSec) * 1000 + (t.extraReadyMs ?? 0),
    keepaliveInterval: Math.max(0, t.keepaliveSec) * 1000,
    keepaliveCountMax: 3,
    tryKeyboard: true,
    hostVerifier: ((key: Buffer, verify: (ok: boolean) => void) => {
      const info: HostKeyInfo = {
        host: t.host,
        port: t.port,
        keyType: readSshString(key),
        fingerprint: fingerprintSha256(key),
        keyB64: key.toString('base64'),
        deviceName: t.deviceName
      };
      cb.verifyHostKey(info).then(
        (ok) => verify(ok),
        () => verify(false)
      );
    }) as unknown as ConnectConfig['hostVerifier']
  };
  if (Object.keys(algorithms).length) cfg.algorithms = algorithms as ConnectConfig['algorithms'];
  if (sock) (cfg as Record<string, unknown>).sock = sock;
  if (t.authMethod === 'key' && t.privateKey) {
    cfg.privateKey = t.privateKey;
    if (t.passphrase) cfg.passphrase = t.passphrase;
  }
  if (t.authMethod === 'agent') cfg.agent = defaultAgent();
  if (t.password) cfg.password = t.password;
  return cfg;
}

export type { CaptureOptions } from './shell';

/** Сессия SSH. События: data(chunk), status(info), typed({line, uncertain}), closed. */
export class SshSession extends ShellSession {
  private client = new Client();
  private jump: Client | null = null;
  private decoder = new StringDecoder('utf8');

  constructor(private target: ConnectTarget, private cb: SessionCallbacks) {
    super(target, 'ssh');
  }

  /** Подключение (через промежуточный сервер, если задан jump). */
  async connect(size: { cols: number; rows: number }, jump?: ConnectTarget): Promise<void> {
    this.cols = size.cols;
    this.rows = size.rows;
    let sock: NodeJS.ReadableStream | undefined;
    if (jump) {
      this.jump = new Client();
      await this.connectClient(this.jump, jump);
      sock = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
        this.jump!.forwardOut('127.0.0.1', 0, this.target.host, this.target.port, (err, ch) => (err ? reject(err) : resolve(ch)));
      });
    }
    this.client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
      const pw = this.target.password;
      if (pw && prompts.length === 1 && /pass|парол/i.test(prompts[0].prompt)) return finish([pw]);
      if (!prompts.length) return finish([]);
      this.cb
        .keyboardInteractive({ deviceName: this.target.deviceName, name, instructions, prompts: prompts.map((p) => ({ prompt: p.prompt, echo: !!p.echo })) })
        .then((answers) => finish(answers ?? []))
        .catch(() => finish([]));
    });
    this.setStatus('authenticating');
    await this.connectClient(this.client, this.target, sock);
    this.client.on('close', () => {
      this.setStatus('closed');
      this.emit('closed');
      this.jump?.end();
    });
    this.client.on('error', (e) => this.setStatus('error', e.message));
    await this.openShell();
    this.setStatus('ready');
  }

  private connectClient(c: Client, t: ConnectTarget, sock?: NodeJS.ReadableStream): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      // ssh2 может выдать несколько событий 'error' подряд (например, ECONNRESET, затем
      // «Connection lost before handshake»). Обработчик остаётся навсегда, иначе повторное
      // событие без обработчика роняет главный процесс.
      c.on('error', (e: Error) => {
        if (settled) {
          this.lastError = e.message;
          return;
        }
        settled = true;
        c.removeListener('ready', onReady);
        reject(humanizeSshError(e, t));
      });
      const onReady = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      c.once('ready', onReady);
      c.once('close', () => {
        if (settled) return;
        settled = true;
        reject(humanizeSshError(new Error('Connection lost before handshake'), t));
      });
      try {
        c.connect(buildConnectConfig(t, this.cb, sock));
      } catch (e) {
        settled = true;
        reject(humanizeSshError(e as Error, t));
      }
    });
  }

  private openShell(): Promise<void> {
    const isLinux = this.target.platform === 'linux';
    return new Promise((resolve, reject) => {
      this.client.shell({ term: isLinux ? 'xterm-256color' : 'vt100', cols: this.cols, rows: this.rows }, (err, stream: ClientChannel) => {
        if (err) return reject(err);
        this.transport = {
          write: (d) => void stream.write(d),
          resize: (cols, rows) => stream.setWindow(rows, cols, 0, 0),
          end: () => void stream.end()
        };
        stream.on('data', (d: Buffer) => this.onOutput(this.decoder.write(d)));
        stream.stderr?.on('data', (d: Buffer) => this.onOutput(d.toString('utf8')));
        stream.on('close', () => this.client.end());
        resolve();
      });
    });
  }

  /** SSH exec — только для Linux; на коммутаторах используется shell. */
  override exec(command: string, timeoutMs = 60000): Promise<ExecResult> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, ch) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        const t = setTimeout(() => {
          ch.close();
          resolve({ command, stdout, stderr: `${stderr}\n[превышено время ожидания ${timeoutMs / 1000} с]`, code: null, durationMs: Date.now() - started });
        }, timeoutMs);
        ch.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
        ch.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
        ch.on('close', (code: number | null) => {
          clearTimeout(t);
          resolve({ command, stdout, stderr, code: code ?? null, durationMs: Date.now() - started });
        });
      });
    });
  }

  sftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => this.client.sftp((err, s) => (err ? reject(err) : resolve(s))));
  }

  get sshClient(): Client {
    return this.client;
  }

  close(): void {
    try {
      this.transport?.end();
    } catch {
      /* ignore */
    }
    this.client.end();
    this.jump?.end();
  }
}

export function humanizeSshError(e: Error & { level?: string; code?: string }, t: { host: string; port: number }): Error {
  const m = e.message || String(e);
  if ((e as Error & { original?: string }).original) return e;
  let text = m;
  if (/All configured authentication methods failed/i.test(m)) text = 'Аутентификация не удалась: неверный логин, пароль или ключ.';
  else if (/ECONNREFUSED/.test(m) || e.code === 'ECONNREFUSED') text = `Подключение отклонено: на ${t.host}:${t.port} не запущен SSH-сервер или порт закрыт.`;
  else if (/ECONNRESET|Connection lost before handshake|ECONNABORTED|EPIPE|socket hang up/i.test(m) || e.code === 'ECONNRESET')
    text = [
      `Сервер ${t.host}:${t.port} разорвал соединение до начала SSH-рукопожатия (${m}).`,
      'Возможные причины:',
      ' • ваш IP заблокирован на сервере (fail2ban, firewall, лимит неудачных входов);',
      ' • на этом порту работает не SSH, или SSH-сервер перегружен (MaxStartups);',
      ' • соединение режет провайдер, VPN или межсетевой экран по пути;',
      ' • для старых коммутаторов — нужны устаревшие алгоритмы (карточка устройства → «Дополнительно»).',
      'Что проверить: кнопка «Проверить подключение» над терминалом; в Windows — Test-NetConnection ' + t.host + ' -Port ' + t.port + ';',
      'на сервере (через консоль хостинга): journalctl -u ssh -n 50 и fail2ban-client status sshd.'
    ].join('\n');
  else if (/ETIMEDOUT|Timed out while waiting for handshake/i.test(m))
    text = `Истекло время ожидания подключения к ${t.host}:${t.port}. Узел не отвечает: проверьте адрес, порт, VPN и что порт открыт в firewall.`;
  else if (/Keepalive timeout/i.test(m)) text = 'Сервер перестал отвечать (истёк keepalive). Возможно, пропала связь или сервер перегружен.';
  else if (/Protocol mismatch|Bad identification|Unsupported protocol version|Invalid SSH identification/i.test(m))
    text = `На ${t.host}:${t.port} отвечает не SSH-сервер (${m}). Проверьте номер порта.`;
  else if (/ENOTFOUND|EAI_AGAIN/.test(m)) text = `Не удалось найти адрес для имени «${t.host}» (DNS). Проверьте написание или укажите IP-адрес.`;
  else if (/EHOSTUNREACH|ENETUNREACH/.test(m)) text = `Узел ${t.host} недоступен (нет маршрута).`;
  else if (/no matching (key exchange|cipher|host key|MAC)|Handshake failed/i.test(m))
    text = `Не согласованы алгоритмы SSH (${m}). Для старого оборудования включите в карточке устройства «Разрешить устаревшие алгоритмы».`;
  else if (/host key|Host denied/i.test(m)) text = 'Ключ хоста не принят — подключение прервано.';
  else if (/Cannot parse privateKey|Encrypted private key detected|bad passphrase/i.test(m)) text = `Проблема с приватным ключом: ${m}`;
  const err = new Error(text);
  (err as Error & { original?: string }).original = m;
  return err;
}
