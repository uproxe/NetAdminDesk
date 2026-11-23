// SNMP v1 / v2c: кодирование BER, сообщения GET / GETNEXT / GETBULK, ответы и трапы.
// Без внешних зависимостей; используется движком мониторинга и тестами.

export const SNMP_V1 = 0;
export const SNMP_V2C = 1;

export const TAG = {
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  SEQUENCE: 0x30,
  IP_ADDRESS: 0x40,
  COUNTER32: 0x41,
  GAUGE32: 0x42,
  TIMETICKS: 0x43,
  OPAQUE: 0x44,
  COUNTER64: 0x46,
  NO_SUCH_OBJECT: 0x80,
  NO_SUCH_INSTANCE: 0x81,
  END_OF_MIB_VIEW: 0x82,
  GET: 0xa0,
  GET_NEXT: 0xa1,
  RESPONSE: 0xa2,
  SET: 0xa3,
  TRAP_V1: 0xa4,
  GET_BULK: 0xa5,
  INFORM: 0xa6,
  TRAP_V2: 0xa7,
  REPORT: 0xa8
} as const;

export const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysContact: '1.3.6.1.2.1.1.4.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
  snmpTrapOID: '1.3.6.1.6.3.1.1.4.1.0',
  snmpTrapEnterprise: '1.3.6.1.6.3.1.1.4.3.0',
  ifIndex: '1.3.6.1.2.1.2.2.1.1',
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18'
} as const;

export type SnmpValue =
  | { type: 'int'; value: number }
  | { type: 'str'; value: Uint8Array }
  | { type: 'null' }
  | { type: 'oid'; value: string }
  | { type: 'ip'; value: string }
  | { type: 'counter' | 'gauge' | 'ticks'; value: number }
  | { type: 'counter64'; value: string }
  | { type: 'opaque'; value: Uint8Array }
  | { type: 'noSuchObject' | 'noSuchInstance' | 'endOfMibView' };

export interface VarBind {
  oid: string;
  value: SnmpValue;
}

export interface SnmpPdu {
  type: number;
  requestId: number;
  errorStatus: number;
  errorIndex: number;
  varbinds: VarBind[];
}

export interface TrapV1Pdu {
  type: typeof TAG.TRAP_V1;
  enterprise: string;
  agentAddr: string;
  generic: number;
  specific: number;
  timestamp: number;
  varbinds: VarBind[];
}

export interface SnmpMessage {
  version: number;
  community: string;
  pdu: SnmpPdu | TrapV1Pdu;
}

// ---------- BER: кодирование ----------

function encLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return [0x80 | out.length, ...out];
}

function tlv(tag: number, body: number[] | Uint8Array): number[] {
  const b = Array.from(body);
  return [tag, ...encLength(b.length), ...b];
}

/** Целое со знаком (дополнительный код, минимальная длина). */
function encInt(v: number): number[] {
  let n = BigInt(Math.trunc(v));
  const out: number[] = [];
  for (;;) {
    const byte = Number(n & 0xffn);
    out.unshift(byte);
    n >>= 8n;
    if ((n === 0n && !(byte & 0x80)) || (n === -1n && byte & 0x80)) break;
  }
  return out;
}

/** Беззнаковое (Counter32, Gauge32, TimeTicks, Counter64). */
function encUnsigned(v: number | bigint): number[] {
  let n = BigInt(v);
  if (n < 0n) n = 0n;
  const out: number[] = [];
  do {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  } while (n > 0n);
  if (out[0] & 0x80) out.unshift(0);
  return out;
}

export function encodeOid(oid: string): number[] {
  const parts = oid.replace(/^\./, '').split('.').map((x) => Number(x));
  if (parts.length < 2 || parts.some((p) => !Number.isInteger(p) || p < 0)) throw new Error(`Неверный OID: ${oid}`);
  const arcs = [parts[0] * 40 + parts[1], ...parts.slice(2)];
  const out: number[] = [];
  for (const a of arcs) {
    const bytes: number[] = [];
    let n = a;
    do {
      bytes.unshift(n & 0x7f);
      n = Math.floor(n / 128);
    } while (n > 0);
    for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
    out.push(...bytes);
  }
  return out;
}

