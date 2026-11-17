// Консоль через COM-порт / USB-переходник (консольный кабель коммутатора).
// Сам порт открывается в окне программы через Web Serial (встроено в Chromium, без нативных модулей),
// а сессия живёт здесь, как SSH и Telnet: журнал, режим «Только чтение», захват вывода, сценарии.
import { ShellSession, type ShellTargetBase } from './shell';

export interface SerialTarget extends ShellTargetBase {
  /** Имя порта: COM3, /dev/ttyUSB0, /dev/tty.usbserial-1410. */
  portName: string;
  baudRate: number;
}

/** Мост к окну программы, где открыт порт. */
export interface SerialBridge {
  open(sessionId: string, opts: { portName: string; baudRate: number }): Promise<void>;
  write(sessionId: string, data: string): void;
  close(sessionId: string): void;
}

export class SerialSession extends ShellSession {
  constructor(
    private target: SerialTarget,
    private bridge: SerialBridge
  ) {
    super(target, 'serial');
  }

  async connect(size: { cols: number; rows: number }): Promise<void> {
    this.cols = size.cols;
    this.rows = size.rows;
    await this.bridge.open(this.id, { portName: this.target.portName, baudRate: this.target.baudRate });
    this.transport = {
      write: (d) => this.bridge.write(this.id, d),
      end: () => this.bridge.close(this.id)
    };
    this.setStatus('ready');
  }

  /** Данные из порта (приходят из окна программы). */
  feed(text: string): void {
    this.onOutput(text);
  }

  /** Порт закрыт или отключён (кабель выдернут). */
  portClosed(reason?: string): void {
    this.markClosed(reason);
  }

  close(): void {
    try {
      this.bridge.close(this.id);
    } catch {
      /* окно уже закрыто */
    }
    this.markClosed();
  }
}
