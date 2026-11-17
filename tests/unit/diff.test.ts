import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, toHunks, diffStats, VOLATILE_CONFIG_LINES } from '../../src/shared/diff';

test('diff восстанавливает обе версии', () => {
  const a = 'hostname sw1\n!\ninterface Gi1/0/1\n description PC\n switchport access vlan 10\n!\nend';
  const b = 'hostname sw1\n!\ninterface Gi1/0/1\n description CAMERA\n switchport access vlan 20\n spanning-tree portfast\n!\nend';
  const ops = diffLines(a, b);
  assert.equal(ops.filter((o) => o.type !== 'add').map((o) => o.text).join('\n'), a);
  assert.equal(ops.filter((o) => o.type !== 'del').map((o) => o.text).join('\n'), b);
  assert.deepEqual(diffStats(ops), { added: 3, removed: 2, unchanged: 5 });
  assert.equal(toHunks(ops, 1).length, 1);
});

test('игнорирование изменчивых строк', () => {
  const a = '! Last configuration change at 10:00\nhostname sw1';
  const b = '! Last configuration change at 12:00\nhostname sw1';
  assert.equal(diffStats(diffLines(a, b, { ignorePattern: VOLATILE_CONFIG_LINES })).added, 0);
});

test('пустые и одинаковые тексты', () => {
  assert.equal(toHunks(diffLines('a\nb', 'a\nb')).length, 0);
  assert.equal(diffStats(diffLines('', 'x')).added, 1);
});
