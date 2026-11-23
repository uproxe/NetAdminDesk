import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { OID, SNMP_V1, SNMP_V2C, TAG, buildRequest, decodeMessage, encodeMessage, encodeOid, formatTicks, octetsToString, parseTrap, str, type SnmpPdu, type VarBind } from '../../src/shared/snmp';
import { SnmpClient, readPorts } from '../../src/main/monitor/snmpClient';
import { TrapReceiver, type TrapEvent } from '../../src/main/monitor/trapReceiver';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('SNMP: кодирование совпадает с эталонным пакетом GET sysDescr.0 (v2c, public)', () => {
  // Эталон собран вручную по X.690: SEQUENCE { INTEGER 1, OCTET STRING "public", GetRequest { id 1, 0, 0, { { 1.3.6.1.2.1.1.1.0, NULL } } } }
  const ref = '302602010104067075626c6963a019020101020100020100300e300c06082b060102010101000500';
  assert.equal(hex(buildRequest(TAG.GET, SNMP_V2C, 'public', 1, [OID.sysDescr])), ref);
  assert.deepEqual(encodeOid('1.3.6.1.4.1.45741.1'), [0x2b, 6, 1, 4, 1, 0x82, 0xe5, 0x2d, 1]);
  assert.throws(() => encodeOid('1'), /Неверный OID/);
});

test('SNMP: разбор и обратная сборка всех типов значений', () => {
  const vbs: VarBind[] = [
    { oid: '1.3.6.1.2.1.1.5.0', value: str('SW-ACCESS-1') },
    { oid: '1.3.6.1.2.1.1.3.0', value: { type: 'ticks', value: 4294967295 } },
    { oid: '1.3.6.1.2.1.2.2.1.8.5', value: { type: 'int', value: 2 } },
    { oid: '1.3.6.1.2.1.4.1.0', value: { type: 'int', value: -129 } },
    { oid: '1.3.6.1.2.1.2.2.1.10.1', value: { type: 'counter', value: 3000000000 } },
    { oid: '1.3.6.1.2.1.31.1.1.1.6.1', value: { type: 'counter64', value: '18446744073709551615' } },
    { oid: '1.3.6.1.2.1.4.20.1.1.10.10.0.1', value: { type: 'ip', value: '10.10.0.1' } },
    { oid: '1.3.6.1.2.1.1.2.0', value: { type: 'oid', value: '1.3.6.1.4.1.9.1.1208' } },
    { oid: '1.3.6.1.2.1.1.9.1.2.1', value: { type: 'noSuchInstance' } },
    { oid: '1.3.6.1.2.1.2.2.1.6.1', value: { type: 'str', value: Uint8Array.from([0, 0x11, 0x22, 0x33, 0x44, 0x55]) } }
  ];
  const long = 'x'.repeat(300);
  vbs.push({ oid: OID.sysDescr, value: str(long) });
  const m = decodeMessage(encodeMessage({ version: SNMP_V2C, community: 'public', pdu: { type: TAG.RESPONSE, requestId: 2147483646, errorStatus: 0, errorIndex: 0, varbinds: vbs } }));
  const p = m.pdu as SnmpPdu;
  assert.equal(p.requestId, 2147483646);
  assert.deepEqual(p.varbinds, vbs);
  assert.equal(octetsToString((vbs[9].value as { value: Uint8Array }).value), '00:11:22:33:44:55');
  assert.equal(formatTicks(36615000), '4 д 5 ч 42 мин');
  assert.throws(() => decodeMessage(Uint8Array.from([0x30, 0x05, 0x02, 0x01])), /обрезан/);
  assert.throws(() => decodeMessage(Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x03])), /SNMPv3/);
});