function encValue(v: SnmpValue): number[] {
  switch (v.type) {
    case 'int':
      return tlv(TAG.INTEGER, encInt(v.value));
    case 'str':
      return tlv(TAG.OCTET_STRING, v.value);
    case 'null':
      return [TAG.NULL, 0];
    case 'oid':
      return tlv(TAG.OID, encodeOid(v.value));
    case 'ip':
      return tlv(TAG.IP_ADDRESS, v.value.split('.').map(Number));
    case 'counter':
      return tlv(TAG.COUNTER32, encUnsigned(v.value));
    case 'gauge':
      return tlv(TAG.GAUGE32, encUnsigned(v.value));
    case 'ticks':
      return tlv(TAG.TIMETICKS, encUnsigned(v.value));
    case 'counter64':
      return tlv(TAG.COUNTER64, encUnsigned(BigInt(v.value)));
    case 'opaque':
      return tlv(TAG.OPAQUE, v.value);
    case 'noSuchObject':
      return [TAG.NO_SUCH_OBJECT, 0];
    case 'noSuchInstance':
      return [TAG.NO_SUCH_INSTANCE, 0];
    case 'endOfMibView':
      return [TAG.END_OF_MIB_VIEW, 0];
  }
}

function encVarbinds(vbs: VarBind[]): number[] {
  return tlv(
    TAG.SEQUENCE,
    vbs.flatMap((vb) => tlv(TAG.SEQUENCE, [...tlv(TAG.OID, encodeOid(vb.oid)), ...encValue(vb.value)]))
  );
}

export function encodeMessage(m: SnmpMessage): Uint8Array {
  const community = new TextEncoder().encode(m.community);
  let pdu: number[];
  if (m.pdu.type === TAG.TRAP_V1) {
    const t = m.pdu as TrapV1Pdu;
    pdu = tlv(TAG.TRAP_V1, [
      ...tlv(TAG.OID, encodeOid(t.enterprise)),
      ...tlv(TAG.IP_ADDRESS, t.agentAddr.split('.').map(Number)),
      ...tlv(TAG.INTEGER, encInt(t.generic)),
      ...tlv(TAG.INTEGER, encInt(t.specific)),
      ...tlv(TAG.TIMETICKS, encUnsigned(t.timestamp)),
      ...encVarbinds(t.varbinds)
    ]);
  } else {
    const p = m.pdu as SnmpPdu;
    pdu = tlv(p.type, [...tlv(TAG.INTEGER, encInt(p.requestId)), ...tlv(TAG.INTEGER, encInt(p.errorStatus)), ...tlv(TAG.INTEGER, encInt(p.errorIndex)), ...encVarbinds(p.varbinds)]);
  }
  return Uint8Array.from(tlv(TAG.SEQUENCE, [...tlv(TAG.INTEGER, encInt(m.version)), ...tlv(TAG.OCTET_STRING, community), ...pdu]));
}

/** Запрос GET / GETNEXT (для GETBULK: errorStatus = non-repeaters, errorIndex = max-repetitions). */
export function buildRequest(type: number, version: number, community: string, requestId: number, oids: string[], bulk?: { nonRepeaters: number; maxRepetitions: number }): Uint8Array {
  return encodeMessage({
    version,
    community,
    pdu: { type, requestId, errorStatus: bulk?.nonRepeaters ?? 0, errorIndex: bulk?.maxRepetitions ?? 0, varbinds: oids.map((oid) => ({ oid, value: { type: 'null' } })) }
  });
}

// ---------- BER: разбор ----------

interface Tlv {
  tag: number;
  start: number;
  end: number;
  next: number;
}

function readTlv(b: Uint8Array, pos: number, limit = b.length): Tlv {
  if (pos + 2 > limit) throw new Error('Пакет SNMP обрезан');
  const tag = b[pos];
  let len = b[pos + 1];
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || p + n > limit) throw new Error('Неверная длина в пакете SNMP');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[p + i];
    p += n;
  }
  if (p + len > limit) throw new Error('Пакет SNMP обрезан');
  return { tag, start: p, end: p + len, next: p + len };
}

function decInt(b: Uint8Array, t: Tlv): number {
  if (t.end === t.start) return 0;
  let n = BigInt(b[t.start] & 0x80 ? -1 : 0);
  for (let i = t.start; i < t.end; i++) n = (n << 8n) | BigInt(b[i]);
  if (b[t.start] & 0x80) n = BigInt.asIntN((t.end - t.start) * 8, n);
  return Number(n);
}

