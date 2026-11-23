// Отправка писем по SMTP без внешних библиотек: SMTPS (порт 465), STARTTLS (587) или без шифрования (25).
// Авторизация AUTH PLAIN / LOGIN. Текст письма — UTF-8 в base64.
import net from 'node:net';
import tls from 'node:tls';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface SmtpConfig {
  host: string;
  port: number;
  security: 'starttls' | 'tls' | 'none';
  user?: string;
  password?: string;
  from: string;
  to: string[];
  /** Не проверять сертификат сервера (самоподписанный во внутренней сети). */
  allowInvalidCert?: boolean;
  timeoutMs?: number;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addr = (s: string) => /<([^>]+)>/.exec(s)?.[1]?.trim() ?? s.trim();

export function splitAddresses(list: string): string[] {
  return list
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function validEmail(s: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr(s));
}

/** Письмо в формате RFC 5322 (текст в base64, строки по 76 символов). */
export function buildMessage(cfg: Pick<SmtpConfig, 'from' | 'to'>, subject: string, text: string, date = new Date()): string {
  const body = b64(text.replace(/\r?\n/g, '\r\n'))
    .replace(/.{76}/g, '$&\r\n')
    .replace(/\r\n$/, '');
  const domain = addr(cfg.from).split('@')[1] ?? 'localhost';
  return [
    `From: ${cfg.from}`,
    `To: ${cfg.to.join(', ')}`,
    `Subject: ${encWord(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'X-Mailer: NetAdmin Desk',
    '',
    body,
    ''
  ].join('\r\n');
}

class SmtpConn {
  private buf = '';
  private waiters: ((line: { code: number; text: string; lines: string[] }) => void)[] = [];
  private lines: string[] = [];
  private failed: Error | null = null;
  private onFail: ((e: Error) => void)[] = [];

  constructor(public sock: net.Socket) {
    this.attach(sock);
  }

  attach(sock: net.Socket): void {
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        this.lines.push(line);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const all = this.lines;
          this.lines = [];
          const w = this.waiters.shift();
          w?.({ code: Number(line.slice(0, 3)), text: all.map((l) => l.slice(4)).join('\n'), lines: all });
        }
      }
    });
    const fail = (e: Error) => {
      this.failed = e;
      for (const f of this.onFail.splice(0)) f(e);
    };
    sock.on('error', fail);
    sock.on('close', () => fail(new Error('сервер закрыл соединение')));
  }

  reply(timeoutMs: number): Promise<{ code: number; text: string; lines: string[] }> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('сервер не ответил вовремя')), timeoutMs);
      this.onFail.push((e) => {
        clearTimeout(t);
        reject(e);
      });
      this.waiters.push((r) => {
        clearTimeout(t);
        this.onFail = [];
        resolve(r);
      });
    });
  }

  async cmd(line: string, expect: number[], timeoutMs: number, hide = false): Promise<{ code: number; text: string; lines: string[] }> {
    this.sock.write(`${line}\r\n`);
    const r = await this.reply(timeoutMs);
    if (!expect.includes(r.code)) throw new Error(`${hide ? line.split(' ')[0] : line.split(':')[0]}: ${r.code} ${r.text}`.trim());
    return r;
  }
}

function connect(cfg: SmtpConfig, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const opts = { host: cfg.host, port: cfg.port };
    const sock =
      cfg.security === 'tls'
        ? tls.connect({ ...opts, servername: net.isIP(cfg.host) ? undefined : cfg.host, rejectUnauthorized: !cfg.allowInvalidCert }, () => resolve(sock))
        : net.connect(opts, () => resolve(sock));
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error('нет соединения с почтовым сервером (таймаут)')));
    sock.once('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'ECONNREFUSED' ? `почтовый сервер ${cfg.host}:${cfg.port} не принимает соединения` : e.code === 'ENOTFOUND' ? `сервер ${cfg.host} не найден в DNS` : e.message))
    );
  });
}

function upgrade(conn: SmtpConn, cfg: SmtpConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const old = conn.sock;
    old.removeAllListeners('data');
    old.removeAllListeners('close');
    old.removeAllListeners('error');
    const s = tls.connect({ socket: old, servername: net.isIP(cfg.host) ? undefined : cfg.host, rejectUnauthorized: !cfg.allowInvalidCert }, () => {
      conn.attach(s);
      resolve();
    });
    s.once('error', reject);
  });
}

/** Отправить письмо. Ошибка содержит понятное описание шага, на котором сервер отказал. */
export async function sendMail(cfg: SmtpConfig, subject: string, text: string): Promise<void> {
  const timeout = cfg.timeoutMs ?? 15000;
  if (!cfg.host) throw new Error('не указан почтовый сервер');
  if (!validEmail(cfg.from)) throw new Error('неверный адрес отправителя');
  if (!cfg.to.length || !cfg.to.every(validEmail)) throw new Error('неверный адрес получателя');
  const conn = new SmtpConn(await connect(cfg, timeout));
  try {
    const hello = await conn.reply(timeout);
    if (hello.code !== 220) throw new Error(`сервер не готов: ${hello.code} ${hello.text}`);
    const me = hostname().replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost';
    let ehlo = await conn.cmd(`EHLO ${me}`, [250], timeout);
    if (cfg.security === 'starttls') {
      if (!/^STARTTLS\b/im.test(ehlo.lines.map((l) => l.slice(4)).join('\n'))) throw new Error('сервер не поддерживает STARTTLS — выберите «SSL/TLS» или «без шифрования»');
      await conn.cmd('STARTTLS', [220], timeout);
      try {
        await upgrade(conn, cfg);
      } catch (e) {
        throw new Error(`не удалось установить TLS: ${(e as Error).message}${/certificate|self.signed/i.test((e as Error).message) ? ' (сертификат сервера не прошёл проверку)' : ''}`);
      }
      ehlo = await conn.cmd(`EHLO ${me}`, [250], timeout);
    }
    if (cfg.user) {
      const caps = ehlo.lines.map((l) => l.slice(4)).join('\n');
      const auth = /^AUTH[ =](.*)$/im.exec(caps)?.[1]?.toUpperCase() ?? '';
      if (auth.includes('PLAIN')) await conn.cmd(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.password ?? ''}`)}`, [235], timeout, true);
      else if (auth.includes('LOGIN')) {
        await conn.cmd('AUTH LOGIN', [334], timeout);
        await conn.cmd(b64(cfg.user), [334], timeout, true);
        await conn.cmd(b64(cfg.password ?? ''), [235], timeout, true);
      } else throw new Error('сервер не предлагает авторизацию PLAIN/LOGIN (возможно, нужен STARTTLS)');
    }
    await conn.cmd(`MAIL FROM:<${addr(cfg.from)}>`, [250], timeout);
    for (const r of cfg.to) await conn.cmd(`RCPT TO:<${addr(r)}>`, [250, 251], timeout);
    await conn.cmd('DATA', [354], timeout);
    const msg = buildMessage(cfg, subject, text).replace(/^\./gm, '..');
    await conn.cmd(`${msg}\r\n.`, [250], timeout, true);
    try {
      await conn.cmd('QUIT', [221], 3000);
    } catch {
      /* письмо уже принято */
    }
  } finally {
    conn.sock.destroy();
  }
}
