// Калькулятор IPv4-подсетей: маска ↔ префикс ↔ wildcard, адрес сети, широковещательный адрес,
// диапазон узлов, деление сети на подсети, проверка «входит ли адрес в сеть».

export function parseIPv4(s: string): number | null {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function ipToStr(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function maskFromPrefix(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Префикс по маске; null — маска с «дырками» (не непрерывная). */
export function prefixFromMask(mask: number): number | null {
  const inv = ~mask >>> 0;
  if ((inv & (inv + 1)) !== 0) return null;
  let p = 0;
  for (let m = mask; m & 0x80000000; m = (m << 1) >>> 0) p++;
  return p;
}

export interface ParsedNet {
  ip: number;
  prefix: number;
  /** Как была указана маска: префикс (/24), маска (255.255.255.0) или wildcard (0.0.0.255). */
  given: 'prefix' | 'mask' | 'wildcard' | 'none';
}

/**
 * Принимает «192.168.1.10/24», «192.168.1.10 255.255.255.0», «192.168.1.10 0.0.0.255» (wildcard из ACL),
 * «192.168.1.10/255.255.255.0» или просто адрес (тогда /32 для узла, при отсутствии маски — классовая не угадывается).
 */
export function parseNetInput(input: string): ParsedNet | { error: string } {
  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return { error: 'Введите адрес, например 192.168.1.10/24' };
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\s*\/\s*(\d{1,2})|[\s/]+(\d{1,3}(?:\.\d{1,3}){3}))?$/.exec(s);
  if (!m) return { error: 'Не похоже на IPv4-адрес. Пример: 10.0.5.17/26 или 10.0.5.17 255.255.255.192' };
  const ip = parseIPv4(m[1]);
  if (ip === null) return { error: `Неверный адрес ${m[1]}: каждое число должно быть от 0 до 255` };
  if (m[2] !== undefined) {
    const p = Number(m[2]);
    if (p > 32) return { error: 'Префикс должен быть от 0 до 32' };
    return { ip, prefix: p, given: 'prefix' };
  }
  if (m[3] !== undefined) {
    const v = parseIPv4(m[3]);
    if (v === null) return { error: `Неверная маска ${m[3]}` };
    const asMask = prefixFromMask(v);
    // 0.0.0.0 считаем маской /0 только если это явно маска; 255.255.255.255 — маска /32
    if (asMask !== null && (v >>> 31 === 1 || v === 0)) return { ip, prefix: asMask, given: 'mask' };
    const asWild = prefixFromMask(~v >>> 0);
    if (asWild !== null) return { ip, prefix: asWild, given: 'wildcard' };
    return { error: `${m[3]} — ни маска, ни wildcard: единицы и нули должны идти подряд` };
  }
  return { ip, prefix: 32, given: 'none' };
}

export interface SubnetInfo {
  ip: string;
  prefix: number;
  mask: string;
  wildcard: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  /** Количество адресов для узлов. */
  hosts: number;
  total: number;
  kind: string;
  /** Адрес совпадает с адресом сети или широковещательным (на интерфейс так не назначают). */
  ipIsSpecial: 'network' | 'broadcast' | null;
}

export function addressKind(n: number): string {
  const a = n >>> 24;
  const b = (n >>> 16) & 255;
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'частный (RFC 1918), в интернет не маршрутизируется';
  if (a === 127) return 'loopback — сам компьютер';
  if (a === 169 && b === 254) return 'link-local (APIPA): DHCP не ответил';
  if (a === 100 && b >= 64 && b <= 127) return 'CGNAT провайдера (100.64.0.0/10)';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'зарезервирован';
  if (a === 0) return '«этот хост» / не задан';
  return 'публичный (белый)';
}

export function subnetInfo(ip: number, prefix: number): SubnetInfo {
  const mask = maskFromPrefix(prefix);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  let first = network + 1;
  let last = broadcast - 1;
  let hosts = Math.max(0, total - 2);
  if (prefix === 32) {
    first = last = network;
    hosts = 1;
  } else if (prefix === 31) {
    // RFC 3021: оба адреса /31 используются на соединениях «точка-точка»
    first = network;
    last = broadcast;
    hosts = 2;
  }
  return {
    ip: ipToStr(ip),
    prefix,
    mask: ipToStr(mask),
    wildcard: ipToStr(~mask >>> 0),
    network: ipToStr(network),
    broadcast: ipToStr(broadcast),
    firstHost: ipToStr(first),
    lastHost: ipToStr(last),
    hosts,
    total,
    kind: addressKind(ip),
    ipIsSpecial: prefix < 31 && ip === network ? 'network' : prefix < 31 && ip === broadcast ? 'broadcast' : null
  };
}

/** Деление сети на подсети с новым префиксом (не более limit штук). */
export function splitSubnet(ip: number, prefix: number, newPrefix: number, limit = 256): { network: string; first: string; last: string; broadcast: string }[] {
  if (newPrefix < prefix || newPrefix > 32) return [];
  const base = (ip & maskFromPrefix(prefix)) >>> 0;
  const size = 2 ** (32 - newPrefix);
  const count = Math.min(limit, 2 ** (newPrefix - prefix));
  const out: { network: string; first: string; last: string; broadcast: string }[] = [];
  for (let i = 0; i < count; i++) {
    const n = base + i * size;
    const info = subnetInfo(n, newPrefix);
    out.push({ network: `${info.network}/${newPrefix}`, first: info.firstHost, last: info.lastHost, broadcast: info.broadcast });
  }
  return out;
}

/** Минимальный префикс, вмещающий нужное число узлов. */
export function prefixForHosts(hosts: number): number {
  for (let p = 30; p >= 0; p--) if (2 ** (32 - p) - 2 >= hosts) return p;
  return 0;
}

export function inSubnet(ip: number, net: number, prefix: number): boolean {
  const m = maskFromPrefix(prefix);
  return ((ip & m) >>> 0) === ((net & m) >>> 0);
}