function decUnsigned(b: Uint8Array, t: Tlv): bigint {
  let n = 0n;
  for (let i = t.start; i < t.end; i++) n = (n << 8n) | BigInt(b[i]);
  return n;
}

export function decodeOid(b: Uint8Array, start: number, end: number): string {
  const arcs: number[] = [];
  let n = 0;
  for (let i = start; i < end; i++) {
    n = n * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      arcs.push(n);
      n = 0;
    }
  }
  if (!arcs.length) return '';
  const first = arcs[0];
  const a = first < 40 ? 0 : first < 80 ? 1 : 2;
  return [a, first - a * 40, ...arcs.slice(1)].join('.');
}

function decValue(b: Uint8Array, t: Tlv): SnmpValue {
  const body = b.subarray(t.start, t.end);
  switch (t.tag) {
    case TAG.INTEGER:
      return { type: 'int', value: decInt(b, t) };
    case TAG.OCTET_STRING:
      return { type: 'str', value: body.slice() };
    case TAG.NULL:
      return { type: 'null' };
    case TAG.OID:
      return { type: 'oid', value: decodeOid(b, t.start, t.end) };
    case TAG.IP_ADDRESS:
      return { type: 'ip', value: Array.from(body).join('.') };
    case TAG.COUNTER32:
      return { type: 'counter', value: Number(decUnsigned(b, t)) };
    case TAG.GAUGE32:
      return { type: 'gauge', value: Number(decUnsigned(b, t)) };
    case TAG.TIMETICKS:
      return { type: 'ticks', value: Number(decUnsigned(b, t)) };
    case TAG.COUNTER64:
      return { type: 'counter64', value: decUnsigned(b, t).toString() };
    case TAG.OPAQUE:
      return { type: 'opaque', value: body.slice() };
    case TAG.NO_SUCH_OBJECT:
      return { type: 'noSuchObject' };
    case TAG.NO_SUCH_INSTANCE:
      return { type: 'noSuchInstance' };
    case TAG.END_OF_MIB_VIEW:
      return { type: 'endOfMibView' };
    default:
      return { type: 'opaque', value: body.slice() };
  }
}

function decVarbinds(b: Uint8Array, t: Tlv): VarBind[] {
  if (t.tag !== TAG.SEQUENCE) throw new Error('Неверный список переменных SNMP');
  const out: VarBind[] = [];
  let p = t.start;
  while (p < t.end) {
    const vb = readTlv(b, p, t.end);
    const o = readTlv(b, vb.start, vb.end);
    if (o.tag !== TAG.OID) throw new Error('Ожидался OID');
    const v = readTlv(b, o.next, vb.end);
    out.push({ oid: decodeOid(b, o.start, o.end), value: decValue(b, v) });
    p = vb.next;
  }
  return out;
}

export function decodeMessage(buf: Uint8Array): SnmpMessage {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const seq = readTlv(b, 0);
  if (seq.tag !== TAG.SEQUENCE) throw new Error('Это не пакет SNMP');
  const ver = readTlv(b, seq.start, seq.end);
  if (ver.tag !== TAG.INTEGER) throw new Error('Нет версии SNMP');
  const version = decInt(b, ver);
  if (version !== SNMP_V1 && version !== SNMP_V2C) throw new Error(version === 3 ? 'SNMPv3 не поддерживается (нужен v1 или v2c)' : `Неизвестная версия SNMP: ${version}`);
  const com = readTlv(b, ver.next, seq.end);
  if (com.tag !== TAG.OCTET_STRING) throw new Error('Нет community');
  const community = new TextDecoder().decode(b.subarray(com.start, com.end));
  const pt = readTlv(b, com.next, seq.end);
  if (pt.tag === TAG.TRAP_V1) {
    const ent = readTlv(b, pt.start, pt.end);
    const addr = readTlv(b, ent.next, pt.end);
    const gen = readTlv(b, addr.next, pt.end);
    const spec = readTlv(b, gen.next, pt.end);
    const ts = readTlv(b, spec.next, pt.end);
    const vbs = readTlv(b, ts.next, pt.end);
    return {
      version,
      community,
      pdu: {
        type: TAG.TRAP_V1,
        enterprise: decodeOid(b, ent.start, ent.end),
        agentAddr: Array.from(b.subarray(addr.start, addr.end)).join('.'),
        generic: decInt(b, gen),
        specific: decInt(b, spec),
        timestamp: Number(decUnsigned(b, ts)),
        varbinds: decVarbinds(b, vbs)
      }
    };
  }
  if (![TAG.GET, TAG.GET_NEXT, TAG.RESPONSE, TAG.SET, TAG.GET_BULK, TAG.INFORM, TAG.TRAP_V2, TAG.REPORT].includes(pt.tag as never)) throw new Error(`Неизвестный тип PDU: 0x${pt.tag.toString(16)}`);
  const rid = readTlv(b, pt.start, pt.end);
  const es = readTlv(b, rid.next, pt.end);
  const ei = readTlv(b, es.next, pt.end);
  const vbs = readTlv(b, ei.next, pt.end);
  return { version, community, pdu: { type: pt.tag, requestId: decInt(b, rid), errorStatus: decInt(b, es), errorIndex: decInt(b, ei), varbinds: decVarbinds(b, vbs) } };
}

