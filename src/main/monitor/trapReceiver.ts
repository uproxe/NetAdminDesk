// Приёмник SNMP-трапов (UDP, по умолчанию порт 162). Устройства отправляют трапы на IP этого компьютера.
// Трапы v1, v2c и InformRequest (на inform отправляется подтверждение). SNMPv3 не поддерживается.
import dgram from 'node:dgram';
import { buildInformResponse, decodeMessage, parseTrap, type ParsedTrap } from '../../shared/snmp';

export interface TrapReceiverOptions {
  port: number;
  /** Адрес, на котором слушать: '0.0.0.0' — все сетевые интерфейсы. */
  bind: string;
  /** Если задано — трапы с другой community отбрасываются. */
  community?: string;
}

export interface TrapEvent {
  source: string;
  sourcePort: number;
  trap: ParsedTrap;
  receivedAt: number;
}

export class TrapReceiver {
  private sock: dgram.Socket | null = null;
  private opts: TrapReceiverOptions | null = null;
  received = 0;
  dropped = 0;
  lastError = '';

  constructor(private onTrap: (e: TrapEvent) => void) {}

  get listening(): boolean {
    return !!this.sock;
  }

  get options(): TrapReceiverOptions | null {
    return this.opts;
  }

  start(opts: TrapReceiverOptions): Promise<void> {
    this.stop();
    this.lastError = '';
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket({ type: opts.bind.includes(':') ? 'udp6' : 'udp4', reuseAddr: false });
      let bound = false;
      s.on('error', (e: NodeJS.ErrnoException) => {
        const msg =
          e.code === 'EACCES'
            ? `нет прав открыть UDP-порт ${opts.port}: в Linux и macOS порты ниже 1024 доступны только администратору — укажите, например, 1162 и настройте устройства на этот порт`
            : e.code === 'EADDRINUSE'
              ? `UDP-порт ${opts.port} уже занят другой программой (например, службой «Ловушка SNMP» Windows или другим мониторингом)`
              : e.code === 'EADDRNOTAVAIL'
                ? `адрес ${opts.bind} не принадлежит этому компьютеру`
                : e.message;
        this.lastError = msg;
        if (!bound) {
          s.close();
          reject(new Error(msg));
        }
      });
      s.on('message', (msg, rinfo) => this.handle(msg, rinfo));
      s.bind(opts.port, opts.bind, () => {
        bound = true;
        this.sock = s;
        this.opts = opts;
        resolve();
      });
    });
  }

  private handle(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    let m;
    try {
      m = decodeMessage(msg);
    } catch {
      this.dropped++;
      return;
    }
    const trap = parseTrap(m);
    if (!trap) {
      this.dropped++;
      return;
    }
    if (this.opts?.community && trap.community !== this.opts.community) {
      this.dropped++;
      return;
    }
    if (trap.inform) {
      try {
        this.sock?.send(buildInformResponse(m), rinfo.port, rinfo.address);
      } catch {
        /* подтверждение не обязательно для работы */
      }
    }
    this.received++;
    const source = rinfo.address.replace(/^::ffff:/, '');
    this.onTrap({ source, sourcePort: rinfo.port, trap, receivedAt: Date.now() });
  }

  stop(): void {
    if (this.sock) {
      try {
        this.sock.close();
      } catch {
        /* уже закрыт */
      }
    }
    this.sock = null;
    this.opts = null;
  }
}
