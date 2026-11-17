// Общая часть интерактивной сессии (SSH, Telnet, COM-порт): вывод, учёт введённых строк,
// ожидание приглашения, захват вывода команды, отправка строк, автоматический enable.
// Конкретный протокол задаёт только транспорт: как писать байты, менять размер окна и закрываться.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { CaptureResult, ExecResult, SessionInfo, SessionProtocol } from '../../shared/types';
import { cleanCaptured, endsWithPrompt, isPagerPrompt, isPasswordPrompt, stripAnsi, renderLines } from '../../shared/terminalText';

export interface ShellTransport {
  write(data: string): void;
  resize?(cols: number, rows: number): void;
  end(): void;
}

export interface CaptureOptions {
  timeoutMs?: number;
  idleMs?: number;
  /** Автоматически отвечать пробелом на «--More--». */
  autoPager?: boolean;
}

export interface ShellTargetBase {
  deviceId: number;
  deviceName: string;
  host: string;
  platform: string;
}

/** События: data(chunk), status(info), typed({line, uncertain}), closed. */
export abstract class ShellSession extends EventEmitter {
  readonly id = randomUUID();
  info: SessionInfo;
  protected transport: ShellTransport | null = null;
  protected tail = '';
  protected cols = 120;
  protected rows = 32;
  private captureLock: Promise<unknown> = Promise.resolve();
  private inputLine = '';
  private inputUncertain = false;
  private inEscape = false;
  /** Последняя ошибка после установления соединения (для журнала). */
  lastError = '';

  constructor(base: ShellTargetBase, readonly protocol: SessionProtocol) {
    super();
    this.info = {
      id: this.id,
      deviceId: base.deviceId,
      deviceName: base.deviceName,
      host: base.host,
      platform: base.platform,
      protocol,
      status: 'connecting',
      startedAt: new Date().toISOString()
    };
  }

  abstract connect(size: { cols: number; rows: number }, extra?: unknown): Promise<void>;
  abstract close(): void;

  protected setStatus(status: SessionInfo['status'], error?: string): void {
    this.info = { ...this.info, status, error };
    this.emit('status', this.info);
  }

  /** Сессия закрыта со стороны устройства или транспорта. */
  protected markClosed(error?: string): void {
    if (this.info.status === 'closed' || this.info.status === 'error') return;
    this.transport = null;
    if (error) this.setStatus('error', error);
    else this.setStatus('closed');
    this.emit('closed');
  }

  protected onOutput(chunk: string): void {
    if (!chunk) return;
    this.tail = (this.tail + chunk).slice(-8192);
    this.emit('data', chunk);
  }

  get outputTail(): string {
    return this.tail;
  }

  write(data: string): void {
    if (!this.transport) return;
    this.trackInput(data);
    this.transport.write(data);
  }

  /** Запись без учёта в истории введённых строк (пароли, служебные ответы). */
  writeRaw(data: string): void {
    this.transport?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.transport?.resize?.(cols, rows);
  }

  private trackInput(data: string): void {
    for (const ch of data) {
      if (this.inEscape) {
        if (/[A-Za-z~]/.test(ch)) this.inEscape = false;
        continue;
      }
      if (ch === '\x1b') {
        this.inEscape = true;
        this.inputUncertain = true;
      } else if (ch === '\r' || ch === '\n') {
        const line = this.inputLine.trim();
        if (line && !isPasswordPrompt(this.tail)) {
          this.emit('typed', { line, uncertain: this.inputUncertain });
        }
        this.inputLine = '';
        this.inputUncertain = false;
      } else if (ch === '\x7f' || ch === '\b') {
        this.inputLine = this.inputLine.slice(0, -1);
      } else if (ch === '\x03' || ch === '\x15') {
        this.inputLine = '';
        this.inputUncertain = false;
      } else if (ch === '\t' || ch === '?') {
        this.inputUncertain = true;
        if (ch === '?') this.inputLine += ch;
      } else if (ch >= ' ') {
        this.inputLine += ch;
      }
    }
  }

