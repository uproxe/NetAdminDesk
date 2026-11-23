// Мониторинг в режиме предпросмотра: демонстрационные узлы (адреса из документационного диапазона 192.0.2.0/24
// и 198.51.100.0/24), состояния меняются по таймеру, чтобы было видно «живую» карту.
import type { NadApi, NadEvent } from '../../src/shared/ipc';
import { DEFAULT_MONITOR, type MonitorEvent, type MonitorMap, type MonitorNode, type MonitorState, type MonitorStatusInfo } from '../../src/shared/monitor';

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();

export function createMonitorMock(emit: (e: NadEvent) => void): NadApi['monitor'] {
  let nextId = 1;
  const nodes: MonitorNode[] = [];
  const add = (name: string, host: string, kind: MonitorNode['kind'], method: MonitorNode['method'] = 'ping', extra: Partial<MonitorNode> = {}) => {
    const n: MonitorNode = { id: nextId++, name, host, kind, vendor: '', method, snmpVersion: 2, snmpPort: 161, tcpPort: method === 'tcp' ? 554 : 0, intervalSec: 0, enabled: true, deviceId: null, notes: '', hasCommunity: method === 'snmp', createdAt: iso(5000), updatedAt: iso(5000), ...extra };
    nodes.push(n);
    return n;
  };
  const core = add('SW-CORE-1', '192.0.2.1', 'switch', 'snmp', { vendor: 'cisco', deviceId: 1 });
  const fw = add('UserGate NGFW', '192.0.2.254', 'firewall', 'snmp', { vendor: 'usergate' });
  const acc = [1, 2, 3, 4].map((i) => add(`SW-ACCESS-${i}`, `192.0.2.1${i}`, 'switch', 'snmp', { vendor: i === 3 ? 'osnovo' : 'cisco', deviceId: i === 3 ? 3 : null }));
  const vms = [1, 2].map((i) => add(`Видеосервер ${i}`, `192.0.2.5${i}`, 'vms', 'tcp'));
  const srv = add('Файловый сервер', '192.0.2.21', 'server', 'ping', { vendor: 'linux', deviceId: 5 });
  const cams = [1, 2, 3, 4, 5, 6].map((i) => add(`Камера ${i}`, `198.51.100.${10 + i}`, 'camera'));
  const ap = add('Wi-Fi 2 этаж', '192.0.2.70', 'ap');

  const states = new Map<number, MonitorState>();
  const base = (n: MonitorNode, minAgo = 600): MonitorState => ({ nodeId: n.id, status: 'up', since: iso(minAgo), lastCheck: iso(0.2), latencyMs: 1 + (n.id % 4), message: n.method === 'snmp' ? 'отвечает по SNMP' : n.method === 'tcp' ? 'TCP-порт 554 открыт' : 'отвечает на ping', failCount: 0, portsDown: [], sysName: n.method === 'snmp' ? n.name : undefined, uptimeTicks: n.method === 'snmp' ? 51840000 : undefined });
  for (const n of nodes) states.set(n.id, base(n));
  states.set(cams[3].id, { ...base(cams[3]), status: 'down', since: iso(17), latencyMs: null, message: 'не в сети: нет ответа на ping', failCount: 34 });
  states.set(acc[1].id, { ...base(acc[1]), status: 'warn', since: iso(6), portsDown: [{ ifIndex: 5, label: 'Gi1/0/5 (Камера 4)', since: iso(17) }] });
  states.set(vms[1].id, { ...base(vms[1]), status: 'warn', since: iso(42), message: 'TCP-порт 554: нет ответа (фильтруется или узел недоступен)' });

  const events: MonitorEvent[] = [];
  let evId = 1;
  const ev = (minAgo: number, node: MonitorNode | null, level: MonitorEvent['level'], type: MonitorEvent['type'], message: string) => {
    events.unshift({ id: evId++, ts: iso(minAgo), nodeId: node?.id ?? null, nodeName: node?.name ?? '', level, type, message });
  };
  ev(180, null, 'info', 'system', 'приём SNMP-трапов включён: UDP 0.0.0.0:162');
  ev(120, srv, 'warn', 'reboot', 'перезагрузился (работает 3 мин)');
  ev(42, vms[1], 'warn', 'warn', 'TCP-порт 554: нет ответа');
  ev(17, acc[1], 'warn', 'trap', 'трап: Порт отключился (linkDown) — порт Gi1/0/5 (Камера 4)');
  ev(17, cams[3], 'crit', 'down', 'не в сети: нет ответа на ping');

  const maps: MonitorMap[] = [];
  const items = [
    { nodeId: fw.id, x: 640, y: 90 },
    { nodeId: core.id, x: 640, y: 230 },
    { nodeId: srv.id, x: 900, y: 230 },
    ...vms.map((n, i) => ({ nodeId: n.id, x: 1200 + i * 150, y: 590 })),
    ...acc.map((n, i) => ({ nodeId: n.id, x: 220 + i * 280, y: 400 })),
    ...cams.map((n, i) => ({ nodeId: n.id, x: 120 + i * 130, y: 590 })),
    { nodeId: ap.id, x: 940, y: 590 }
  ];
  const links = [
    { a: fw.id, b: core.id, label: '' },
    { a: core.id, b: srv.id, label: '' },
    ...acc.map((n) => ({ a: core.id, b: n.id, label: '' })),
    ...vms.map((n) => ({ a: acc[3].id, b: n.id, label: '' })),
    { a: acc[0].id, b: cams[0].id, label: '' },
    { a: acc[0].id, b: cams[1].id, label: '' },
    { a: acc[1].id, b: cams[2].id, label: '' },
    { a: acc[1].id, b: cams[3].id, label: 'Gi1/0/5' },
    { a: acc[2].id, b: cams[4].id, label: '' },
    { a: acc[2].id, b: cams[5].id, label: '' },
    { a: acc[3].id, b: ap.id, label: '' }
  ];
  maps.push({ id: 1, name: 'Демо: сеть видеонаблюдения', background: '', width: 1400, height: 720, items, links: links.map((l, i) => ({ ...l, id: i + 1 })), createdAt: iso(5000), updatedAt: iso(60) });

  const status = (): MonitorStatusInfo => {
    const counts = { up: 0, warn: 0, down: 0, unknown: 0, paused: 0 };
    for (const s of states.values()) counts[s.status]++;
    return { running: true, trap: { enabled: true, listening: true, port: 162, bind: '0.0.0.0', error: '', received: 37, dropped: 0 }, counts, canStoreSecrets: true, emailPassword: false, trapCommunity: false, mailQueue: 0, lastMailError: '', localAddresses: ['192.0.2.100'] };
  };
  // «Мигание»: камера 6 периодически пропадает и возвращается
  let flip = false;
  setInterval(() => {
    flip = !flip;
    const n = cams[5];
    const s: MonitorState = flip ? { ...base(n), status: 'down', since: new Date().toISOString(), latencyMs: null, message: 'не в сети: нет ответа на ping', failCount: 2 } : { ...base(n, 0) };
    states.set(n.id, s);
    ev(0, n, flip ? 'crit' : 'ok', flip ? 'down' : 'up', flip ? 'не в сети: нет ответа на ping' : 'снова в сети (не было 1 мин)');
    emit({ type: 'monitor:states', states: [s] });
    emit({ type: 'monitor:event', event: events[0] });
    emit({ type: 'monitor:status', status: status() });
  }, 20000);

  return {
    status: async () => status(),
    states: async () => [...states.values()],
    nodes: async () => nodes.slice(),
    saveNode: async (n) => {
      const { community, ...rest } = n;
      const ex = rest.id ? nodes.find((x) => x.id === rest.id) : undefined;
      if (ex) Object.assign(ex, rest, { hasCommunity: community ? true : community === '' ? false : ex.hasCommunity, updatedAt: iso(0) });
      else {
        const nn: MonitorNode = { ...(rest as MonitorNode), id: nextId++, hasCommunity: !!community, createdAt: iso(0), updatedAt: iso(0) };
        nodes.push(nn);
        states.set(nn.id, { ...base(nn, 0), status: 'unknown', message: '' });
      }
      return ex ?? nodes[nodes.length - 1];
    },
    removeNode: async (id) => {
      nodes.splice(nodes.findIndex((n) => n.id === id), 1);
      states.delete(id);
    },
    bulkAdd: async (list) => {
      for (const n of list) {
        const nn: MonitorNode = { ...(n as MonitorNode), id: nextId++, hasCommunity: !!n.community, createdAt: iso(0), updatedAt: iso(0) };
        nodes.push(nn);
        states.set(nn.id, { ...base(nn, 0) });
      }
      return list.length;
    },
    maps: async () => maps.map((m) => ({ ...m, items: m.items.slice(), links: m.links.slice() })),
    saveMap: async (m) => {
      const ex = m.id ? maps.find((x) => x.id === m.id) : undefined;
      const r: MonitorMap = { ...(m as MonitorMap), id: ex?.id ?? maps.length + 1, createdAt: ex?.createdAt ?? iso(0), updatedAt: iso(0) };
      if (ex) maps[maps.indexOf(ex)] = r;
      else maps.push(r);
      return r;
    },
    removeMap: async (id) => void maps.splice(maps.findIndex((m) => m.id === id), 1),
    events: async (f) => events.filter((e) => !f?.nodeId || e.nodeId === f.nodeId).slice(0, f?.limit ?? 500),
    clearEvents: async () => void events.splice(0),
    checkNow: async (id) => states.get(id),
    ports: async () => [
      { ifIndex: 1, name: 'Gi1/0/1', alias: 'Uplink SW-CORE-1', oper: 'up', admin: 'up', speedMbps: 1000 },
      { ifIndex: 2, name: 'Gi1/0/2', alias: 'Камера 1', oper: 'up', admin: 'up', speedMbps: 100 },
      { ifIndex: 3, name: 'Gi1/0/3', alias: '', oper: 'down', admin: 'up', speedMbps: 0 },
      { ifIndex: 5, name: 'Gi1/0/5', alias: 'Камера 4', oper: 'down', admin: 'up', speedMbps: 0 },
      { ifIndex: 8, name: 'Gi1/0/8', alias: 'резерв', oper: 'down', admin: 'down', speedMbps: 0 }
    ],
    clearPorts: async (id) => {
      const s = states.get(id);
      if (s) states.set(id, { ...s, portsDown: [], status: 'up' });
    },
    setSecret: async () => undefined,
    testMail: async () => undefined,
    applySettings: async () => status()
  };
}

export const MOCK_MONITOR_SETTINGS = { ...DEFAULT_MONITOR, trap: { ...DEFAULT_MONITOR.trap, enabled: true } };
