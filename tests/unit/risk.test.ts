import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand, maskSecrets } from '../../src/shared/risk';

const L = (c: string) => classifyCommand(c, 'linux').level;
const S = (c: string) => classifyCommand(c, 'switch').level;

test('Linux: просмотр не считается изменением', () => {
  for (const c of ['ls -la /etc', 'cat /etc/passwd', 'head -n 20 /etc/passwd', 'last -x reboot', 'journalctl -u ssh | grep reboot', 'systemctl status nginx', 'fdisk -l', 'apt list --upgradable', 'ip -br addr', 'mysql -e "SELECT 1 WHERE a <> b"']) {
    assert.equal(L(c), 'info', c);
  }
});

test('Linux: опасные и критичные команды', () => {
  assert.equal(L('rm -rf /'), 'critical');
  assert.equal(L('sudo mkfs.ext4 /dev/sdb1'), 'critical');
  assert.equal(L('dd if=/dev/zero of=/dev/sda'), 'critical');
  assert.equal(L('psql -c "DROP DATABASE prod"'), 'critical');
  assert.equal(L('sudo systemctl stop nginx'), 'danger');
  assert.equal(L('sudo reboot'), 'danger');
  assert.equal(L('chmod -R 777 /srv'), 'danger');
  assert.equal(L('sudo userdel ivan'), 'danger');
  assert.equal(L('sudo apt purge nginx'), 'danger');
  assert.equal(L('sudo ufw allow 22/tcp'), 'danger');
  assert.equal(L('sudo sed -i "s/a/b/" /etc/ssh/sshd_config'), 'danger');
  assert.equal(L('ssh admin@h "sudo reboot"'), 'danger');
  assert.equal(L('ls; rm -rf /tmp/x'), 'danger');
});

test('Linux: изменяющие команды', () => {
  assert.equal(L('sudo apt install htop'), 'change');
  assert.equal(L('mkdir -p /srv/x'), 'change');
  assert.equal(L('echo 1 > out.txt'), 'change');
  assert.equal(L('sudo systemctl start nginx'), 'change');
});

test('Коммутаторы', () => {
  assert.equal(S('show running-config'), 'info');
  assert.equal(S('SW-CORE-1# show version'), 'info');
  assert.equal(S('reload in 5'), 'danger');
  assert.equal(S('reload cancel'), 'change');
  assert.equal(S('(config)#no vlan 202'), 'danger');
  assert.equal(S('switchport trunk allowed vlan 10,20'), 'danger');
  assert.equal(S('switchport trunk allowed vlan add 10'), 'change');
  assert.equal(S('default interface range fastEthernet 0/1-24'), 'danger');
  assert.equal(S('copy tftp://1.1.1.1/fw.ros image'), 'critical');
  assert.equal(S('interface b11 disable'), 'danger');
  assert.equal(S('end'), 'info');
});

test('Маскирование секретов', () => {
  assert.equal(maskSecrets('username admin password Secr3t privilege 15'), 'username admin password ******** privilege 15');
  assert.equal(maskSecrets('enable secret 5 $1$abc'), 'enable secret 5 ********');
  assert.equal(maskSecrets('mysql -uroot -pTopSecret db'), 'mysql -uroot -p******** db');
  assert.equal(maskSecrets('ssh -p 2222 host'), 'ssh -p 2222 host');
  assert.equal(maskSecrets('curl https://u:pw@host/x'), 'curl https://u:********@host/x');
});

test('маскировка паролей SQL, в том числе в кавычках с пробелами', () => {
  assert.equal(maskSecrets("CREATE ROLE app_user LOGIN PASSWORD 'my secret pass';"), 'CREATE ROLE app_user LOGIN PASSWORD ********;');
  assert.equal(maskSecrets("CREATE USER 'u'@'localhost' IDENTIFIED BY 'a b c';"), "CREATE USER 'u'@'localhost' IDENTIFIED BY '********';");
  assert.equal(maskSecrets('PGPASSWORD=Secr3t psql -h db -U app'), 'PGPASSWORD=******** psql -h db -U app');
  assert.equal(maskSecrets('mysql -u root -pSecr3t shop'), 'mysql -u root -p******** shop');
});

test('UserGate NGFW: правила с учётом платформы', () => {
  const U = (c: string) => classifyCommand(c, 'switch', 'usergate').level;
  // просмотр и диагностика — в обоих режимах, с приглашением и без
  assert.equal(U('show network route ip 8.8.8.8'), 'info');
  assert.equal(U('Admin@ngfw1> show traffic connections dest-ip 10.0.0.5'), 'info');
  assert.equal(U('[ network interface ] Admin@ngfw1# show'), 'info');
  assert.equal(U('ping hostname 8.8.8.8 count 4'), 'info');
  assert.equal(U('execute ping hostname 8.8.8.8 count 4'), 'info');
  assert.equal(U('netcheck address https://example.com'), 'info');
  assert.equal(U('configure'), 'info');
  assert.equal(U('edit network interface'), 'info');
  // изменения
  assert.equal(U('clear blocked-ip ips [ 10.0.0.5 ]'), 'change');
  assert.equal(U('clear network bgp ip 192.0.2.1 soft in'), 'change');
  assert.equal(U('set network dns system-dns-servers ip [ 10.0.0.2 ]'), 'change');
  assert.equal(U('delete network trace-rules "NAD trace"'), 'change');
  // опасные: управление, маршрутизация, правила
  assert.equal(U('set network zone Trusted enabled-services [ "Any ICMP" ]'), 'danger');
  assert.equal(U('set network interface adapter port1 enabled off'), 'danger');
  assert.equal(U('clear network bgp ip 192.0.2.1'), 'danger');
  assert.equal(U('delete network-policy firewall 5'), 'danger');
  assert.equal(U('execute firewall force-changes'), 'danger');
  assert.equal(U('reboot'), 'danger');
  // критичные
  assert.equal(U('shutdown'), 'critical');
  assert.equal(U('delete network-policy firewall all'), 'critical');
  // многострочное правило UPL оценивается целиком
  assert.equal(U('create network-policy firewall 1 upl-rule PASS \\\n...src.zone = Trusted \\\n...service = HTTPS \\\n...enabled(true)'), 'danger');
  // для других платформ поведение прежнее: «shutdown» — отключение интерфейса
  assert.equal(S('shutdown'), 'danger');
});
