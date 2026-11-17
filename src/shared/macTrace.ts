// Разбор вывода таблиц MAC/FDB и соседей CDP/LLDP для поиска и трассировки устройства по MAC.
// Разбор эвристический: исходные строки всегда показываются пользователю, предположения помечаются.
import { findMacsInText } from './mac';

export interface MacHit {
  line: string;
  vlan?: string;
  port?: string;
}

const PORT_RE = /^(?:(?:Gi|Fa|Te|Tw|Fo|Hu|Eth|Et|Po|Ten|Gig|Fas|ge|xe|xg|e|g|f|t|trk|Trk|port|lag|ae|eth)\S*\d|\d{1,3}(?:\/\d{1,3}){1,2}|[A-Za-z]\d{1,3})$/i;

function isPort(tok: string): boolean {
  if (/^(dynamic|static|learned|self|management|secure|config|vlan|mac|address|type|ports?|cpu)$/i.test(tok)) return false;
  return PORT_RE.test(tok);
}

/** Находит строки с MAC и извлекает VLAN и порт (если формат строки похож на таблицу MAC). */
export function parseMacTable(output: string, hex12: string, platform?: string): MacHit[] {
  const hits: MacHit[] = [];
  for (const line of output.split(/\r?\n/)) {
    const macs = findMacsInText(line);
    const m = macs.find((x) => x.hex === hex12);
    if (!m) continue;
    const before = line.slice(0, m.index);
    const after = line.slice(m.index + m.raw.length);
    const tokens = `${before} ${after}`.trim().split(/[\s|,]+/).filter(Boolean);
    let vlan: string | undefined;
    let port: string | undefined;
    // VLAN — число 1–4094 (в Cisco стоит перед MAC); у AlliedWare/OSNOVO может быть после
    const vlanMatch = /vlan[\s=:]*(\d{1,4})/i.exec(line);
    if (vlanMatch) vlan = vlanMatch[1];
    else {
      const nums = before.trim().split(/\s+/).filter((t) => /^\d{1,4}$/.test(t) && +t >= 1 && +t <= 4094);
      if (nums.length) vlan = nums[nums.length - 1];
    }
    const portCandidates = tokens.filter((t) => isPort(t) && t !== vlan);
    if (platform === 'alliedware') {
      // AlliedWare: «… port 3 …» — номер порта отдельным числом
      const pm = /port[\s=:]*(\d+)/i.exec(line);
      if (pm) port = pm[1];
    }
    if (!port && portCandidates.length) port = portCandidates[portCandidates.length - 1];
    if (!port) {
      const lastNum = after.trim().split(/\s+/).filter((t) => /^\d{1,3}$/.test(t)).pop();
      if (lastNum && lastNum !== vlan) port = lastNum;
    }
    hits.push({ line: line.trim(), vlan, port });
  }
  return hits;
}

export interface Neighbor {
  localPort: string;
  name: string;
  ip?: string;
  remotePort?: string;
  platform?: string;
  source: 'cdp' | 'lldp' | 'table';
}

/** Нормализация имени порта для сравнения: GigabitEthernet1/0/24 ≈ Gi1/0/24 ≈ gi1/0/24. */
export function normalizePort(p: string): string {
  const m = /^([A-Za-z-]*)\s*([\d/.:]+)$/.exec(p.trim());
  if (!m) return p.trim().toLowerCase();
  const prefix = m[1].toLowerCase();
  const short = prefix.startsWith('tengig') || prefix.startsWith('te') ? 'te' : prefix.startsWith('gi') ? 'gi' : prefix.startsWith('fa') ? 'fa' : prefix.startsWith('fo') ? 'fo' : prefix.startsWith('tw') ? 'tw' : prefix.startsWith('eth') || prefix === 'e' ? 'e' : prefix.slice(0, 2);
  return `${short}${m[2]}`;
}

export function samePort(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return normalizePort(a) === normalizePort(b);
}

/** CDP: «show cdp neighbors detail». */
export function parseCdpDetail(text: string): Neighbor[] {
  const out: Neighbor[] = [];
  const blocks = text.split(/-{5,}/);
  for (const b of blocks) {
    const name = /Device ID:\s*(\S+)/i.exec(b)?.[1];
    const local = /Interface:\s*([^,\n]+),/i.exec(b)?.[1];
    if (!name || !local) continue;
    out.push({
      name,
      localPort: local.trim(),
      ip: /(?:IP(?:v4)? address|IPv4 Address):\s*(\d+\.\d+\.\d+\.\d+)/i.exec(b)?.[1],
      remotePort: /Port ID \(outgoing port\):\s*(\S+)/i.exec(b)?.[1],
      platform: /Platform:\s*([^,\n]+)/i.exec(b)?.[1]?.trim(),
      source: 'cdp'
    });
  }
  return out;
}

/** LLDP (Cisco): «show lldp neighbors detail». */
export function parseLldpDetail(text: string): Neighbor[] {
  const out: Neighbor[] = [];
  const blocks = text.split(/-{5,}/);
  for (const b of blocks) {
    const local = /Local Intf:\s*(\S+)/i.exec(b)?.[1];
    const name = /System Name:\s*(\S+)/i.exec(b)?.[1] ?? /Chassis id:\s*(\S+)/i.exec(b)?.[1];
    if (!local || !name) continue;
    out.push({
      localPort: local,
      name,
      ip: /(?:IP|IPv4):\s*(\d+\.\d+\.\d+\.\d+)/i.exec(b)?.[1],
      remotePort: /Port id:\s*(\S+)/i.exec(b)?.[1],
      source: 'lldp'
    });
  }
  return out;
}

/** Табличные форматы (HP «show lldp info remote-device», краткий «show cdp neighbors»): первая колонка — локальный порт или имя. */
export function parseNeighborTable(text: string): Neighbor[] {
  const out: Neighbor[] = [];
  for (const line of text.split(/\r?\n/)) {
    // HP: «  1        | 00 11 22 33 44 55  1     ...  sw-core»
    const hp = /^\s*(\S+)\s*\|\s*(.+)$/.exec(line);
    if (hp && isPort(hp[1])) {
      const cols = hp[2].trim().split(/\s{2,}|\s*\|\s*/).filter(Boolean);
      out.push({ localPort: hp[1], name: cols[cols.length - 1] ?? '', source: 'table' });
      continue;
    }
    // Cisco кратко: «sw-access-2   Gig 1/0/24   171   S I   WS-C2960  Gig 0/1»
    const cs = /^(\S+)\s+((?:Gig|Fas|Ten|Eth|Gi|Fa|Te)\s?\d[\d/]*)\s+\d+\s+/.exec(line);
    if (cs) out.push({ localPort: cs[2].replace(/\s+/g, ''), name: cs[1], source: 'table' });
  }
  return out;
}

export function parseNeighbors(text: string): Neighbor[] {
  const detail = [...parseCdpDetail(text), ...parseLldpDetail(text)];
  return detail.length ? detail : parseNeighborTable(text);
}
