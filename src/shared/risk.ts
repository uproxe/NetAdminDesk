// Классификация риска команд. Это эвристика, а не гарантия: пользователь всегда видит итоговую команду.
import type { RiskLevel } from './types';

export const RISK_ORDER: RiskLevel[] = ['info', 'change', 'danger', 'critical'];

export const RISK_LABELS: Record<RiskLevel, string> = {
  info: 'Просмотр',
  change: 'Изменение',
  danger: 'Опасно',
  critical: 'Критично'
};

export const RISK_HINTS: Record<RiskLevel, string> = {
  info: 'Команда только показывает информацию.',
  change: 'Команда изменяет состояние или конфигурацию.',
  danger: 'Команда может прервать работу сервиса, порта или удалить данные.',
  critical: 'Команда может уничтожить данные или вывести устройство из строя.'
};

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export function riskAtLeast(level: RiskLevel, min: RiskLevel): boolean {
  return RISK_ORDER.indexOf(level) >= RISK_ORDER.indexOf(min);
}

export interface RiskResult {
  level: RiskLevel;
  reasons: string[];
}

type RiskRule = [RegExp, RiskLevel, string];

// ---------- Коммутаторы ----------
const SWITCH_RULES: RiskRule[] = [
  [/^(show|sh|display|dir|ping|traceroute|terminal|more|who|history|no page|page)\b/, 'info', 'просмотр'],
  [/^(end|exit|quit|logout)$/, 'info', 'выход из режима'],
  [/^(write erase|erase (startup-config|nvram:|flash:)|delete (\/force )?flash:|format\b)/, 'critical', 'стирание конфигурации или файловой системы'],
  [/^copy\s+tftp\S*\s+.*\b(image|flash:\S*\.bin)\b|^copy\s+\S+\s+image\b|^boot system\b|\bimage\s*$/, 'critical', 'обновление/замена прошивки'],
  [/^reload\s+cancel\b/, 'change', 'отмена запланированной перезагрузки'],
  [/^(reload|reboot|restart reboot|restart switch|boot)\b/, 'danger', 'перезагрузка устройства'],
  [/^default interface\b/, 'danger', 'сброс конфигурации порта'],
  [/^no vlan\b|^delete vlan|^destroy vlan|^no\s+vlan\s+\d+\s+(tagged|untagged)/, 'danger', 'удаление VLAN или VLAN с порта'],
  [/^vtp mode\b/, 'danger', 'изменение режима VTP'],
  [/^no shutdown$/, 'change', 'включение интерфейса'],
  [/^test cable/, 'change', 'тест кабеля (возможен кратковременный обрыв линка)'],
  [/^(shutdown|disable)$|^interface\s+\S+\s+disable\b|^disable\s+(switch\s+)?port/, 'danger', 'отключение интерфейса'],
  [/^no ip address\b|^ip address\b|^ip address dhcp\b/, 'danger', 'изменение IP-адреса интерфейса (возможна потеря управления)'],
  [/management\s+vlan|^ip default-gateway\b|management access-list/, 'danger', 'изменение параметров управления'],
  [/^(no\s+)?ip access-group\b/, 'danger', 'привязка/отвязка ACL на интерфейсе'],
  [/^no ip access-list\b|^no access-list\b/, 'danger', 'удаление ACL'],
  [/^no \d+\s*$|^no \(/, 'danger', 'удаление строки ACL'],
  [/^\d+\s+(permit|deny)\b|^(permit|deny)\b|^ip access-list\b|^access-list\b/, 'change', 'изменение ACL'],
  [/^(no\s+)?object-group\b|^(no\s+)?host\s+\d/, 'change', 'изменение object-group'],
  [/switchport trunk allowed vlan remove|switchport trunk allowed vlan none/, 'danger', 'удаление VLAN с trunk-порта'],
  [/switchport trunk allowed vlan(?!\s+(add|except|remove))\s+\S/, 'danger', 'замена списка VLAN на trunk (не add) — существующие VLAN будут удалены'],
  [/^no switchport\b|^switchport mode\b/, 'danger', 'изменение режима порта'],
  [/^(no\s+)?ip route\b|^router\s+\w+|^(no\s+)?network\s+\d/, 'danger', 'изменение маршрутизации'],
  [/^(no\s+)?spanning-tree\b/, 'danger', 'изменение STP'],
  [/^(no\s+)?username\b|^passwords?\b|^enable (secret|password)\b|^security-manage\b|^(no\s+)?ip ssh\b|^crypto\b/, 'change', 'изменение учётных записей/безопасности'],
  [/^delete\b/, 'danger', 'удаление'],
  [/^clear\b/, 'change', 'очистка счётчиков/таблиц'],
  [/^(conf t|conf|configure( terminal)?)\b/, 'change', 'вход в режим конфигурации'],
  [/^(write( memory)?|wr|whrite memory|copy running-config startup-config|create config=)/, 'change', 'сохранение конфигурации'],
  [/^copy\b|^upload\b|^download\b/, 'change', 'копирование файлов/конфигурации'],
  [/^(no\s+)?(sntp|ntp|clock|logging|snmp-server|hostname|banner|lldp|cdp|macro|vlan|interface|int|name|description|power inline|switchport|channel-group|speed|duplex|mtu|ip|set|create|add|enable|vtp|end|exit)\b/, 'change', 'изменение конфигурации'],
  [/^vlan\s+\d+\s+(tagged|untagged|name)\b/, 'change', 'изменение VLAN'],
  [/^no\s/, 'change', 'удаление/отмена настройки']
];

// ---------- Linux ----------
// Команда разбивается на сегменты (конвейер, ;, &&, ||, подстановки) с учётом кавычек,
// у каждого сегмента определяется исполняемая команда и её аргументы.

interface Segment {
  /** Текст сегмента как есть. */
  text: string;
  /** Текст без содержимого кавычек (для поиска перенаправлений). */
  bare: string;
}

function splitSegments(line: string): Segment[] {
  const segs: Segment[] = [];
  let text = '';
  let bare = '';
  let q: '"' | "'" | null = null;
  const push = () => {
    if (text.trim()) segs.push({ text: text.trim(), bare: bare.trim() });
    text = '';
    bare = '';
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      text += ch;
      if (ch === q) {
        q = null;
        bare += ch;
      } else if (ch === '\\' && q === '"' && i + 1 < line.length) {
        text += line[++i];
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      text += ch;
      bare += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < line.length) {
      text += ch + line[i + 1];
      bare += ch + line[i + 1];
      i++;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      push();
      i++;
      continue;
    }
    if (ch === '&' && (line[i + 1] === '>' || line[i - 1] === '>')) {
      text += ch;
      bare += ch;
      continue;
    }
    if (ch === '|' || ch === ';' || ch === '&' || ch === '\n' || ch === '`' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      // $( … ) и ( … ) — отдельные сегменты
      if (ch === '(' && text.endsWith('$')) {
        text = text.slice(0, -1);
        bare = bare.slice(0, -1);
      }
      push();
      continue;
    }
    text += ch;
    bare += ch;
  }
  push();
  return segs;
}

const PREFIX_WORDS = new Set(['sudo', 'doas', 'env', 'nohup', 'time', 'exec', 'command', 'builtin', 'then', 'do', 'else', 'elif', '!', 'nice', 'ionice', 'timeout', 'xargs', 'watch', 'stdbuf', 'chrt', 'taskset']);
const PREFIX_ARG_OPTS: Record<string, string[]> = {
  sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U'],
  nice: ['-n'],
  ionice: ['-c', '-n', '-p'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  xargs: ['-n', '-P', '-I', '-L', '-d', '-s', '-E', '-a'],
  watch: ['-n', '--interval', '-d'],
  chrt: [],
  taskset: []
};

function words(s: string): string[] {
  return s.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

/** Возвращает [команда, аргументы] сегмента без префиксов (sudo, nohup, env…). */
function parseSegment(seg: Segment): { cmd: string; args: string[]; argText: string } {
  const w = words(seg.text);
  let i = 0;
  while (i < w.length) {
    const t = w[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i++;
      continue;
    }
    if (PREFIX_WORDS.has(t)) {
      const argOpts = PREFIX_ARG_OPTS[t] ?? [];
      i++;
      while (i < w.length && w[i].startsWith('-')) {
        if (argOpts.includes(w[i])) i++;
        i++;
      }
      if (t === 'timeout' && i < w.length && /^\d/.test(w[i])) i++;
      if ((t === 'nice' || t === 'ionice') && i < w.length && /^-?\d+$/.test(w[i])) i++;
      continue;
    }
    break;
  }
  const cmd = (w[i] ?? '').replace(/^.*\//, '').replace(/^["']|["']$/g, '');
  const args = w.slice(i + 1);
  return { cmd, args, argText: args.join(' ') };
}

type Hit = { level: RiskLevel; reason: string };

function hasFlag(args: string[], short: string, long?: string): boolean {
  return args.some((a) => (a.startsWith('-') && !a.startsWith('--') && a.slice(1).includes(short)) || (long ? a === long || a.startsWith(`${long}=`) : false));
}

const EDITORS = new Set(['nano', 'vi', 'vim', 'nvim', 'mcedit', 'emacs', 'ed', 'joe', 'micro']);

function classifySegment(seg: Segment): Hit[] {
  const { cmd, args, argText } = parseSegment(seg);
  const hits: Hit[] = [];
  const h = (level: RiskLevel, reason: string) => hits.push({ level, reason });
  const sub = args.find((a) => !a.startsWith('-')) ?? '';
  const touchesSsh = /sshd_config|\/etc\/ssh\//.test(argText);

  switch (cmd) {
    case 'rm': {
      const rec = hasFlag(args, 'r') || hasFlag(args, 'R') || args.includes('--recursive');
      if (rec && args.some((a) => /^["']?\/\*?["']?$/.test(a) || a === '--no-preserve-root')) h('critical', 'рекурсивное удаление корня файловой системы');
      else if (rec) h('danger', 'рекурсивное удаление');
      else h('danger', 'удаление файлов');
      break;
    }
    case 'shred':
    case 'wipefs':
      h('critical', 'безвозвратное уничтожение данных');
      break;
    case 'dd':
      if (/\bof=\/dev\//.test(argText)) h('critical', 'запись напрямую на устройство');
      else h('change', 'побайтовое копирование');
      break;
    case 'fdisk':
    case 'gdisk':
    case 'sgdisk':
    case 'parted':
    case 'sfdisk':
    case 'cfdisk':
      if (/(^|\s)(-l|--list|print|-p)(\s|$)/.test(argText) || (cmd === 'sgdisk' && /(^|\s)-p(\s|$)/.test(argText))) h('info', 'просмотр таблицы разделов');
      else h('critical', 'изменение таблицы разделов');
      break;
    case 'lvremove':
    case 'vgremove':
    case 'pvremove':
      h('critical', 'удаление томов LVM');
      break;
    case 'lvreduce':
      h('danger', 'уменьшение тома LVM (возможна потеря данных)');
      break;
    case 'lvextend':
    case 'lvcreate':
    case 'lvresize':
    case 'vgextend':
    case 'pvcreate':
    case 'vgcreate':
    case 'resize2fs':
    case 'xfs_growfs':
    case 'growpart':
      h('change', 'изменение томов/разделов');
      break;
    case 'mdadm':
      if (/--(stop|remove|fail|zero-superblock)\b|(^|\s)-[SrfR]\b/.test(argText)) h('critical', 'остановка/разрушение RAID');
      else if (/--(add|create|grow|assemble)\b/.test(argText)) h('change', 'изменение RAID');
      break;
    case 'reboot':
    case 'shutdown':
    case 'poweroff':
    case 'halt':
      h('danger', 'перезагрузка/выключение сервера');
      break;
    case 'init':
    case 'telinit':
      if (/^[06]$/.test(sub)) h('danger', 'перезагрузка/выключение сервера');
      break;
    case 'systemctl': {
      const s2 = sub;
      if (/^(reboot|poweroff|halt|kexec|emergency|rescue|suspend|hibernate)$/.test(s2)) h('danger', 'перезагрузка/выключение сервера');
      else if (/^(stop|disable|mask|kill|isolate)$/.test(s2)) h('danger', 'остановка/отключение службы');
      else if (/^(restart|try-restart|reload-or-restart|condrestart|force-reload)$/.test(s2)) h('danger', 'перезапуск службы (кратковременный простой)');
      else if (/^(start|enable|reload|daemon-reload|daemon-reexec|unmask|set-default|edit|preset|reset-failed|revert|set-property|link)$/.test(s2)) h('change', 'изменение состояния службы');
      break;
    }
    case 'service':
      if (/\b(stop|restart|force-reload)\b/.test(argText)) h('danger', 'остановка/перезапуск службы');
      else if (/\b(start|reload)\b/.test(argText)) h('change', 'изменение состояния службы');
      break;
    case 'kill':
    case 'pkill':
    case 'killall':
      h('danger', 'завершение процессов');
      break;
    case 'userdel':
    case 'deluser':
    case 'groupdel':
    case 'delgroup':
      h('danger', 'удаление пользователя/группы');
      break;
    case 'apt':
    case 'apt-get':
    case 'aptitude':
      if (/^(purge|remove|autoremove|full-upgrade|dist-upgrade)$/.test(sub)) h('danger', 'удаление/массовая замена пакетов');
      else if (/^(install|upgrade|update|reinstall|clean|autoclean)$/.test(sub) || hasFlag(args, 'f')) {
        if (!(sub === 'upgrade' && (hasFlag(args, 's') || args.includes('--simulate') || args.includes('--dry-run')))) h('change', 'установка/обновление пакетов');
      }
      break;
    case 'dpkg':
      if (/(^|\s)(-r|-P|--remove|--purge)\b/.test(argText)) h('danger', 'удаление пакетов');
      else if (/(^|\s)(-i|--install|--configure|--unpack)\b/.test(argText)) h('change', 'установка пакетов');
      break;
    case 'apt-mark':
    case 'dpkg-reconfigure':
    case 'unattended-upgrade':
    case 'unattended-upgrades':
      if (!/--dry-run|showhold|showmanual|showauto/.test(argText)) h('change', 'изменение настроек пакетов');
      break;
    case 'iptables':
    case 'ip6tables':
    case 'iptables-nft':
    case 'ebtables':
    case 'arptables':
      if (/(^|\s)-(F|X|D|P|Z|R|A|I|N|E)\b|--(flush|delete|policy|append|insert|replace)\b/.test(argText)) h('danger', 'изменение правил firewall');
      break;
    case 'iptables-restore':
    case 'ip6tables-restore':
    case 'netfilter-persistent':
      if (cmd !== 'netfilter-persistent' || /\b(reload|start|flush|restart)\b/.test(argText)) h('danger', 'загрузка правил firewall');
      break;
    case 'nft':
      if (/(^|\s)-c\b/.test(argText)) h('info', 'проверка файла правил');
      else if (/\b(flush|delete|add|insert|create|replace|destroy|reset)\b|(^|\s)-f\b/.test(argText)) h('danger', 'изменение правил firewall');
      break;
    case 'ufw':
      if (/^(allow|deny|reject|limit|delete|enable|disable|reset|default|insert|route|prepend)$/.test(sub)) h('danger', 'изменение правил firewall');
      break;
    case 'firewall-cmd':
      if (/--(add|remove|set|reload|panic|complete-reload)/.test(argText)) h('danger', 'изменение правил firewall');
      break;
    case 'ip': {
      const t = argText;
      if (/\blink\s+set\s+\S+.*\bdown\b|\b(addr|address|a)\s+(del|delete|flush)\b|\b(route|r)\s+(del|delete|flush|replace|change)\b|\brule\s+del/.test(t)) h('danger', 'изменение сетевых настроек (возможна потеря доступа)');
      else if (/\b(addr|address|a|route|r|link|rule|neigh|neighbour|n)\s+(add|set|change|replace|flush|append)\b/.test(t)) h('change', 'изменение сетевых настроек');
      break;
    }
    case 'ifdown':
      h('danger', 'отключение сетевого интерфейса');
      break;
    case 'ifup':
    case 'dhclient':
      if (cmd === 'dhclient' && hasFlag(args, 'r')) h('danger', 'освобождение адреса DHCP (возможна потеря доступа)');
      else h('change', 'изменение сетевых настроек');
      break;
    case 'nmcli':
      if (/\b(down|delete|modify|disconnect|off)\b/.test(argText)) h('danger', 'изменение сетевых настроек (возможна потеря доступа)');
      else if (/\b(up|add|reload|connect|on)\b/.test(argText)) h('change', 'изменение сетевых настроек');
      break;
    case 'netplan':
      if (sub === 'apply') h('danger', 'применение сетевой конфигурации без отката');
      else if (/^(try|generate|set)$/.test(sub)) h('change', 'изменение сетевой конфигурации');
      break;
    case 'networkctl':
      if (/\b(down|delete|reload|reconfigure|renew|up|forcerenew)\b/.test(argText)) h('change', 'изменение сетевых настроек');
      break;
    case 'umount':
    case 'swapoff':
      h('danger', 'отключение файловой системы/swap');
      break;
    case 'mount':
      if (args.some((a) => /^(\/dev\/|UUID=|LABEL=|\/\/|[\w.-]+:\/)/.test(a)) || hasFlag(args, 'a') || /remount/.test(argText)) h('change', 'монтирование');
      break;
    case 'swapon':
      if (args.some((a) => a.startsWith('/')) || hasFlag(args, 'a')) h('change', 'включение swap');
      break;
    case 'mkswap':
    case 'fallocate':
    case 'truncate':
      h('change', 'создание/изменение файла');
      break;
    case 'chmod':
    case 'chown':
    case 'chgrp':
      if (hasFlag(args, 'R') || args.includes('--recursive')) h('danger', 'рекурсивное изменение прав/владельца');
      else h('change', 'изменение прав/владельца');
      break;
    case 'setfacl':
    case 'chattr':
      h('change', 'изменение атрибутов/ACL');
      break;
    case 'cp':
    case 'mv':
    case 'mkdir':
    case 'touch':
    case 'ln':
    case 'rsync':
    case 'install':
    case 'rename':
    case 'rmdir':
    case 'scp':
    case 'unzip':
    case 'zip':
    case 'iconv':
      if (cmd === 'rsync' && /--delete/.test(argText) && !hasFlag(args, 'n') && !args.includes('--dry-run')) h('danger', 'синхронизация с удалением файлов в назначении');
      else if (cmd === 'rsync' && (hasFlag(args, 'n') || args.includes('--dry-run'))) h('info', 'пробный прогон');
      else if (cmd !== 'iconv') h('change', 'изменение файлов');
      break;
    case 'tar':
      if (/(^|\s)-?[a-zA-Z]*[xc][a-zA-Z]*(\s|$)|--(extract|create|get)\b/.test(argText) && !/(^|\s)-?[a-zA-Z]*t[a-zA-Z]*(\s|$)/.test(argText.split(' ')[0] ?? '')) h('change', 'создание/распаковка архива');
      break;
    case 'gzip':
    case 'gunzip':
    case 'xz':
    case 'unxz':
    case 'bzip2':
    case 'zstd':
      if (!/(^|\s)-[a-zA-Z]*[tlc]/.test(argText)) h('change', 'сжатие/распаковка файлов');
      break;
    case 'sed':
      if (/(^|\s)(-i\S*|--in-place\S*)(\s|$)/.test(argText)) h(touchesSsh ? 'danger' : 'change', touchesSsh ? 'изменение конфигурации SSH (возможна потеря доступа)' : 'изменение файла на месте');
      break;
    case 'tee':
      h(touchesSsh || /\/(etc|boot)\//.test(argText) ? 'danger' : 'change', 'запись в файл');
      break;
    case 'crontab':
      if (hasFlag(args, 'r')) h('danger', 'удаление crontab');
      else if (hasFlag(args, 'e') || args.some((a) => !a.startsWith('-'))) h('change', 'изменение заданий cron');
      break;
    case 'at':
    case 'batch':
    case 'systemd-run':
      if (!/^(-l|-c)$/.test(args[0] ?? '')) h('change', 'запланированное выполнение');
      break;
    case 'atrm':
      h('change', 'удаление задания at');
      break;
    case 'hostnamectl':
    case 'timedatectl':
    case 'localectl':
      if (/^set-/.test(sub)) h('change', 'изменение настроек системы');
      break;
    case 'sysctl':
      if (hasFlag(args, 'w') || hasFlag(args, 'p') || /--system|--load/.test(argText) || args.some((a) => /=/.test(a))) h('change', 'изменение параметров ядра');
      break;
    case 'modprobe':
    case 'rmmod':
    case 'insmod':
      h('change', 'загрузка/выгрузка модулей ядра');
      break;
    case 'passwd':
      if (!/(^|\s)-S\b/.test(argText)) h('change', 'изменение пароля/учётной записи');
      break;
    case 'usermod':
    case 'chpasswd':
    case 'gpasswd':
    case 'useradd':
    case 'adduser':
    case 'groupadd':
    case 'addgroup':
    case 'groupmod':
      h('change', 'изменение учётных записей');
      break;
    case 'chage':
      if (!hasFlag(args, 'l')) h('change', 'изменение срока действия пароля');
      break;
    case 'visudo':
      if (!hasFlag(args, 'c')) h('change', 'изменение правил sudo');
      break;
    case 'docker':
    case 'podman': {
      const t = argText;
      if (/^(rm|rmi|kill|stop)\b|\b(system|image|container|volume|network|builder)\s+(prune|rm)\b|\bcompose\s+(down|rm|kill|stop)\b/.test(t)) h('danger', 'удаление/остановка контейнеров или данных');
      else if (/^(run|start|restart|pull|build|exec|create|update|cp|commit|tag|push|load|import)\b|\bcompose\s+(up|pull|restart|start|build|exec|run)\b|\bimage\s+prune\b/.test(t)) h('change', 'запуск/изменение контейнеров');
      break;
    }
    case 'certbot':
      if (/^(renew|certonly|delete|revoke|run|install)$/.test(sub) && !/--dry-run/.test(argText)) h('change', 'выпуск/изменение сертификатов');
      break;
    case 'rndc':
    case 'exportfs':
    case 'logrotate':
    case 'chronyc':
    case 'fail2ban-client':
    case 'a2ensite':
    case 'a2dissite':
    case 'a2enmod':
    case 'a2dismod':
    case 'updatedb':
    case 'ssh-copy-id':
    case 'ssh-add':
    case 'journalctl':
    case 'resolvectl':
    case 'smartctl':
      if (cmd === 'journalctl' && !/--(vacuum|rotate|flush)/.test(argText)) break;
      if (cmd === 'resolvectl' && !/(flush-caches|dns|domain|revert|reset)/.test(sub)) break;
      if (cmd === 'smartctl' && !hasFlag(args, 't')) break;
      if (cmd === 'logrotate' && hasFlag(args, 'd')) break;
      if (cmd === 'chronyc' && !/^(makestep|burst|settime|add|delete)/.test(sub)) break;
      if (cmd === 'fail2ban-client' && !/\b(set|reload|start|stop|unban)\b/.test(argText)) break;
      if (cmd === 'exportfs' && !hasFlag(args, 'r') && !hasFlag(args, 'a') && !hasFlag(args, 'u')) break;
      if (cmd === 'ssh-add' && hasFlag(args, 'l')) break;
      h('change', 'изменение состояния службы/настроек');
      break;
    case 'mkfs':
    case 'mke2fs':
      h('critical', 'создание файловой системы (данные будут уничтожены)');
      break;
    default:
      if (/^mkfs\./.test(cmd)) h('critical', 'создание файловой системы (данные будут уничтожены)');
      else if (EDITORS.has(cmd)) h(touchesSsh ? 'danger' : 'change', touchesSsh ? 'изменение конфигурации SSH (возможна потеря доступа)' : 'редактирование файла');
      else if (cmd === 'find' && /\s-delete\b|-exec\s+rm\b|-execdir\s+rm\b/.test(` ${argText}`)) h('danger', 'удаление найденных файлов');
      else if ((cmd === 'bash' || cmd === 'sh' || cmd === 'su' || cmd === 'ssh') && /(^|\s)-c\s|ssh/.test(`${cmd} ${argText}`)) {
        // вложенная команда в кавычках
        const inner = /(["'])(.+)\1\s*$/.exec(argText)?.[2];
        if (inner) for (const sub2 of splitSegments(inner)) hits.push(...classifySegment(sub2));
      }
  }

  // Перенаправление вывода (вне кавычек)
  const redir = /(^|[^0-9&>])>{1,2}\s*([^\s&|;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = redir.exec(seg.bare))) {
    const target = m[2];
    if (/^\/dev\/(null|stdout|stderr|tty)$/.test(target)) continue;
    if (/^\/dev\/(sd|nvme|vd|hd|xvd|mmcblk)/.test(target)) h('critical', 'запись напрямую на диск');
    else if (/^\/(etc|boot|usr|var\/lib)\//.test(target)) h('danger', 'перезапись системного файла');
    else h('change', 'запись вывода в файл');
  }
  return hits;
}

/** Утилиты СУБД в командной строке: загрузка дампов и скриптов, создание и удаление баз. */
const DB_SHELL_RULES: [RegExp, RiskLevel, string][] = [
  [/\b(dropdb|dropuser)\b/, 'critical', 'удаление базы или пользователя'],
  [/\|\s*(sudo\s+(-u\s+\S+\s+)?)?(mysql|mariadb|psql)\b|\b(mysql|mariadb|psql)\b[^|<>]*\s<(?![>=])\s*\S|\bpg_restore\b[^|]*\s-d\b|\bpsql\b[^|]*\s-f\s/, 'danger', 'загрузка дампа или скрипта в базу (может перезаписать данные)'],
  [/\bpg_ctlcluster\b.*\b(restart|stop)\b/, 'danger', 'перезапуск или остановка кластера PostgreSQL'],
  [/\bmysqlcheck\b.*(--auto-repair|--repair|\s-r\b)/, 'danger', 'автоматическое исправление таблиц'],
  [/\b(createdb|createuser|mysql_secure_installation|mariadb-secure-installation|mariadb-upgrade|mysql_upgrade|vacuumdb|reindexdb)\b/, 'change', 'изменение базы или её настроек']
];

function classifyLinuxLine(line: string): RiskResult {
  let level: RiskLevel = 'info';
  const reasons: string[] = [];
  const add = (lv: RiskLevel, reason: string) => {
    if (RISK_ORDER.indexOf(lv) > RISK_ORDER.indexOf(level)) {
      level = lv;
      reasons.length = 0;
      reasons.push(reason);
    } else if (lv === level && lv !== 'info' && !reasons.includes(reason)) reasons.push(reason);
  };
  if (/:\(\)\s*\{\s*:\|:&\s*\};:/.test(line)) add('critical', 'fork-бомба');
  const unquoted = line.replace(/"[^"]*"|'[^']*'/g, '""');
  for (const [re, lv, reason] of DB_SHELL_RULES) if (re.test(unquoted)) add(lv, reason);
  if (/\b(DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE\s+(TABLE\s+)?\w)/i.test(line)) add('critical', 'удаление данных в СУБД');
  else if (/\b(DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+TABLE|INSERT\s+INTO|GRANT|REVOKE|CREATE\s+(DATABASE|TABLE|USER))\b/i.test(line)) add('change', 'изменение данных в СУБД');
  for (const seg of splitSegments(line)) {
    for (const hit of classifySegment(seg)) add(hit.level, hit.reason);
  }
  return { level, reasons };
}

function stripPrompt(line: string): string {
  return line
    .replace(/^\s*(SecOff|Manager|Operator|User)\s+[^>]*>\s*/i, '')
    .replace(/^\s*[A-Za-z0-9_.\-]*\([\w\-]+\)#?\s*/, '')
    .replace(/^\s*[A-Za-z0-9_.\-]+[#>]\s+/, '')
    .replace(/^\s*#\s*/, '')
    .trim();
}

/** Похоже на команду оболочки (клиенты СУБД, утилиты), а не на SQL-запрос. */
const SHELL_START = /^(sudo|mysql|mariadb|mysqladmin|mysqldump|mariadb-dump|mysqlcheck|mysql_secure_installation|mariadb-secure-installation|psql|pg_\w+|createdb|dropdb|createuser|dropuser|vacuumdb|reindexdb|systemctl|journalctl|service|tail|cat|less|grep|ls|du|df|cd|gzip|gunzip|zcat|cp|mv|chown|chmod|find|ss|netstat|nano|vim?|apt|export|PGPASSWORD=|runuser|su)\b/i;

const SQL_RULES: [RegExp, RiskLevel, string][] = [
  [/^drop\s+(database|schema)\b/i, 'critical', 'удаление базы данных целиком'],
  [/^drop\s+(table|user|role|owned)\b/i, 'critical', 'удаление таблицы или пользователя'],
  [/^truncate\b/i, 'critical', 'очистка таблицы без возможности отмены'],
  [/^delete\s+from\s+[\w."`]+\s*;?\s*$/i, 'critical', 'DELETE без WHERE удалит все строки'],
  [/^update\s+[\w."`]+\s+set\b(?![\s\S]*\bwhere\b)/i, 'critical', 'UPDATE без WHERE изменит все строки'],
  [/^(reset\s+(master|binary\s+logs)|purge\s+(binary|master)\s+logs)\b/i, 'critical', 'удаление двоичных журналов (репликация, восстановление)'],
  [/^delete\b/i, 'danger', 'удаление строк'],
  [/^update\b/i, 'danger', 'изменение строк'],
  [/^drop\b/i, 'danger', 'удаление объекта базы'],
  [/^alter\s+table\b[\s\S]*\bdrop\b/i, 'danger', 'удаление столбца или ограничения'],
  [/^(revoke)\b/i, 'danger', 'отзыв прав'],
  [/^(kill|select\s+pg_(terminate|cancel)_backend)\b/i, 'danger', 'принудительное завершение запроса или соединения'],
  [/^(stop|start)\s+(slave|replica)\b|^change\s+(master|replication\s+source)\b/i, 'danger', 'управление репликацией'],
  [/^flush\s+tables\s+with\s+read\s+lock\b/i, 'danger', 'блокирует запись во все таблицы'],
  [/^vacuum\s+(\(.*\bfull\b.*\)|full)\b/i, 'danger', 'VACUUM FULL блокирует таблицу на время работы'],
  [/^(repair|optimize)\s+table\b/i, 'danger', 'перестраивает таблицу, может её блокировать'],
  [/^set\s+(global|persist)\b|^alter\s+system\b/i, 'danger', 'изменение настроек сервера'],
  [/^select\b[\s\S]*\binto\s+(outfile|dumpfile)\b/i, 'change', 'запись результата в файл на сервере'],
  [/^select\s+(pg_reload_conf|set_config|pg_rotate_logfile|pg_switch_wal)\s*\(/i, 'change', 'изменение работы сервера'],
  [/^(select|show|describe|desc|explain(?!\s+analyze)|with|table|values|help|status|check(sum)?\s+table)\b/i, 'info', 'просмотр'],
  [/^(use|set\s+(session\s+)?(search_path|names|role)|begin|start\s+transaction|commit|rollback|savepoint|release)\b/i, 'info', 'переключение базы или управление транзакцией'],
  [/^(create|insert|grant|alter|rename|comment|analyze|vacuum|reindex|cluster|refresh|flush|set|copy|load\s+data|lock|unlock|call|do|prepare|execute|deallocate|checkpoint|install|uninstall|import)\b/i, 'change', 'изменение данных или структуры'],
  [/^explain\s+analyze\b/i, 'change', 'EXPLAIN ANALYZE действительно выполняет запрос']
];

/** Классификация одного SQL-оператора или служебной команды psql. */
function classifySqlStatement(st: string): RiskResult {
  const s = st.trim().replace(/\\G\s*$/, '').replace(/^(mysql>|mariadb\b[^>]*>|[\w-]+=?[#>])\s*/i, '');
  if (!s) return { level: 'info', reasons: [] };
  if (s.startsWith('\\')) {
    if (/^\\(i|ir|include)\b/.test(s)) return { level: 'change', reasons: ['выполнение SQL-скрипта из файла'] };
    if (/^\\password\b/.test(s)) return { level: 'change', reasons: ['смена пароля пользователя'] };
    if (/^\\copy\b[\s\S]*\bfrom\b/i.test(s)) return { level: 'change', reasons: ['загрузка данных в таблицу'] };
    if (/^\\!/.test(s)) return classifyLinuxLine(s.slice(2).trim());
    return { level: 'info', reasons: ['служебная команда psql'] };
  }
  // EXPLAIN ANALYZE выполняет вложенный запрос — оцениваем его
  const ea = /^explain\s+analyze\s+([\s\S]+)$/i.exec(s);
  if (ea) {
    const inner = classifySqlStatement(ea[1]);
    return inner.level === 'info' ? { level: 'info', reasons: ['просмотр плана запроса'] } : { level: inner.level, reasons: ['EXPLAIN ANALYZE действительно выполняет запрос', ...inner.reasons] };
  }
  for (const [re, level, reason] of SQL_RULES) if (re.test(s)) return { level, reasons: [reason] };
  return { level: 'change', reasons: ['неизвестный оператор — считается изменяющим'] };
}

/** Строка SQL-справочника: команда оболочки (mysql, psql, pg_dump…) или SQL-операторы через «;». */
function classifySqlLine(line: string): RiskResult {
  const l = line.trim();
  if (!l || l.startsWith('--') || l.startsWith('#')) return { level: 'info', reasons: [] };
  if (SHELL_START.test(l)) return classifyLinuxLine(l);
  let level: RiskLevel = 'info';
  const reasons: string[] = [];
  for (const st of l.split(/;(?=(?:[^'"]*['"][^'"]*['"])*[^'"]*$)/)) {
    const r = classifySqlStatement(st);
    if (RISK_ORDER.indexOf(r.level) > RISK_ORDER.indexOf(level)) {
      level = r.level;
      reasons.length = 0;
    }
    if (r.level === level) for (const x of r.reasons) if (!reasons.includes(x)) reasons.push(x);
  }
  return { level, reasons };
}

export function classifyLine(line: string, kind: 'switch' | 'linux' | 'sql'): RiskResult {
  if (kind === 'sql') return classifySqlLine(line);
  if (kind === 'switch') {
    const l = stripPrompt(line).toLowerCase();
    if (!l) return { level: 'info', reasons: [] };
    for (const [re, level, reason] of SWITCH_RULES) {
      if (re.test(l)) return { level, reasons: [reason] };
    }
    return { level: 'change', reasons: ['неизвестная команда — считается изменяющей'] };
  }
  const l = line.trim();
  if (!l || l.startsWith('#')) return { level: 'info', reasons: [] };
  return classifyLinuxLine(l);
}

/** Классификация многострочной команды: максимальный риск по всем строкам. */
/** SQL: операторы могут занимать несколько строк — оцениваем оператор целиком (до «;» или \\G). */
function classifySqlCommand(command: string): RiskResult {
  const results: RiskResult[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) results.push(classifySqlLine(buf));
    buf = '';
  };
  for (const raw of command.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('--')) continue;
    if (l.startsWith('\\') || SHELL_START.test(l)) {
      flush();
      results.push(classifySqlLine(l));
      continue;
    }
    buf += ` ${l}`;
    if (/;\s*$|\\G\s*$/.test(l)) flush();
  }
  flush();
  let level: RiskLevel = 'info';
  const reasons: string[] = [];
  for (const r of results) {
    if (RISK_ORDER.indexOf(r.level) > RISK_ORDER.indexOf(level)) level = r.level;
    for (const x of r.reasons) if (!reasons.includes(x)) reasons.push(x);
  }
  return { level, reasons: level === 'info' ? reasons.slice(0, 1) : reasons };
}

export function classifyCommand(command: string, kind: 'switch' | 'linux' | 'sql'): RiskResult {
  if (kind === 'sql') return classifySqlCommand(command);
  const lines = command.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let level: RiskLevel = 'info';
  const reasons: string[] = [];
  for (const line of lines) {
    // Конвейеры и последовательности в Linux анализируем целиком (правила учитывают контекст).
    const r = classifyLine(line, kind);
    level = maxRisk(level, r.level);
    for (const reason of r.reasons) if (!reasons.includes(reason)) reasons.push(reason);
  }
  return { level, reasons };
}

/** Является ли команда изменяющей (всё, что выше уровня «Просмотр»). */
export function isChanging(level: RiskLevel): boolean {
  return level !== 'info';
}

/** Маскирует пароли и секреты перед записью в историю/журнал. */
export function maskSecrets(command: string): string {
  return command
    .replace(/\b(password|secret|passwd|key-string|community|psk|pre-shared-key)(\s+\d)?\s+('[^']*'|"[^"]*"|\S+)/gi, (_m, w, n) => `${w}${n ?? ''} ********`)
    .replace(/\b((?:mysql|mariadb|mysqldump|mysqladmin)\b[^|\n]*?\s-p)(\S+)/g, '$1********')
    .replace(/(--password[= ])(\S+)/g, '$1********')
    .replace(/\b(identified\s+(?:with\s+\w+\s+)?by\s+)('[^']*'|"[^"]*"|\S+)/gi, "$1'********'")
    .replace(/\b(PGPASSWORD=)(\S+)/g, '$1********')
    .replace(/(:\/\/[^:\s/]+:)[^@\s]+@/g, '$1********@');
}