  /** Ожидание тишины в выводе или приглашения. */
  waitQuiet(idleMs = 600, maxMs = 5000): Promise<string> {
    return new Promise((resolve) => {
      let buf = '';
      let idle: NodeJS.Timeout;
      const done = () => {
        clearTimeout(idle);
        clearTimeout(hard);
        this.removeListener('data', on);
        resolve(buf);
      };
      const on = (c: string) => {
        buf += c;
        clearTimeout(idle);
        idle = setTimeout(done, endsWithPrompt(buf) ? Math.min(250, idleMs) : idleMs);
      };
      idle = setTimeout(done, idleMs);
      const hard = setTimeout(done, maxMs);
      this.on('data', on);
    });
  }

  /**
   * Выполняет команду в видимом терминале и захватывает её вывод.
   * Команда видна пользователю, «--More--» обрабатывается автоматически.
   */
  capture(command: string, opts: CaptureOptions = {}): Promise<CaptureResult> {
    const run = async (): Promise<CaptureResult> => {
      if (!this.transport) throw new Error('Сессия не подключена');
      const timeoutMs = opts.timeoutMs ?? 30000;
      const idleMs = opts.idleMs ?? 2500;
      const started = Date.now();
      return new Promise<CaptureResult>((resolve) => {
        let buf = '';
        let finished = false;
        let idle: NodeJS.Timeout | undefined;
        let promptTimer: NodeJS.Timeout | undefined;
        const finish = (timedOut: boolean) => {
          if (finished) return;
          finished = true;
          clearTimeout(idle);
          clearTimeout(promptTimer);
          clearTimeout(hard);
          this.removeListener('data', on);
          resolve({ command, output: cleanCaptured(buf, command), timedOut, durationMs: Date.now() - started });
        };
        const on = (chunk: string) => {
          buf += chunk;
          const tail = buf.slice(-600);
          if ((opts.autoPager ?? true) && isPagerPrompt(tail)) {
            this.writeRaw(' ');
            return;
          }
          clearTimeout(idle);
          clearTimeout(promptTimer);
          idle = setTimeout(() => finish(false), idleMs);
          if (buf.length > command.length && endsWithPrompt(tail)) promptTimer = setTimeout(() => finish(false), 350);
        };
        const hard = setTimeout(() => finish(true), timeoutMs);
        this.on('data', on);
        this.writeRaw(`${command}\r`);
      });
    };
    const p = this.captureLock.then(run, run);
    this.captureLock = p.catch(() => undefined);
    return p;
  }

  /** Отправка одной или нескольких строк в видимый терминал (ожидание приглашения между строками). */
  async sendLines(lines: string[]): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      this.write(`${lines[i]}\r`);
      if (i < lines.length - 1) await this.waitQuiet(400, 4000);
    }
  }

  /** SSH exec есть только у SSH-сессий; на Telnet и COM-порту команды выполняются в терминале. */
  exec(_command: string, _timeoutMs?: number): Promise<ExecResult> {
    return Promise.reject(new Error(`Отдельный канал выполнения (exec) есть только у SSH. Для подключения по ${this.protocol === 'telnet' ? 'Telnet' : 'COM-порту'} команды выполняются в терминале.`));
  }

  /** Автоматический вход в привилегированный режим (enable) для коммутаторов. */
  async autoEnable(enablePassword: string): Promise<boolean> {
    const first = await this.waitQuiet(800, 4000);
    const prompt = renderLines(stripAnsi(this.tail)).split('\n').pop() ?? first;
    if (!/>\s?$/.test(prompt)) return false;
    this.writeRaw('enable\r');
    const out = await this.waitQuiet(700, 5000);
    if (isPasswordPrompt(out) || isPasswordPrompt(this.tail)) {
      this.writeRaw(`${enablePassword}\r`);
      const after = await this.waitQuiet(700, 5000);
      return /#\s?$/.test(renderLines(stripAnsi(after || this.tail)).trimEnd());
    }
    return /#\s?$/.test(renderLines(stripAnsi(out)).trimEnd());
  }
}
