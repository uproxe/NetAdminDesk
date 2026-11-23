// Клиент SNMP v1/v2c поверх UDP: GET, GETNEXT, GETBULK, обход таблицы (walk).
// Один сокет на всё приложение, ответы сопоставляются по request-id, адресу и community.
import dgram from 'node:dgram';
import { isIPv6 } from 'node:net';
import { randomInt } from 'node:crypto';
import { ERROR_STATUS, OID, SNMP_V1, SNMP_V2C, TAG, buildRequest, decodeMessage, oidStartsWith, type SnmpPdu, type VarBind } from '../../shared/snmp';

export interface SnmpTarget {
  host: string;
  port?: number;
  community: string;
  version: 1 | 2;
  timeoutMs?: number;
  retries?: number;
}

export class SnmpError extends Error {
  constructor(
    message: string,
    public kind: 'timeout' | 'error' | 'agent'
  ) {
    super(message);
    this.name = 'SnmpError';
  }
}

interface Pending {
  resolve: (p: SnmpPdu) => void;
  reject: (e: Error) => void;
  community: string;
}

export class SnmpClient {
  private sockets = new Map<'udp4' | 'udp6', dgram.Socket>();
  private pending = new Map<number, Pending>();

  private socket(family: 'udp4' | 'udp6'): dgram.Socket {
    let s = this.sockets.get(family);
    if (s) return s;
    s = dgram.createSocket(family);
    s.on('message', (msg) => {
      try {
        const m = decodeMessage(msg);
        const pdu = m.pdu as SnmpPdu;
        if (pdu.type !== TAG.RESPONSE && pdu.type !== TAG.REPORT) return;
        const p = this.pending.get(pdu.requestId);
        if (!p || p.community !== m.community) return;
        this.pending.delete(pdu.requestId);
        p.resolve(pdu);
      } catch {
        /* чужой или повреждённый пакет — игнорируем */
      }
    });
    s.on('error', () => undefined);
    s.unref();
    this.sockets.set(family, s);
    return s;
  }

  private async request(t: SnmpTarget, type: number, oids: string[], bulk?: { nonRepeaters: number; maxRepetitions: number }): Promise<VarBind[]> {
    const version = t.version === 1 ? SNMP_V1 : SNMP_V2C;
    if (type === TAG.GET_BULK && version === SNMP_V1) throw new SnmpError('GETBULK доступен только в SNMP v2c', 'error');
    const retries = t.retries ?? 1;
    const timeout = t.timeoutMs ?? 2000;
    const fam = isIPv6(t.host) ? 'udp6' : 'udp4';
    const sock = this.socket(fam);
    for (let attempt = 0; attempt <= retries; attempt++) {
      let id = randomInt(1, 0x7fffffff);
      while (this.pending.has(id)) id = randomInt(1, 0x7fffffff);
      const packet = buildRequest(type, version, t.community, id, oids, bulk);
      try {
        const pdu = await new Promise<SnmpPdu>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new SnmpError('нет ответа', 'timeout'));
          }, timeout);
          this.pending.set(id, {
            community: t.community,
            resolve: (p) => {
              clearTimeout(timer);
              resolve(p);
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            }
          });
          sock.send(packet, t.port ?? 161, t.host, (err) => {
            if (err) {
              this.pending.delete(id);
              clearTimeout(timer);
              reject(new SnmpError(err.message, 'error'));
            }
          });
        });
        if (pdu.type === TAG.REPORT) throw new SnmpError('агент ответил отчётом (возможно, требуется SNMPv3)', 'agent');
        if (pdu.errorStatus) throw new SnmpError(`агент вернул ошибку: ${ERROR_STATUS[pdu.errorStatus] ?? pdu.errorStatus}`, 'agent');
        return pdu.varbinds;
      } catch (e) {
        if (e instanceof SnmpError && e.kind === 'timeout' && attempt < retries) continue;
        throw e;
      }
    }
    throw new SnmpError('нет ответа', 'timeout');
  }

  get(t: SnmpTarget, oids: string[]): Promise<VarBind[]> {
    return this.request(t, TAG.GET, oids);
  }

  getNext(t: SnmpTarget, oids: string[]): Promise<VarBind[]> {
    return this.request(t, TAG.GET_NEXT, oids);
  }

  getBulk(t: SnmpTarget, oids: string[], maxRepetitions = 20): Promise<VarBind[]> {
    return this.request(t, TAG.GET_BULK, oids, { nonRepeaters: 0, maxRepetitions });
  }

  /** Обход поддерева (не больше limit строк). В v2c используется GETBULK. */
  async walk(t: SnmpTarget, root: string, limit = 1000): Promise<VarBind[]> {
    const out: VarBind[] = [];
    let cur = root;
    while (out.length < limit) {
      const vbs = t.version === 2 ? await this.getBulk(t, [cur], 25) : await this.getNext(t, [cur]);
      if (!vbs.length) break;
      let done = false;
      for (const vb of vbs) {
        if (vb.value.type === 'endOfMibView' || !oidStartsWith(vb.oid, root) || vb.oid === cur) {
          done = true;
          break;
        }
        out.push(vb);
        cur = vb.oid;
        if (out.length >= limit) break;
      }
      if (done) break;
    }
    return out;
  }

  close(): void {
    for (const p of this.pending.values()) p.reject(new SnmpError('клиент закрыт', 'error'));
    this.pending.clear();
    for (const s of this.sockets.values()) s.close();
    this.sockets.clear();
  }
}

