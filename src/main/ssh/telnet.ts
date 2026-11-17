// Telnet-сессия для старого оборудования, где нет SSH (Linksys, старые ProCurve, AT-8000S и т. п.).
// ВНИМАНИЕ: Telnet не шифрует трафик — логин, пароль и конфигурация передаются открытым текстом.
// Протокол включается только в карточке конкретного устройства; глобально ничего не ослабляется.
import { Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { ShellSession, type ShellTargetBase } from './shell';

export interface TelnetTarget extends ShellTargetBase {
  port: number;
  username: string;
  password?: string;
  timeoutSec: number;
  keepaliveSec: number;
}

// Команды и опции Telnet (RFC 854, 857, 858, 1073, 1091)
export const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const OPT_ECHO = 1;
const OPT_SGA = 3;
const OPT_TTYPE = 24;
const OPT_NAWS = 31;

/**
 * Разбор входящего потока Telnet: отделяет данные от команд IAC, отвечает на согласование опций.
 * Состояние сохраняется между кусками, поэтому команда может прийти частями.
 */
export class TelnetParser {
  private state: 'data' | 'iac' | 'opt' | 'sb' | 'sb-iac' = 'data';
  private verb = 0;
  private sbBuf: number[] = [];
  /** Опции, которые мы согласились выполнять сами (WILL), и которые разрешили серверу (DO). */
  readonly local = new Set<number>();
  readonly remote = new Set<number>();

  constructor(
    private send: (bytes: number[]) => void,
    private opts: { termType: string; size: () => { cols: number; rows: number } }
  ) {}

  /** Возвращает «чистые» данные без команд Telnet. */
  feed(chunk: Buffer): Buffer {
    const out: number[] = [];
    for (const b of chunk) {
      switch (this.state) {
        case 'data':
          if (b === IAC) this.state = 'iac';
          else out.push(b);
          break;
        case 'iac':
          if (b === IAC) {
            out.push(IAC);
            this.state = 'data';
          } else if (b === DO || b === DONT || b === WILL || b === WONT) {
            this.verb = b;
            this.state = 'opt';
          } else if (b === SB) {
            this.sbBuf = [];
            this.state = 'sb';
          } else this.state = 'data'; // NOP, GA, DM и прочие одиночные команды
          break;
        case 'opt':
          this.negotiate(this.verb, b);
          this.state = 'data';
          break;
        case 'sb':
          if (b === IAC) this.state = 'sb-iac';
          else if (this.sbBuf.length < 512) this.sbBuf.push(b);
          break;
        case 'sb-iac':
          if (b === SE) {
            this.subnegotiation(this.sbBuf);
            this.state = 'data';
          } else {
            if (b === IAC) this.sbBuf.push(IAC);
            this.state = 'sb';
          }
          break;
      }
    }
    return Buffer.from(out);
  }

  private negotiate(verb: number, opt: number): void {
    if (verb === DO) {
      const supported = opt === OPT_NAWS || opt === OPT_TTYPE || opt === OPT_SGA;
      if (!supported) return this.send([IAC, WONT, opt]);
      if (this.local.has(opt)) return;
      this.local.add(opt);
      this.send([IAC, WILL, opt]);
      if (opt === OPT_NAWS) this.sendSize();
    } else if (verb === DONT) {
      if (!this.local.has(opt)) return;
      this.local.delete(opt);
      this.send([IAC, WONT, opt]);
    } else if (verb === WILL) {
      const accept = opt === OPT_ECHO || opt === OPT_SGA;
      if (!accept) return this.send([IAC, DONT, opt]);
      if (this.remote.has(opt)) return;
      this.remote.add(opt);
      this.send([IAC, DO, opt]);
    } else if (verb === WONT) {
      if (!this.remote.has(opt)) return;
      this.remote.delete(opt);
      this.send([IAC, DONT, opt]);
    }
  }

  private subnegotiation(buf: number[]): void {
    // TTYPE SEND → TTYPE IS <тип терминала>
    if (buf[0] === OPT_TTYPE && buf[1] === 1) {
      this.send([IAC, SB, OPT_TTYPE, 0, ...Buffer.from(this.opts.termType, 'ascii'), IAC, SE]);
    }
  }

  /** Сообщить размер окна (если сервер его запросил). */
  sendSize(): void {
    if (!this.local.has(OPT_NAWS)) return;
    const { cols, rows } = this.opts.size();
    const bytes = [cols >> 8, cols & 255, rows >> 8, rows & 255].flatMap((x) => (x === IAC ? [IAC, IAC] : [x]));
    this.send([IAC, SB, OPT_NAWS, ...bytes, IAC, SE]);
  }
}

/** Данные пользователя → поток Telnet: байт 255 удваивается, Enter — это CR LF (как в PuTTY по умолчанию). */
export function encodeTelnetInput(data: string): Buffer {
  const text = data.replace(/\r(?!\n)/g, '\r\n');
  const raw = Buffer.from(text, 'utf8');
  if (!raw.includes(IAC)) return raw;
  const out: number[] = [];
  for (const b of raw) {
    out.push(b);
    if (b === IAC) out.push(IAC);
  }
  return Buffer.from(out);
}

export function humanizeTelnetError(e: Error & { code?: string }, t: { host: string; port: number }): Error {
  const where = `${t.host}:${t.port}`;
  const code = e.code ?? '';
  let msg: string;
  if (code === 'ECONNREFUSED') msg = `Порт ${t.port} на ${t.host} закрыт: Telnet на устройстве не включён или указан другой порт.`;
  else if (code === 'ETIMEDOUT' || /timed? ?out/i.test(e.message)) msg = `Нет ответа от ${where}: устройство недоступно, порт фильтруется или неверный адрес.`;
  else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') msg = `Имя «${t.host}» не найдено в DNS. Проверьте адрес.`;
  else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') msg = `Нет маршрута до ${t.host}: проверьте сеть, VLAN управления и шлюз.`;
  else if (code === 'ECONNRESET') msg = `Устройство ${where} разорвало соединение: превышено число сессий Telnet или доступ ограничен (ACL, access-class).`;
  else msg = `Не удалось подключиться по Telnet к ${where}: ${e.message}`;
  const err = new Error(msg) as Error & { original?: string };
  err.original = e.message;
  return err;
}

export class TelnetSession extends ShellSession {
  private sock: Socket | null = null;
  private decoder = new StringDecoder('utf8');
  private parser: TelnetParser;
  private loginState: 'user' | 'pass' | 'done' = 'user';
  private loginTimer: NodeJS.Timeout | null = null;

  constructor(private target: TelnetTarget) {
    super(target, 'telnet');
    this.parser = new TelnetParser((bytes) => this.sock?.write(Buffer.from(bytes)), {
      termType: target.platform === 'linux' ? 'XTERM' : 'VT100',
      size: () => ({ cols: this.cols, rows: this.rows })
    });
  }

  connect(size: { cols: number; rows: number }): Promise<void> {
    this.cols = size.cols;
    this.rows = size.rows;
    const t = this.target;
    return new Promise((resolve, reject) => {
      let settled = false;
      const sock = new Socket();
      this.sock = sock;
      sock.setTimeout(Math.max(5, t.timeoutSec) * 1000);
      sock.once('timeout', () => {
        if (!settled) {
          settled = true;
          sock.destroy();
          reject(humanizeTelnetError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), t));
        }
      });
      sock.on('error', (e: Error & { code?: string }) => {
        if (!settled) {
          settled = true;
          reject(humanizeTelnetError(e, t));
        } else {
          this.lastError = e.message;
          this.markClosed(humanizeTelnetError(e, t).message);
        }
      });
      sock.connect(t.port, t.host, () => {
        settled = true;
        sock.setTimeout(0);
        if (t.keepaliveSec > 0) sock.setKeepAlive(true, t.keepaliveSec * 1000);
        sock.setNoDelay(true);
        this.transport = {
          write: (d) => void sock.write(encodeTelnetInput(d)),
          resize: () => this.parser.sendSize(),
          end: () => sock.end()
        };
        // Автоматический вход действует ограниченное время, дальше пользователь вводит сам.
        this.loginTimer = setTimeout(() => (this.loginState = 'done'), 30000);
        this.setStatus('ready');
        resolve();
      });
      sock.on('data', (chunk: Buffer) => {
        const data = this.parser.feed(chunk);
        if (data.length) {
          const text = this.decoder.write(data);
          this.onOutput(text);
          this.autoLogin();
        }
      });
      sock.on('close', () => {
        if (this.loginTimer) clearTimeout(this.loginTimer);
        if (settled) this.markClosed();
      });
    });
  }

  /** Ответ на «Username:» / «Password:», если логин и пароль сохранены в карточке устройства. */
  private autoLogin(): void {
    if (this.loginState === 'done') return;
    const last = this.tail.slice(-200).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const t = this.target;
    if (this.loginState === 'user' && /(user ?name|login|user)\s*:\s*$/i.test(last)) {
      if (!t.username) return void (this.loginState = 'done');
      this.writeRaw(`${t.username}\r`);
      this.loginState = 'pass';
    } else if (/password\s*:\s*$/i.test(last)) {
      if (t.password) this.writeRaw(`${t.password}\r`);
      this.loginState = 'done';
    }
  }

  close(): void {
    if (this.loginTimer) clearTimeout(this.loginTimer);
    try {
      this.sock?.end();
      this.sock?.destroy();
    } catch {
      /* соединение уже закрыто */
    }
  }
}