// ---------- Значения в понятном виде ----------

export const ERROR_STATUS: Record<number, string> = {
  1: 'ответ слишком большой (tooBig)',
  2: 'нет такого объекта (noSuchName)',
  3: 'неверное значение (badValue)',
  4: 'только чтение (readOnly)',
  5: 'общая ошибка агента (genErr)',
  6: 'нет доступа (noAccess)',
  16: 'ошибка авторизации (authorizationError)'
};

/** Строка OCTET STRING: текст, если печатный, иначе шестнадцатеричный вид (MAC-адреса и т. п.). */
export function octetsToString(v: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(v);
  // eslint-disable-next-line no-control-regex
  const printable = v.length > 0 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f�]/.test(text.replace(/\0+$/, ''));
  if (printable) return text.replace(/\0+$/, '');
  return Array.from(v, (x) => x.toString(16).padStart(2, '0')).join(':');
}

export function valueToString(v: SnmpValue): string {
  switch (v.type) {
    case 'int':
    case 'counter':
    case 'gauge':
      return String(v.value);
    case 'ticks':
      return formatTicks(v.value);
    case 'str':
      return octetsToString(v.value);
    case 'opaque':
      return Array.from(v.value, (x) => x.toString(16).padStart(2, '0')).join(' ');
    case 'oid':
    case 'ip':
    case 'counter64':
      return v.value;
    case 'null':
      return '';
    default:
      return v.type;
  }
}

/** TimeTicks (сотые доли секунды) → «3 д 4 ч 12 мин». */
export function formatTicks(ticks: number): string {
  const s = Math.floor(ticks / 100);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} д ${h} ч ${m} мин`;
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин`;
  return `${s} с`;
}

export function oidStartsWith(oid: string, prefix: string): boolean {
  return oid === prefix || oid.startsWith(`${prefix}.`);
}

// ---------- Трапы ----------

export interface ParsedTrap {
  version: 1 | 2;
  community: string;
  /** Адрес агента из трапа v1 (может отличаться от адреса отправителя пакета). */
  agentAddr?: string;
  trapOid: string;
  /** Понятное название события. */
  name: string;
  /** Время работы агента в сотых долях секунды. */
  uptime?: number;
  /** Номер порта для linkDown / linkUp. */
  ifIndex?: number;
  /** Имя или описание порта, если пришло в трапе. */
  ifLabel?: string;
  varbinds: VarBind[];
  /** InformRequest — требует ответа. */
  inform: boolean;
  requestId?: number;
}

const STD_TRAPS = '1.3.6.1.6.3.1.1.5';

export const TRAP_NAMES: Record<string, string> = {
  [`${STD_TRAPS}.1`]: 'Перезапуск устройства (coldStart)',
  [`${STD_TRAPS}.2`]: 'Перезапуск SNMP-агента (warmStart)',
  [`${STD_TRAPS}.3`]: 'Порт отключился (linkDown)',
  [`${STD_TRAPS}.4`]: 'Порт включился (linkUp)',
  [`${STD_TRAPS}.5`]: 'Неверная community при запросе (authenticationFailure)',
  [`${STD_TRAPS}.6`]: 'Потерян сосед EGP (egpNeighborLoss)',
  '1.3.6.1.4.1.9.9.41.2.0.1': 'Сообщение журнала Cisco (clogMessageGenerated)',
  '1.3.6.1.4.1.9.9.43.2.0.1': 'Изменена конфигурация Cisco (ccmCLIRunningConfigChanged)',
  '1.3.6.1.4.1.9.9.43.2.0.2': 'Изменена конфигурация Cisco (ciscoConfigManEvent)',
  '1.3.6.1.4.1.9.0.0': 'Перезагрузка Cisco (reload)',
  '1.3.6.1.2.1.47.2.0.1': 'Изменилась конфигурация оборудования (entConfigChange)',
  '1.3.6.1.2.1.17.0.1': 'Новый корневой мост STP (newRoot)',
  '1.3.6.1.2.1.17.0.2': 'Изменение топологии STP (topologyChange)',
  '1.3.6.1.2.1.105.0.1': 'Изменилось состояние PoE на порту (pethPsePortOnOffNotification)',
  '1.3.6.1.2.1.105.0.2': 'Превышена мощность PoE (pethMainPowerUsageOnNotification)'
};

