// Мастера диагностики Linux: команды (только чтение) и анализ вывода.
// Выводы не делаются по одному показателю: каждая проверка показывает исходный вывод и критерии оценки.
import type { CheckStatus } from './types';
import { DB_CHECKS, DB_TASKS } from './dbDiag';

export interface CmdOutput {
  command: string;
  output: string;
  code?: number | null;
  error?: string;
}

export interface CheckAnalysis {
  status: CheckStatus;
  summary: string;
  metrics?: Record<string, number>;
  findings: string[];
}

export interface LinuxCheckDef {
  id: string;
  title: string;
  commands: string[];
  criteria: string;
  analyze: (out: CmdOutput[]) => CheckAnalysis;
}

const lines = (s: string) => s.split(/\r?\n/).filter((l) => l.trim());
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
const fmtBytes = (b: number) => {
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

export function parseFreeBytes(text: string): { total: number; available: number; swapTotal: number; swapUsed: number } | null {
  const mem = /^Mem:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(text);
  if (!mem) return null;
  const swap = /^Swap:\s+(\d+)\s+(\d+)/m.exec(text);
  return {
    total: Number(mem[1]),
    available: Number(mem[6]),
    swapTotal: swap ? Number(swap[1]) : 0,
    swapUsed: swap ? Number(swap[2]) : 0
  };
}

export interface DfRow {
  fs: string;
  size: number;
  used: number;
  avail: number;
  usePct: number;
  mount: string;
}

export function parseDf(text: string): DfRow[] {
  const rows: DfRow[] = [];
  for (const l of lines(text).slice(1)) {
    const m = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(l.trim());
    if (m) rows.push({ fs: m[1], size: Number(m[2]), used: Number(m[3]), avail: Number(m[4]), usePct: Number(m[5]), mount: m[6] });
  }
  return rows;
}

function worst(a: CheckStatus, b: CheckStatus): CheckStatus {
  const order: CheckStatus[] = ['ok', 'info', 'unknown', 'warn', 'crit'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

const BASE_CHECKS: LinuxCheckDef[] = [
  {
    id: 'system',
    title: 'Общие сведения',
    commands: ['cat /etc/os-release', 'uname -r', 'uptime', 'hostnamectl 2>/dev/null || hostname'],
    criteria: 'Информационная проверка: дистрибутив, ядро, время работы.',
    analyze(out) {
      const os = /PRETTY_NAME="?([^"\n]+)"?/.exec(out[0]?.output ?? '')?.[1] ?? 'неизвестно';
      const kernel = out[1]?.output.trim() ?? '';
      const up = /up\s+(.+?),\s+\d+\s+user/.exec(out[2]?.output ?? '')?.[1] ?? out[2]?.output.trim() ?? '';
      return { status: 'info', summary: `${os}; ядро ${kernel}; работает ${up}`, findings: [] };
    }
  },
  {
    id: 'cpu',
    title: 'Нагрузка процессора',
    commands: ['nproc', 'cat /proc/loadavg', 'top -b -n 1 | head -15'],
    criteria: 'Средняя нагрузка за 5 минут делится на число процессоров: ≤ 1 — норма, 1–2 — повышенная, > 2 — перегрузка. Высокий load при низком %CPU обычно означает ожидание дисков (wa в top).',
    analyze(out) {
      const n = Number(out[0]?.output.trim()) || 0;
      const la = (out[1]?.output ?? '').trim().split(/\s+/).slice(0, 3).map(Number);
      if (!n || la.length < 3 || la.some(Number.isNaN)) return { status: 'unknown', summary: 'Не удалось разобрать вывод', findings: [] };
      const ratio = la[1] / n;
      const status: CheckStatus = ratio > 2 ? 'crit' : ratio > 1 ? 'warn' : 'ok';
      const wa = /(\d+[.,]\d+)\s*wa/.exec(out[2]?.output ?? '')?.[1];
      const findings: string[] = [];
      if (wa && Number(wa.replace(',', '.')) > 20) findings.push(`Высокое ожидание ввода-вывода (wa ${wa}%) — проверьте диски (iostat -xz).`);
      return {
        status,
        summary: `Load average ${la.slice(0, 3).join(' / ')} при ${n} CPU (нагрузка на CPU за 5 мин: ${ratio.toFixed(2)})`,
        metrics: { load1: la[0], load5: la[1], load15: la[2], cpus: n, loadPerCpu: Math.round(ratio * 100) / 100 },
        findings
      };
    }
  },
  {
    id: 'memory',
    title: 'Оперативная память',
    commands: ['free -b'],
    criteria: 'Используется (total − available): < 85% — норма, 85–95% — мало свободной памяти, > 95% — критично. Заполненный более чем наполовину swap — признак постоянной нехватки памяти.',
    analyze(out) {
      const f = parseFreeBytes(out[0]?.output ?? '');
      if (!f) return { status: 'unknown', summary: 'Не удалось разобрать вывод free', findings: [] };
      const used = ((f.total - f.available) / f.total) * 100;
      let status: CheckStatus = used > 95 ? 'crit' : used > 85 ? 'warn' : 'ok';
      const findings: string[] = [];
      const swapPct = f.swapTotal ? (f.swapUsed / f.swapTotal) * 100 : 0;
      if (f.swapTotal && swapPct > 50) {
        status = worst(status, 'warn');
        findings.push(`Swap заполнен на ${pct(swapPct)}.`);
      }
      if (!f.swapTotal) findings.push('Swap не настроен (это допустимо, но при нехватке памяти процессы будут завершаться OOM killer).');
      return {
        status,
        summary: `Используется ${pct(used)} из ${fmtBytes(f.total)}, доступно ${fmtBytes(f.available)}${f.swapTotal ? `; swap ${pct(swapPct)}` : ''}`,
        metrics: { memUsedPct: Math.round(used * 10) / 10, memTotal: f.total, memAvailable: f.available, swapUsedPct: Math.round(swapPct * 10) / 10 },
        findings
      };
    }
  },
  {
    id: 'disks',
    title: 'Свободное место на дисках',
    commands: ['df -PB1 -x tmpfs -x devtmpfs -x squashfs -x overlay', 'df -Pi -x tmpfs -x devtmpfs -x squashfs -x overlay'],
    criteria: 'Для каждой файловой системы: заполнение < 85% — норма, 85–95% — предупреждение, ≥ 95% — критично. Так же оцениваются inode.',
    analyze(out) {
      const rows = parseDf(out[0]?.output ?? '');
      const inodes = parseDf(out[1]?.output ?? '');
      if (!rows.length) return { status: 'unknown', summary: 'Не удалось разобрать вывод df', findings: [] };
      let status: CheckStatus = 'ok';
      const findings: string[] = [];
      const metrics: Record<string, number> = {};
      for (const r of rows) {
        metrics[`use:${r.mount}`] = r.usePct;
        if (r.usePct >= 95) {
          status = worst(status, 'crit');
          findings.push(`${r.mount}: заполнено ${r.usePct}% (свободно ${fmtBytes(r.avail)})`);
        } else if (r.usePct >= 85) {
          status = worst(status, 'warn');
          findings.push(`${r.mount}: заполнено ${r.usePct}% (свободно ${fmtBytes(r.avail)})`);
        }
      }
      for (const r of inodes) {
        if (r.usePct >= 85) {
          status = worst(status, r.usePct >= 95 ? 'crit' : 'warn');
          findings.push(`${r.mount}: использовано ${r.usePct}% inode`);
        }
      }
      const top = [...rows].sort((a, b) => b.usePct - a.usePct)[0];
      return { status, summary: `${rows.length} ФС; максимальное заполнение ${top.usePct}% (${top.mount})`, metrics, findings };
    }
  },
  {
    id: 'network',
    title: 'Сетевые интерфейсы',
    commands: ['ip -br link', 'ip -br addr'],
    criteria: 'Интерфейс с IP-адресом в состоянии DOWN — предупреждение. Интерфейсы без адресов в состоянии DOWN показываются как информация.',
    analyze(out) {
      const addrs = lines(out[1]?.output ?? '').map((l) => l.trim().split(/\s+/));
      if (!addrs.length) return { status: 'unknown', summary: 'Нет данных', findings: [] };
      const findings: string[] = [];
      let status: CheckStatus = 'ok';
      let up = 0;
      for (const [name, state, ...ips] of addrs) {
        if (name === 'lo') continue;
        const hasIp = ips.length > 0;
        if (state === 'UP' || state === 'UNKNOWN') up++;
        else if (hasIp) {
          status = worst(status, 'warn');
          findings.push(`${name}: ${state}, но назначены адреса ${ips.join(' ')}`);
        } else findings.push(`${name}: ${state} (без адресов)`);
      }
      return { status, summary: `Активных интерфейсов: ${up}`, metrics: { ifUp: up }, findings };
    }
  },
  {
    id: 'routes',
    title: 'Маршруты',
    commands: ['ip route', 'ip -6 route 2>/dev/null | head -20'],
    criteria: 'Отсутствие маршрута по умолчанию (default) — предупреждение (для изолированных серверов это может быть нормой).',
    analyze(out) {
      const r = out[0]?.output ?? '';
      const def = /^default via (\S+)(?: dev (\S+))?/m.exec(r);
      if (def) return { status: 'ok', summary: `Шлюз по умолчанию ${def[1]}${def[2] ? ` через ${def[2]}` : ''}`, findings: [] };
      return { status: 'warn', summary: 'Маршрут по умолчанию не найден', findings: ['Нет default route — доступ за пределы локальных сетей невозможен.'] };
    }
  },
  {
    id: 'dns',
    title: 'DNS',
    commands: ["grep -E '^(nameserver|search|domain)' /etc/resolv.conf", 'getent hosts deb.debian.org || echo "RESOLVE_FAILED"'],
    criteria: 'Проверяется разрешение внешнего имени deb.debian.org через системный резолвер. В изолированных сетях без внешнего DNS ошибка может быть нормой.',
    analyze(out) {
      const ns = lines(out[0]?.output ?? '').filter((l) => l.startsWith('nameserver')).map((l) => l.split(/\s+/)[1]);
      const failed = /RESOLVE_FAILED/.test(out[1]?.output ?? '') || !(out[1]?.output ?? '').trim();
      return {
        status: failed ? 'warn' : 'ok',
        summary: `${ns.length ? `DNS-серверы: ${ns.join(', ')}` : 'DNS-серверы в resolv.conf не найдены'}; ${failed ? 'внешнее имя не разрешается' : 'разрешение имён работает'}`,
        findings: failed ? ['Проверьте доступность DNS-серверов: dig @сервер имя'] : []
      };
    }
  },
  {
    id: 'ports',
    title: 'Открытые порты',
    commands: ['ss -tulpn 2>/dev/null || ss -tuln'],
    criteria: 'Информационная проверка: какие службы слушают порты на внешних адресах. Имена процессов других пользователей видны только с root.',
    analyze(out) {
      const rows = lines(out[0]?.output ?? '').slice(1);
      const exposed = rows.filter((l) => !/127\.0\.0\.\d+:|\[::1\]:|%lo:/.test(l));
      const ports = new Set<string>();
      for (const l of exposed) {
        const m = /\s(\S+):(\d+)\s+\S+:\*/.exec(l) ?? /\s(\S+):(\d+)\s/.exec(l);
        if (m) ports.add(`${l.startsWith('udp') ? 'udp' : 'tcp'}/${m[2]}`);
      }
      return { status: 'info', summary: `Слушающих сокетов: ${rows.length}, доступных извне: ${exposed.length}`, metrics: { listening: rows.length, exposed: exposed.length }, findings: ports.size ? [`Порты на внешних адресах: ${[...ports].join(', ')}`] : [] };
    }
  },
  {
    id: 'ssh',
    title: 'SSH-сервер',
    commands: ['systemctl is-active ssh 2>/dev/null || systemctl is-active sshd', "sshd -T 2>/dev/null | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries) ' || echo 'NEED_ROOT'"],
    criteria: 'Служба SSH должна быть активна. PermitRootLogin yes — предупреждение. Параметры sshd -T доступны только с правами root.',
    analyze(out) {
      const state = (out[0]?.output ?? '').trim().split('\n')[0]?.trim() ?? '';
      const active = /^active/.test(state);
      const conf = out[1]?.output ?? '';
      const findings: string[] = [];
      // Сессия уже идёт по SSH, поэтому «не активна» по данным systemd — повод проверить, а не авария:
      // может использоваться socket-активация или другой SSH-сервер (dropbear).
      let status: CheckStatus = active ? 'ok' : state ? 'warn' : 'unknown';
      if (!active && state) findings.push(`systemctl is-active: ${state}. Возможно, используется ssh.socket или другой SSH-сервер — проверьте: systemctl status ssh.socket`);
      if (!state) findings.push('Состояние службы не получено (нет systemd или нет доступа).');
      if (/NEED_ROOT/.test(conf)) findings.push('Параметры sshd не прочитаны: нужны права root (sudo sshd -T).');
      if (/^permitrootlogin yes/im.test(conf)) {
        status = worst(status, 'warn');
        findings.push('Разрешён вход root по паролю (PermitRootLogin yes).');
      }
      if (/^passwordauthentication yes/im.test(conf)) findings.push('Включена аутентификация по паролю.');
      return { status, summary: active ? 'Служба SSH активна' : state ? 'Служба ssh/sshd не активна по данным systemd' : 'Состояние службы SSH не определено', findings };
    }
  },
  {
    id: 'services',
    title: 'Службы с ошибками',
    commands: ['systemctl --failed --no-legend --plain'],
    criteria: 'Любая служба в состоянии failed — проблема, требующая разбора (journalctl -u <служба>).',
    analyze(out) {
      const failed = lines(out[0]?.output ?? '').map((l) => l.trim().split(/\s+/)[0]).filter((n) => n && n !== '0');
      return {
        status: failed.length ? 'crit' : 'ok',
        summary: failed.length ? `Служб с ошибками: ${failed.length}` : 'Служб с ошибками нет',
        metrics: { failed: failed.length },
        findings: failed.map((f) => `failed: ${f}`)
      };
    }
  },
  {
    id: 'logs',
    title: 'Ошибки в системном журнале',
    commands: ['journalctl -p err -b --no-pager -n 50 2>&1'],
    criteria: 'Сообщения уровня err и выше с последней загрузки. Единичные ошибки встречаются часто; 20 и более — повод разобраться. Без прав (группа adm/systemd-journal) видны только свои сообщения.',
    analyze(out) {
      const ls = lines(out[0]?.output ?? '').filter((l) => !/^-- (No entries|Logs begin|Journal begins)/.test(l));
      const noPerm = /not seeing messages from other users|insufficient permissions/i.test(out[0]?.output ?? '');
      const status: CheckStatus = ls.length >= 20 ? 'warn' : ls.length ? 'info' : 'ok';
      return { status, summary: `Ошибок в журнале (последние 50): ${ls.length}`, metrics: { journalErrors: ls.length }, findings: noPerm ? ['Нет прав на чтение всего журнала — запустите от пользователя из группы adm.'] : [] };
    }
  },
  {
    id: 'autostart',
    title: 'Автозагрузка',
    commands: ['systemctl list-unit-files --type=service --state=enabled --no-legend --plain'],
    criteria: 'Информационная проверка: службы с автозапуском.',
    analyze(out) {
      const svc = lines(out[0]?.output ?? '').map((l) => l.split(/\s+/)[0]);
      return { status: 'info', summary: `Служб с автозапуском: ${svc.length}`, metrics: { enabled: svc.length }, findings: [svc.slice(0, 40).join(', ')] };
    }
  },
  {
    id: 'users',
    title: 'Пользователи',
    commands: ['who', "getent passwd | awk -F: '$3==0 {print $1}'", "getent passwd | awk -F: '$3>=1000 && $3<65534 {print $1}'"],
    criteria: 'Учётная запись с UID 0, кроме root, — предупреждение. Показываются вошедшие и обычные пользователи.',
    analyze(out) {
      const uid0 = lines(out[1]?.output ?? '').filter((u) => u !== 'root');
      const logged = lines(out[0]?.output ?? '');
      const regular = lines(out[2]?.output ?? '');
      return {
        status: uid0.length ? 'warn' : 'ok',
        summary: `Сейчас в системе: ${logged.length}; обычных учётных записей: ${regular.length}`,
        findings: [...uid0.map((u) => `UID 0 у пользователя ${u}`), regular.length ? `Пользователи: ${regular.join(', ')}` : ''].filter(Boolean)
      };
    }
  },
  {
    id: 'firewall',
    title: 'Firewall',
    commands: ['for s in ufw nftables firewalld; do echo "$s=$(systemctl is-active "$s" 2>/dev/null)"; done'],
    criteria: 'Проверяется, активна ли служба firewall (ufw, nftables, firewalld). Правила iptables, загруженные без службы, этой проверкой не видны — смотрите nft list ruleset / iptables -L (root).',
    analyze(out) {
      const active = lines(out[0]?.output ?? '').filter((l) => /=active$/.test(l)).map((l) => l.split('=')[0]);
      return {
        status: active.length ? 'ok' : 'warn',
        summary: active.length ? `Активен: ${active.join(', ')}` : 'Служба firewall не активна',
        findings: active.length ? [] : ['Убедитесь, что сервер защищён внешним межсетевым экраном или настройте ufw/nftables.']
      };
    }
  },
  {
    id: 'updates',
    title: 'Обновления',
    commands: ['apt list --upgradable 2>/dev/null | tail -n +2', 'test -f /var/run/reboot-required && cat /var/run/reboot-required || echo "NO_REBOOT"'],
    criteria: 'По данным последнего apt update (сама проверка списки не обновляет). Доступные обновления безопасности или требование перезагрузки — предупреждение.',
    analyze(out) {
      const up = lines(out[0]?.output ?? '');
      const sec = up.filter((l) => /security/i.test(l));
      const reboot = !/NO_REBOOT/.test(out[1]?.output ?? '');
      const findings: string[] = [];
      if (sec.length) findings.push(`Обновлений безопасности: ${sec.length}`);
      if (reboot) findings.push('Требуется перезагрузка (/var/run/reboot-required).');
      return { status: sec.length || reboot ? 'warn' : up.length ? 'info' : 'ok', summary: `Доступно обновлений: ${up.length}`, metrics: { upgradable: up.length, security: sec.length }, findings };
    }
  },
  {
    id: 'docker',
    title: 'Docker',
    commands: ['command -v docker >/dev/null 2>&1 && docker ps -a --format "{{.Names}}\\t{{.Status}}" 2>&1 || echo "NO_DOCKER"'],
    criteria: 'Если Docker установлен: контейнеры в состоянии Exited с ненулевым кодом или Restarting — предупреждение.',
    analyze(out) {
      const o = out[0]?.output ?? '';
      if (/NO_DOCKER/.test(o)) return { status: 'info', summary: 'Docker не установлен', findings: [] };
      if (/permission denied/i.test(o)) return { status: 'unknown', summary: 'Нет доступа к Docker (нужен root или группа docker)', findings: [] };
      const rows = lines(o).map((l) => l.split('\t'));
      const bad = rows.filter(([, s]) => /Restarting|Exited \((?!0\))/.test(s ?? ''));
      return { status: bad.length ? 'warn' : 'ok', summary: `Контейнеров: ${rows.length}, проблемных: ${bad.length}`, metrics: { containers: rows.length, badContainers: bad.length }, findings: bad.map(([n, s]) => `${n}: ${s}`) };
    }
  }
  ,
  {
    id: 'time',
    title: 'Время и синхронизация',
    commands: ['timedatectl show -p Timezone -p NTPSynchronized -p NTP 2>/dev/null || timedatectl', 'date "+%F %T %Z"'],
    criteria: 'Часы должны синхронизироваться (NTPSynchronized=yes). Неверное время ломает журналы, вход в домен, Kerberos и проверку сертификатов.',
    analyze(out) {
      const o = out[0]?.output ?? '';
      const synced = /NTPSynchronized=yes|synchronized:\s*yes/i.test(o);
      const tz = /Timezone=(\S+)/.exec(o)?.[1] ?? /Time zone:\s*(\S+)/.exec(o)?.[1] ?? '?';
      const known = /NTPSynchronized=|synchronized:/i.test(o);
      return {
        status: !known ? 'unknown' : synced ? 'ok' : 'warn',
        summary: `${synced ? 'Синхронизировано' : 'Не синхронизировано'}; пояс ${tz}; сейчас ${(out[1]?.output ?? '').trim()}`,
        findings: synced || !known ? [] : ['Включите синхронизацию: sudo timedatectl set-ntp true и проверьте доступность NTP-сервера (UDP 123).']
      };
    }
  },
  {
    id: 'inodes',
    title: 'Inode (количество файлов)',
    commands: ['df -iP -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null'],
    criteria: 'Использование inode ≥ 90% — проблема: новые файлы не создаются, даже если место есть. ≥ 75% — внимание.',
    analyze(out) {
      const rows = lines(out[0]?.output ?? '').slice(1).map((l) => l.split(/\s+/)).filter((r) => r.length >= 6 && /%$/.test(r[4]));
      let worst = 0;
      const findings: string[] = [];
      for (const r of rows) {
        const p = Number(r[4].replace('%', ''));
        if (Number.isFinite(p)) {
          worst = Math.max(worst, p);
          if (p >= 75) findings.push(`${r[5]}: занято ${p}% inode — ищите каталоги с множеством мелких файлов`);
        }
      }
      return { status: !rows.length ? 'unknown' : worst >= 90 ? 'crit' : worst >= 75 ? 'warn' : 'ok', summary: rows.length ? `Максимальное использование inode: ${worst}%` : 'Нет данных', metrics: { inodeMaxPct: worst }, findings };
    }
  },
  {
    id: 'oom',
    title: 'Нехватка памяти (OOM)',
    commands: ['journalctl -k -b --no-pager 2>/dev/null | grep -iE "out of memory|oom-kill|killed process" | tail -n 20'],
    criteria: 'Если с последней загрузки ядро завершало процессы из-за нехватки памяти — проблема: какая-то служба падала.',
    analyze(out) {
      const ls = lines(out[0]?.output ?? '');
      return { status: ls.length ? 'crit' : 'ok', summary: ls.length ? `Событий OOM с загрузки: ${ls.length}` : 'Событий нехватки памяти нет', metrics: { oomEvents: ls.length }, findings: ls.slice(-5) };
    }
  },
  {
    id: 'kernel',
    title: 'Ошибки ядра и оборудования',
    commands: ['journalctl -k -b -p err --no-pager 2>&1 | tail -n 40'],
    criteria: 'Ошибки ввода-вывода дисков (I/O error), файловой системы, сетевых карт — проблема. Прочие ошибки ядра — внимание. Без прав виден не весь журнал.',
    analyze(out) {
      const o = out[0]?.output ?? '';
      const ls = lines(o).filter((l) => !/^-- (No entries|Logs begin|Journal begins)/.test(l));
      const hw = ls.filter((l) => /i\/o error|ata\d|nvme.*(error|timeout)|ext4-fs error|xfs.*(error|corrupt)|link is down|hardware error|mce/i.test(l));
      const noPerm = /not seeing messages|insufficient permissions/i.test(o);
      return {
        status: hw.length ? 'crit' : ls.length ? 'warn' : noPerm ? 'unknown' : 'ok',
        summary: `Ошибок ядра с загрузки: ${ls.length}, из них оборудования/дисков: ${hw.length}`,
        metrics: { kernelErrors: ls.length, hwErrors: hw.length },
        findings: [...hw.slice(-5), ...(noPerm ? ['Нет прав на чтение журнала ядра — запустите от пользователя из группы adm или посмотрите sudo dmesg.'] : [])]
      };
    }
  },
  {
    id: 'raid',
    title: 'Программный RAID (mdadm)',
    commands: ['cat /proc/mdstat 2>/dev/null || echo "NO_MD"'],
    criteria: 'Массив с отсутствующим диском ([U_], [_U]) или в состоянии восстановления — проблема/внимание. Аппаратный RAID этой проверкой не виден.',
    analyze(out) {
      const o = out[0]?.output ?? '';
      if (/NO_MD/.test(o) || !/^md\d+/m.test(o)) return { status: 'info', summary: 'Программный RAID не используется', findings: [] };
      const degraded = /\[[U_]*_[U_]*\]/.test(o);
      const resync = /recovery|resync|reshape/.test(o);
      const arrays = (o.match(/^md\d+/gm) ?? []).length;
      return { status: degraded ? 'crit' : resync ? 'warn' : 'ok', summary: `Массивов: ${arrays}${degraded ? ', есть деградированные' : ''}${resync ? ', идёт восстановление' : ''}`, findings: degraded ? ['Замените вышедший диск и добавьте его в массив (mdadm --add).'] : [] };
    }
  },
  {
    id: 'reboot',
    title: 'Требуется ли перезагрузка',
    commands: ['test -f /var/run/reboot-required && cat /var/run/reboot-required.pkgs 2>/dev/null | head -n 20 || echo "NO_REBOOT"', 'uptime -s'],
    criteria: 'После обновления ядра или системных библиотек нужна перезагрузка — внимание.',
    analyze(out) {
      const o = out[0]?.output ?? '';
      const need = !/NO_REBOOT/.test(o);
      return { status: need ? 'warn' : 'ok', summary: `${need ? 'Требуется перезагрузка' : 'Перезагрузка не требуется'}; загружен с ${(out[1]?.output ?? '').trim()}`, findings: need ? lines(o).map((p) => `Пакет: ${p}`) : [] };
    }
  },
  {
    id: 'zombies',
    title: 'Зависшие и зомби-процессы',
    commands: ["ps -eo stat,pid,ppid,etime,comm --no-headers | awk '$1 ~ /^Z/ || $1 ~ /^D/'"],
    criteria: 'Зомби (Z) — процесс завершился, но родитель его не «забрал»: единичные — норма, много — внимание. D — ожидание ввода-вывода: долго висящие D-процессы указывают на проблемы с диском или сетевым хранилищем.',
    analyze(out) {
      const ls = lines(out[0]?.output ?? '');
      const z = ls.filter((l) => l.startsWith('Z'));
      const d = ls.filter((l) => l.startsWith('D'));
      return { status: z.length > 10 || d.length > 5 ? 'warn' : 'ok', summary: `Зомби: ${z.length}, в ожидании ввода-вывода: ${d.length}`, metrics: { zombies: z.length, dState: d.length }, findings: [...d.slice(0, 5)] };
    }
  },
  {
    id: 'logins',
    title: 'Неудачные попытки входа',
    commands: ['journalctl -u ssh -u sshd --since "24 hours ago" --no-pager 2>/dev/null | grep -ciE "failed password|invalid user|authentication failure"', 'journalctl -u ssh -u sshd --since "24 hours ago" --no-pager 2>/dev/null | grep -oiE "from [0-9a-f.:]+" | sort | uniq -c | sort -rn | head -5'],
    criteria: 'Сотни неудачных входов за сутки — сервер перебирают: включите fail2ban, вход по ключам, запретите пароли и root. Без прав журнал может быть недоступен.',
    analyze(out) {
      const n = Number((out[0]?.output ?? '').trim()) || 0;
      return { status: n >= 100 ? 'warn' : n > 0 ? 'info' : 'ok', summary: `Неудачных попыток входа за сутки: ${n}`, metrics: { failedLogins: n }, findings: n ? lines(out[1]?.output ?? '').map((l) => `Чаще всего: ${l.trim()}`) : [] };
    }
  },
  {
    id: 'web',
    title: 'Веб-серверы',
    commands: ['for s in nginx apache2 httpd; do echo "$s=$(systemctl is-active "$s" 2>/dev/null)"; done', 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1/ 2>/dev/null || echo "NO_HTTP"'],
    criteria: 'Если веб-сервер установлен, он должен быть active и отвечать на http://127.0.0.1 (коды 2xx–4xx — сервер работает; 5xx или нет ответа — проблема).',
    analyze(out) {
      const st = lines(out[0]?.output ?? '').map((l) => l.split('='));
      const present = st.filter(([, v]) => v && v !== 'inactive' && v !== 'unknown' && v !== '');
      const failed = present.filter(([, v]) => v !== 'active');
      const code = (out[1]?.output ?? '').trim();
      if (!present.length) return { status: 'info', summary: 'Веб-сервер не установлен или не запущен', findings: [] };
      const bad = failed.length || /^5/.test(code) || code === '000' || code === 'NO_HTTP';
      return { status: bad ? 'crit' : 'ok', summary: `${present.map(([n, v]) => `${n}: ${v}`).join(', ')}; ответ локально: ${code}`, findings: bad ? ['Смотрите журнал ошибок веб-сервера и проверьте конфигурацию (nginx -t / apache2ctl configtest).'] : [] };
    }
  },
  {
    id: 'databases',
    title: 'Базы данных',
    commands: ['for s in mysql mariadb postgresql redis-server mongod; do echo "$s=$(systemctl is-active "$s" 2>/dev/null)"; done'],
    criteria: 'Установленные службы баз данных должны быть active. failed — проблема.',
    analyze(out) {
      const st = lines(out[0]?.output ?? '').map((l) => l.split('=')).filter(([, v]) => v && v !== 'inactive' && v !== 'unknown');
      if (!st.length) return { status: 'info', summary: 'Службы баз данных не найдены', findings: [] };
      const bad = st.filter(([, v]) => v !== 'active');
      return { status: bad.length ? 'crit' : 'ok', summary: st.map(([n, v]) => `${n}: ${v}`).join(', '), findings: bad.map(([n]) => `Служба ${n} не работает: journalctl -u ${n} -n 50`) };
    }
  },
  {
    id: 'mounts',
    title: 'Подключённые диски и сетевые папки',
    commands: ["findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS | awk '$3 ~ /^(nfs|nfs4|cifs|smb3|fuse.sshfs)$/'", "awk '$1 !~ /^#/ && $2 ~ /^\\// && $3 != \"swap\" {print $2}' /etc/fstab | while read m; do mountpoint -q \"$m\" || echo \"NOT_MOUNTED $m\"; done", "findmnt -rn -o TARGET,OPTIONS | awk '$2 ~ /(^|,)ro(,|$)/ {print $1}' | grep -vE '^/(sys|proc|snap)' | head"],
    criteria: 'Точки из /etc/fstab, которые не смонтированы, — внимание. Разделы, смонтированные только для чтения (ro) неожиданно, — проблема (часто ошибки диска).',
    analyze(out) {
      const net = lines(out[0]?.output ?? '');
      const missing = lines(out[1]?.output ?? '').filter((l) => l.startsWith('NOT_MOUNTED')).map((l) => l.replace('NOT_MOUNTED ', ''));
      const ro = lines(out[2]?.output ?? '').filter((l) => !/^\/(boot\/efi|run|dev)/.test(l));
      return {
        status: ro.length ? 'crit' : missing.length ? 'warn' : 'ok',
        summary: `Сетевых подключений: ${net.length}; не смонтировано из fstab: ${missing.length}; только чтение: ${ro.length}`,
        findings: [...missing.map((m) => `Не смонтировано: ${m}`), ...ro.map((m) => `Только чтение: ${m} — проверьте dmesg на ошибки диска`)]
      };
    }
  }
];

/** Все проверки: системные и баз данных (MySQL / MariaDB, PostgreSQL). */
export const LINUX_CHECKS: LinuxCheckDef[] = [...BASE_CHECKS, ...DB_CHECKS];

export interface LinuxTask {
  id: string;
  title: string;
  checks: string[];
}

export const LINUX_TASK_GROUPS = [
  { id: 'complex', label: 'Комплексные проверки' },
  { id: 'db', label: 'Базы данных (MySQL / MariaDB, PostgreSQL)' },
  { id: 'single', label: 'Отдельные проверки' }
] as const;

/** Группа задачи для списка: базы данных, комплексные (несколько проверок) или отдельные. */
export function linuxTaskGroup(t: LinuxTask): (typeof LINUX_TASK_GROUPS)[number]['id'] {
  if (t.id === 'databases' || t.id.startsWith('db-')) return 'db';
  return t.checks.length > 1 ? 'complex' : 'single';
}

export const LINUX_TASKS: LinuxTask[] = [
  { id: 'full', title: 'Общая диагностика сервера', checks: ['system', 'cpu', 'memory', 'oom', 'disks', 'inodes', 'mounts', 'raid', 'network', 'routes', 'dns', 'time', 'services', 'web', 'databases', 'logs', 'kernel', 'ssh', 'logins', 'firewall', 'updates', 'reboot', 'docker'] },
  { id: 'quick', title: 'Быстрая проверка (нагрузка, память, диски, службы)', checks: ['cpu', 'memory', 'disks', 'services'] },
  { id: 'slow', title: 'Сервер тормозит', checks: ['cpu', 'memory', 'oom', 'zombies', 'disks', 'kernel'] },
  { id: 'disk-problems', title: 'Проблемы с дисками', checks: ['disks', 'inodes', 'mounts', 'raid', 'kernel'] },
  { id: 'security', title: 'Безопасность', checks: ['ssh', 'logins', 'users', 'firewall', 'updates', 'ports'] },
  { id: 'apps', title: 'Веб-серверы, базы данных, Docker', checks: ['web', 'databases', 'db-mysql-conn', 'db-pg-conn', 'docker'] },
  { id: 'after-crash', title: 'После сбоя или перезагрузки', checks: ['system', 'services', 'oom', 'kernel', 'logs', 'mounts', 'time'] },
  { id: 'cpu', title: 'Проверка нагрузки процессора', checks: ['cpu'] },
  { id: 'memory', title: 'Проверка оперативной памяти', checks: ['memory'] },
  { id: 'disks', title: 'Проверка дисков и свободного пространства', checks: ['disks'] },
  { id: 'network', title: 'Проверка сетевых интерфейсов', checks: ['network'] },
  { id: 'routes', title: 'Проверка маршрутов', checks: ['routes'] },
  { id: 'dns', title: 'Проверка DNS', checks: ['dns'] },
  { id: 'ports', title: 'Проверка открытых портов', checks: ['ports'] },
  { id: 'ssh', title: 'Проверка SSH', checks: ['ssh'] },
  { id: 'services', title: 'Проверка служб', checks: ['services'] },
  { id: 'logs', title: 'Проверка системных логов', checks: ['logs'] },
  { id: 'autostart', title: 'Проверка автозагрузки', checks: ['autostart'] },
  { id: 'users', title: 'Проверка пользователей', checks: ['users'] },
  { id: 'firewall', title: 'Проверка состояния firewall', checks: ['firewall'] },
  { id: 'updates', title: 'Проверка обновлений', checks: ['updates'] },
  { id: 'docker', title: 'Проверка Docker', checks: ['docker'] },
  { id: 'time', title: 'Проверка времени', checks: ['time'] },
  { id: 'reboot', title: 'Нужна ли перезагрузка', checks: ['reboot'] },
  { id: 'logins', title: 'Неудачные попытки входа', checks: ['logins'] },
  { id: 'raid', title: 'Проверка RAID', checks: ['raid'] },
  { id: 'web', title: 'Проверка веб-серверов', checks: ['web'] },
  { id: 'databases', title: 'Базы данных: быстрая проверка', checks: ['databases', 'db-mysql-conn', 'db-mysql-disk', 'db-pg-conn', 'db-pg-disk'] },
  ...DB_TASKS
];

export function checkById(id: string): LinuxCheckDef | undefined {
  return LINUX_CHECKS.find((c) => c.id === id);
}

/** Сравнение метрик с предыдущим отчётом. */
export function compareMetrics(prev: Record<string, number> | undefined, cur: Record<string, number> | undefined): string[] {
  if (!prev || !cur) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(cur)) {
    if (!(k in prev)) continue;
    const d = v - prev[k];
    if (Math.abs(d) >= 0.01 && Math.abs(d) >= Math.abs(prev[k]) * 0.05) out.push(`${k}: ${prev[k]} → ${v} (${d > 0 ? '+' : ''}${Math.round(d * 100) / 100})`);
  }
  return out;
}