test('SNMP: трапы v1 и v2c, inform, номер и имя порта', () => {
  const v1 = decodeMessage(
    encodeMessage({
      version: SNMP_V1,
      community: 'public',
      pdu: { type: TAG.TRAP_V1, enterprise: '1.3.6.1.4.1.9.1.516', agentAddr: '10.10.1.11', generic: 2, specific: 0, timestamp: 12345, varbinds: [{ oid: `${OID.ifIndex}.10105`, value: { type: 'int', value: 10105 } }] }
    })
  );
  const t1 = parseTrap(v1)!;
  assert.equal(t1.trapOid, '1.3.6.1.6.3.1.1.5.3');
  assert.match(t1.name, /linkDown/);
  assert.equal(t1.ifIndex, 10105);
  assert.equal(t1.agentAddr, '10.10.1.11');
  const ent = parseTrap(decodeMessage(encodeMessage({ version: SNMP_V1, community: 'p', pdu: { type: TAG.TRAP_V1, enterprise: '1.3.6.1.4.1.45741', agentAddr: '10.10.0.9', generic: 6, specific: 7, timestamp: 1, varbinds: [] } })))!;
  assert.equal(ent.trapOid, '1.3.6.1.4.1.45741.0.7');

  const v2 = encodeMessage({
    version: SNMP_V2C,
    community: 'public',
    pdu: {
      type: TAG.INFORM,
      requestId: 77,
      errorStatus: 0,
      errorIndex: 0,
      varbinds: [
        { oid: OID.sysUpTime, value: { type: 'ticks', value: 500 } },
        { oid: OID.snmpTrapOID, value: { type: 'oid', value: '1.3.6.1.6.3.1.1.5.4' } },
        { oid: `${OID.ifIndex}.5`, value: { type: 'int', value: 5 } },
        { oid: `${OID.ifDescr}.5`, value: str('GigabitEthernet1/0/5') },
        { oid: `${OID.ifAlias}.5`, value: str('Камера 12') }
      ]
    }
  });
  const t2 = parseTrap(decodeMessage(v2))!;
  assert.equal(t2.inform, true);
  assert.match(t2.name, /linkUp/);
  assert.equal(t2.ifIndex, 5);
  assert.equal(t2.ifLabel, 'GigabitEthernet1/0/5');
  assert.equal(t2.uptime, 500);
  assert.equal(parseTrap(decodeMessage(buildRequest(TAG.GET, SNMP_V2C, 'public', 1, [OID.sysName]))), null);
});

/** Простой агент SNMP для тестов: отвечает из таблицы, поддерживает GET, GETNEXT, GETBULK. */
function fakeAgent(table: Record<string, VarBind['value']>, community = 'public'): Promise<{ port: number; close: () => void; requests: number[] }> {
  const keys = Object.keys(table).sort((a, b) => {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
    return 0;
  });
  const after = (oid: string) => {
    const o = oid.split('.').map(Number);
    return keys.find((k) => {
      const x = k.split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, o.length); i++) if ((x[i] ?? -1) !== (o[i] ?? -1)) return (x[i] ?? -1) > (o[i] ?? -1);
      return false;
    });
  };
  const requests: number[] = [];
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.on('message', (msg, r) => {
      const m = decodeMessage(msg);
      if (m.community !== community) return; // как настоящий агент: неверная community — молчание
      const p = m.pdu as SnmpPdu;
      requests.push(p.type);
      let out: VarBind[];
      if (p.type === TAG.GET) out = p.varbinds.map((v) => ({ oid: v.oid, value: table[v.oid] ?? { type: 'noSuchObject' } }));
      else if (p.type === TAG.GET_NEXT) out = p.varbinds.map((v) => { const k = after(v.oid); return k ? { oid: k, value: table[k] } : { oid: v.oid, value: { type: 'endOfMibView' } }; });
      else {
        out = [];
        let cur = p.varbinds[0].oid;
        for (let i = 0; i < p.errorIndex; i++) {
          const k = after(cur);
          if (!k) {
            out.push({ oid: cur, value: { type: 'endOfMibView' } });
            break;
          }
          out.push({ oid: k, value: table[k] });
          cur = k;
        }
      }
      s.send(encodeMessage({ version: m.version, community: m.community, pdu: { type: TAG.RESPONSE, requestId: p.requestId, errorStatus: 0, errorIndex: 0, varbinds: out } }), r.port, r.address);
    });
    s.bind(0, '127.0.0.1', () => resolve({ port: s.address().port, close: () => s.close(), requests }));
  });
}

