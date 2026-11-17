import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMacTable, parseCdpDetail, parseLldpDetail, parseNeighborTable, samePort } from '../../src/shared/macTrace';

test('Cisco: строка таблицы MAC → VLAN и порт', () => {
  const out = `          Mac Address Table
-------------------------------------------
Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
 108    0011.2233.4455    DYNAMIC     Gi1/0/5
Total Mac Addresses for this criterion: 1`;
  const h = parseMacTable(out, '001122334455');
  assert.deepEqual(h.map(({ vlan, port }) => ({ vlan, port })), [{ vlan: '108', port: 'Gi1/0/5' }]);
});

test('AlliedWare/AT-8000S: формат с дефисами', () => {
  const at = ' 108     00-25-90-aa-bb-01    e23     dynamic';
  assert.deepEqual(parseMacTable(at, '002590aabb01').map((x) => x.port), ['e23']);
  const aw = ' 00-1a-2b-3c-4d-5e   18   3   dynamic';
  const h = parseMacTable(aw, '001a2b3c4d5e', 'alliedware')[0];
  assert.equal(h.line.includes('00-1a-2b'), true);
});

test('Поиск MAC в другом формате, чем в выводе', () => {
  const out = ' 20    00:11:22:33:44:55   ge1/5   dynamic';
  const h = parseMacTable(out, '001122334455')[0];
  assert.equal(h.port, 'ge1/5');
});

test('CDP и LLDP detail', () => {
  const cdp = `-------------------------
Device ID: sw-access-2.domain.local
Entry address(es):
  IP address: 10.10.1.12
Platform: cisco WS-C2960X-48FPD-L,  Capabilities: Switch IGMP
Interface: GigabitEthernet1/0/24,  Port ID (outgoing port): GigabitEthernet1/0/49
-------------------------
Device ID: ap-01
  IP address: 10.10.9.5
Interface: GigabitEthernet1/0/3,  Port ID (outgoing port): GigabitEthernet0`;
  const n = parseCdpDetail(cdp);
  assert.equal(n.length, 2);
  assert.equal(n[0].ip, '10.10.1.12');
  assert.ok(samePort(n[0].localPort, 'Gi1/0/24'));
  const lldp = `------------------------------------------------
Local Intf: Gi1/0/48
Chassis id: 0011.2233.4455
Port id: ge1/1
System Name: osnovo-sw3
Management Addresses:
    IP: 10.10.102.117`;
  const l = parseLldpDetail(lldp);
  assert.equal(l[0].name, 'osnovo-sw3');
  assert.equal(l[0].ip, '10.10.102.117');
});

test('Табличный CDP', () => {
  const t = 'sw-access-2   Gig 1/0/24   171   S I   WS-C2960  Gig 0/1';
  const n = parseNeighborTable(t);
  assert.equal(n[0].name, 'sw-access-2');
  assert.ok(samePort(n[0].localPort, 'GigabitEthernet1/0/24'));
});