export const TRAP = {
  coldStart: `${STD_TRAPS}.1`,
  warmStart: `${STD_TRAPS}.2`,
  linkDown: `${STD_TRAPS}.3`,
  linkUp: `${STD_TRAPS}.4`,
  authFailure: `${STD_TRAPS}.5`
} as const;

export function trapName(oid: string): string {
  return TRAP_NAMES[oid] ?? `Трап ${oid}`;
}

function portInfo(vbs: VarBind[]): { ifIndex?: number; ifLabel?: string } {
  let ifIndex: number | undefined;
  let ifLabel: string | undefined;
  for (const vb of vbs) {
    for (const col of [OID.ifIndex, OID.ifDescr, OID.ifAdminStatus, OID.ifOperStatus, OID.ifName, OID.ifAlias]) {
      if (oidStartsWith(vb.oid, col) && vb.oid.length > col.length) {
        const idx = Number(vb.oid.slice(col.length + 1).split('.')[0]);
        if (Number.isInteger(idx)) ifIndex ??= idx;
        if ((col === OID.ifDescr || col === OID.ifName) && vb.value.type === 'str') ifLabel ??= octetsToString(vb.value.value);
        if (col === OID.ifAlias && vb.value.type === 'str' && !ifLabel) ifLabel = octetsToString(vb.value.value) || undefined;
      }
    }
    if (vb.oid.startsWith(`${OID.ifIndex}.`) && vb.value.type === 'int') ifIndex = vb.value.value;
  }
  return { ifIndex, ifLabel };
}

/** Трап v1, v2c или inform → единый вид. Возвращает null для запросов и ответов. */
export function parseTrap(m: SnmpMessage): ParsedTrap | null {
  if (m.pdu.type === TAG.TRAP_V1) {
    const t = m.pdu as TrapV1Pdu;
    const trapOid = t.generic === 6 ? `${t.enterprise}.0.${t.specific}` : `${STD_TRAPS}.${t.generic + 1}`;
    return { version: 1, community: m.community, agentAddr: t.agentAddr, trapOid, name: trapName(trapOid), uptime: t.timestamp, ...portInfo(t.varbinds), varbinds: t.varbinds, inform: false };
  }
  const p = m.pdu as SnmpPdu;
  if (p.type !== TAG.TRAP_V2 && p.type !== TAG.INFORM) return null;
  const up = p.varbinds.find((v) => v.oid === OID.sysUpTime);
  const to = p.varbinds.find((v) => v.oid === OID.snmpTrapOID);
  const trapOid = to && to.value.type === 'oid' ? to.value.value : '';
  const rest = p.varbinds.filter((v) => v !== up && v !== to);
  return {
    version: 2,
    community: m.community,
    trapOid,
    name: trapOid ? trapName(trapOid) : 'Трап без snmpTrapOID',
    uptime: up && up.value.type === 'ticks' ? up.value.value : undefined,
    ...portInfo(rest),
    varbinds: rest,
    inform: p.type === TAG.INFORM,
    requestId: p.requestId
  };
}

/** Ответ на InformRequest: те же переменные, тип Response. */
export function buildInformResponse(m: SnmpMessage): Uint8Array {
  const p = m.pdu as SnmpPdu;
  return encodeMessage({ version: m.version, community: m.community, pdu: { type: TAG.RESPONSE, requestId: p.requestId, errorStatus: 0, errorIndex: 0, varbinds: p.varbinds } });
}

export function str(s: string): SnmpValue {
  return { type: 'str', value: new TextEncoder().encode(s) };
}