export interface SnmpPort {
  ifIndex: number;
  name: string;
  alias: string;
  oper: 'up' | 'down' | 'testing' | 'unknown' | 'dormant' | 'notPresent' | 'lowerLayerDown';
  admin: 'up' | 'down' | 'testing';
  speedMbps: number;
}

const OPER = ['', 'up', 'down', 'testing', 'unknown', 'dormant', 'notPresent', 'lowerLayerDown'] as const;
const ADMIN = ['', 'up', 'down', 'testing'] as const;

/** Таблица портов: имя, описание (ifAlias), состояние и скорость. */
export async function readPorts(c: SnmpClient, t: SnmpTarget): Promise<SnmpPort[]> {
  const col = async (oid: string) => {
    try {
      return await c.walk(t, oid, 600);
    } catch (e) {
      if (oid === OID.ifDescr) throw e;
      return [];
    }
  };
  const descr = await col(OID.ifDescr);
  const [name, alias, oper, admin, speed, high] = await Promise.all([col(OID.ifName), col(OID.ifAlias), col(OID.ifOperStatus), col(OID.ifAdminStatus), col(OID.ifSpeed), col(OID.ifHighSpeed)]);
  const idx = (oid: string, base: string) => Number(oid.slice(base.length + 1));
  const map = (vbs: VarBind[], base: string) => new Map(vbs.map((v) => [idx(v.oid, base), v.value] as const));
  const nm = map(name, OID.ifName);
  const al = map(alias, OID.ifAlias);
  const op = map(oper, OID.ifOperStatus);
  const ad = map(admin, OID.ifAdminStatus);
  const sp = map(speed, OID.ifSpeed);
  const hs = map(high, OID.ifHighSpeed);
  const s = (v: unknown) => (v && (v as { type: string }).type === 'str' ? new TextDecoder().decode((v as { value: Uint8Array }).value).replace(/\0+$/, '') : '');
  const n = (v: unknown) => (v && typeof (v as { value: unknown }).value === 'number' ? ((v as { value: number }).value as number) : 0);
  return descr.map((d) => {
    const i = idx(d.oid, OID.ifDescr);
    const hsv = n(hs.get(i));
    return {
      ifIndex: i,
      name: s(nm.get(i)) || s(d.value),
      alias: s(al.get(i)),
      oper: OPER[n(op.get(i))] || 'unknown',
      admin: ADMIN[n(ad.get(i))] || 'up',
      speedMbps: hsv || Math.round(n(sp.get(i)) / 1e6)
    } as SnmpPort;
  });
}