test('SNMP-клиент: GET, неверная community (таймаут), обход таблицы портов в v1 и v2c', async () => {
  const table: Record<string, VarBind['value']> = {
    [OID.sysName]: str('SW-ACCESS-1'),
    [OID.sysUpTime]: { type: 'ticks', value: 8640000 },
    [`${OID.ifDescr}.1`]: str('GigabitEthernet1/0/1'),
    [`${OID.ifDescr}.2`]: str('GigabitEthernet1/0/2'),
    [`${OID.ifOperStatus}.1`]: { type: 'int', value: 1 },
    [`${OID.ifOperStatus}.2`]: { type: 'int', value: 2 },
    [`${OID.ifAdminStatus}.1`]: { type: 'int', value: 1 },
    [`${OID.ifAdminStatus}.2`]: { type: 'int', value: 1 },
    [`${OID.ifSpeed}.1`]: { type: 'gauge', value: 1000000000 },
    [`${OID.ifName}.1`]: str('Gi1/0/1'),
    [`${OID.ifName}.2`]: str('Gi1/0/2'),
    [`${OID.ifAlias}.2`]: str('Камера 12'),
    ['1.3.6.1.2.1.99.1.0']: { type: 'int', value: 1 }
  };
  const a = await fakeAgent(table);
  const c = new SnmpClient();
  try {
    const t = { host: '127.0.0.1', port: a.port, community: 'public', version: 2 as const, timeoutMs: 500, retries: 0 };
    const r = await c.get(t, [OID.sysName, OID.sysUpTime]);
    assert.equal(octetsToString((r[0].value as { value: Uint8Array }).value), 'SW-ACCESS-1');
    assert.equal((r[1].value as { value: number }).value, 8640000);
    await assert.rejects(c.get({ ...t, community: 'wrong' }, [OID.sysName]), /нет ответа/);
    const ports = await readPorts(c, t);
    assert.deepEqual(
      ports.map((p) => [p.ifIndex, p.name, p.alias, p.oper, p.speedMbps]),
      [
        [1, 'Gi1/0/1', '', 'up', 1000],
        [2, 'Gi1/0/2', 'Камера 12', 'down', 0]
      ]
    );
    assert.ok(a.requests.includes(TAG.GET_BULK));
    const v1 = await c.walk({ ...t, version: 1 }, OID.ifDescr);
    assert.equal(v1.length, 2);
    assert.ok(a.requests.includes(TAG.GET_NEXT));
  } finally {
    c.close();
    a.close();
  }
});

test('Приёмник трапов: принимает трап, подтверждает inform, отбрасывает чужую community', async () => {
  const got: TrapEvent[] = [];
  const r = new TrapReceiver((e) => got.push(e));
  await r.start({ port: 0, bind: '127.0.0.1', community: 'public' });
  // порт 0 — система выбрала свободный; узнаём его через приватный сокет
  const port = (r as unknown as { sock: dgram.Socket }).sock.address().port;
  const sender = dgram.createSocket('udp4');
  const ack = new Promise<Buffer>((resolve) => sender.on('message', (m) => resolve(m)));
  const send = (b: Uint8Array) => new Promise<void>((res) => sender.send(b, port, '127.0.0.1', () => res()));
  const inform = encodeMessage({
    version: SNMP_V2C,
    community: 'public',
    pdu: { type: TAG.INFORM, requestId: 99, errorStatus: 0, errorIndex: 0, varbinds: [{ oid: OID.sysUpTime, value: { type: 'ticks', value: 1 } }, { oid: OID.snmpTrapOID, value: { type: 'oid', value: '1.3.6.1.6.3.1.1.5.1' } }] }
  });
  await send(inform);
  const resp = decodeMessage(await ack);
  assert.equal((resp.pdu as SnmpPdu).type, TAG.RESPONSE);
  assert.equal((resp.pdu as SnmpPdu).requestId, 99);
  await send(encodeMessage({ version: SNMP_V2C, community: 'other', pdu: { type: TAG.TRAP_V2, requestId: 1, errorStatus: 0, errorIndex: 0, varbinds: [] } }));
  await send(Uint8Array.from([1, 2, 3]));
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(got.length, 1);
  assert.equal(got[0].source, '127.0.0.1');
  assert.match(got[0].trap.name, /coldStart/);
  assert.equal(r.dropped, 2);
  sender.close();
  r.stop();
  const busy = dgram.createSocket('udp4');
  await new Promise<void>((res) => busy.bind(0, '127.0.0.1', () => res()));
  await assert.rejects(r.start({ port: busy.address().port, bind: '127.0.0.1' }), /уже занят/);
  busy.close();
});
