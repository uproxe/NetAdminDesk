import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplate, renderTemplate, suggestTemplate, validateParam, BUILTIN_PARAMS } from '../../src/shared/templates';
import { formatMac, parseMac, findMacsInText } from '../../src/shared/mac';

test('разбор и подстановка параметров', () => {
  const p = parseTemplate('show mac address-table address {{MAC}} vlan {{VLAN:1}}');
  assert.deepEqual(p.map((x) => x.name), ['MAC', 'VLAN']);
  assert.equal(p[1].defaultValue, '1');
  const r = renderTemplate('show mac address-table address {{MAC}}', { MAC: '00:11:22:33:44:55' }, { platform: 'cisco-ios' });
  assert.equal(r.text, 'show mac address-table address 0011.2233.4455');
  const r2 = renderTemplate('show switch fdb address={{MAC}}', { MAC: '0011.2233.4455' }, { platform: 'alliedware' });
  assert.equal(r2.text, 'show switch fdb address=00-11-22-33-44-55');
});

test('многострочные шаблоны и пропущенные значения', () => {
  const r = renderTemplate('interface {{INTERFACE}}\nswitchport access vlan {{VLAN}}', { INTERFACE: 'Gi1/0/5' });
  assert.deepEqual(r.missing, ['VLAN']);
  const ok = renderTemplate('interface {{INTERFACE}}\nswitchport access vlan {{VLAN}}', { INTERFACE: 'Gi1/0/5', VLAN: '108' });
  assert.equal(ok.text, 'interface Gi1/0/5\nswitchport access vlan 108');
});

test('проверка значений', () => {
  const def = (n: string) => BUILTIN_PARAMS.find((p) => p.name === n)!;
  assert.equal(validateParam(def('VLAN'), '4095'), 'VLAN должен быть числом 1–4094');
  assert.equal(validateParam(def('VLAN'), '408'), null);
  assert.equal(validateParam(def('IP'), '10.10.26.202'), null);
  assert.ok(validateParam(def('IP'), '300.1.1.1'));
  assert.ok(validateParam(def('MAC'), 'zz:zz'));
  assert.ok(validateParam(def('INTERFACE'), 'ge1/5\nreload'));
});

test('предложение шаблона из исходной команды', () => {
  assert.equal(suggestTemplate('show mac address-table address 0011.2233.4455'), 'show mac address-table address {{MAC}}');
  assert.equal(suggestTemplate('show interfaces gigabitEthernet 1/0/5 counters errors'), 'show interfaces {{INTERFACE}} counters errors');
  assert.equal(suggestTemplate('show bridge fdb interface ge1/5'), 'show bridge fdb interface {{INTERFACE}}');
  assert.equal(suggestTemplate('add vlan="401" port=8 frame=tagged'), 'add vlan="{{VLAN}}" port={{PORT}} frame=tagged');
  assert.equal(suggestTemplate('ip address 10.10.109.30 255.255.255.224'), 'ip address {{IP}} 255.255.255.224');
  assert.equal(suggestTemplate('interface ge1/8 ge1/10'), 'interface {{INTERFACE}} {{INTERFACE2}}');
  assert.equal(suggestTemplate('default interface range fastEthernet 0/1-24'), null);
  assert.equal(suggestTemplate('show version'), null);
});

test('MAC-адреса', () => {
  assert.equal(parseMac('00-1a-2b-3c-4d-5e'), '001a2b3c4d5e');
  assert.equal(parseMac('00aabb-ccddee'), '00aabbccddee');
  assert.equal(formatMac('001a2b3c4d5e', 'cisco'), '001a.2b3c.4d5e');
  assert.equal(formatMac('001a2b3c4d5e', 'hp'), '001a2b-3c4d5e');
  const found = findMacsInText(' 108    0011.2233.4455    DYNAMIC     Gi1/0/5\n 00-25-90-aa-bb-01  e23');
  assert.deepEqual(found.map((m) => m.hex), ['001122334455', '002590aabb01']);
});
