// Проверка доступности SSH-порта без входа: DNS → TCP → приветствие сервера.
// Помогает понять, на каком этапе не удаётся подключиться.
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import type { ProbeResult, ProbeStep } from '../../shared/types';

export async function probeSsh(host: string, port: number, timeoutMs = 7000, protocol: 'ssh' | 'telnet' = 'ssh'): Promise<ProbeResult> {
  const svc = protocol === 'telnet' ? 'Telnet' : 'SSH';
  const steps: ProbeStep[] = [];
  let address = host;
  // 1. DNS
  if (net.isIP(host)) steps.push({ step: 'dns', ok: true, text: `${host} — IP-адрес, DNS не нужен` });
  else {
    const t0 = Date.now();
    try {
      const all = await lookup(host, { all: true });
      address = all[0].address;
      steps.push({ step: 'dns', ok: true, text: `${host} → ${all.map((a) => a.address).join(', ')} (${Date.now() - t0} мс)` });
    } catch (e) {
      steps.push({ step: 'dns', ok: false, text: `Имя ${host} не найдено в DNS (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})` });
      return finish(steps, 'Имя узла не найдено. Проверьте написание или используйте IP-адрес.');
    }
  }
  // 2. TCP и 3. приветствие SSH
  const t1 = Date.now();
  const r = await new Promise<{ ok: boolean; err?: string; banner?: string; ms: number; closedEarly?: boolean }>((resolve) => {
    const sock = net.connect({ host: address, port });
    let connected = false;
    let buf = '';
    let done = false;
    const end = (v: { ok: boolean; err?: string; banner?: string; closedEarly?: boolean }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ ...v, ms: Date.now() - t1 });
    };
    const timer = setTimeout(() => end(connected ? { ok: true, banner: buf || undefined } : { ok: false, err: 'ETIMEDOUT' }), timeoutMs);
    sock.on('connect', () => {
      connected = true;
      steps.push({ step: 'tcp', ok: true, text: `TCP-порт ${port} открыт (${Date.now() - t1} мс)` });
    });
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      if (buf.includes('\n')) end({ ok: true, banner: buf.split(/\r?\n/)[0] });
    });
    sock.on('error', (e: NodeJS.ErrnoException) => end({ ok: connected, err: e.code ?? e.message, banner: buf || undefined, closedEarly: connected }));
    sock.on('close', () => end({ ok: connected, banner: buf || undefined, closedEarly: connected && !buf }));
  });
  if (!steps.some((s) => s.step === 'tcp')) {
    const why: Record<string, string> = {
      ECONNREFUSED: `порт закрыт — ${svc}-сервер не запущен или слушает другой порт`,
      ETIMEDOUT: 'нет ответа — узел выключен, недоступен по сети или порт фильтруется firewall',
      EHOSTUNREACH: 'нет маршрута до узла',
      ENETUNREACH: 'сеть недоступна',
      ECONNRESET: 'соединение сброшено'
    };
    steps.push({ step: 'tcp', ok: false, text: `TCP-порт ${port}: ${why[r.err ?? ''] ?? r.err ?? 'ошибка'} (${r.ms} мс)` });
    return finish(steps, r.err === 'ECONNREFUSED' ? `Порт закрыт. Проверьте номер порта и что ${svc} на устройстве включён.` : 'До порта не достучаться. Проверьте адрес, VPN, маршрут и firewall.');
  }
  if (protocol === 'telnet') {
    // Telnet-сервер обычно сразу присылает согласование опций (байты 0xFF…) или приглашение входа.
    if (r.closedEarly) {
      steps.push({ step: 'banner', ok: false, text: 'Устройство приняло соединение и сразу закрыло его' });
      return finish(steps, 'Порт открыт, но устройство разрывает соединение: заняты все линии vty, доступ ограничен (access-class/ACL) или Telnet выключен на линиях.');
    }
    steps.push({ step: 'banner', ok: true, text: r.banner ? 'Telnet-сервер ответил' : 'Соединение установлено, устройство ждёт ввода' });
    return finish(steps, 'Порт доступен, Telnet отвечает. Если войти не получается — проверьте логин и пароль. Помните: Telnet передаёт их без шифрования.');
  }
  if (r.banner && /^SSH-/.test(r.banner)) {
    steps.push({ step: 'banner', ok: true, text: `Сервер представился: ${r.banner.trim().slice(0, 120)}` });
    return finish(steps, 'Порт доступен, SSH-сервер отвечает. Если подключение не удаётся — дело в авторизации, алгоритмах или блокировке после приветствия (fail2ban, лимиты).');
  }
  if (r.banner) {
    steps.push({ step: 'banner', ok: false, text: `Ответ не похож на SSH: «${r.banner.replace(/[^\x20-\x7e]/g, '.').slice(0, 80)}»` });
    return finish(steps, 'На порту работает другая служба. Проверьте номер порта SSH.');
  }
  steps.push({
    step: 'banner',
    ok: false,
    text: r.closedEarly ? 'Сервер закрыл соединение, не отправив приветствие SSH' : `Приветствие SSH не получено за ${timeoutMs / 1000} с`
  });
  return finish(
    steps,
    'TCP-соединение устанавливается, но SSH-сервер сразу разрывает его. Чаще всего ваш IP заблокирован (fail2ban, hosts.deny, firewall), SSH-сервер перегружен или соединение режет промежуточное оборудование/провайдер.'
  );
}

function finish(steps: ProbeStep[], conclusion: string): ProbeResult {
  return { steps, conclusion, ok: steps.every((s) => s.ok) };
}
