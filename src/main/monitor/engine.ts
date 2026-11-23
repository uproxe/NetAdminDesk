// Движок мониторинга: по расписанию проверяет узлы (ping, SNMP, TCP), принимает SNMP-трапы,
// ведёт журнал событий и сообщает о смене состояния: в интерфейс, уведомлением на рабочем столе и письмом.
import { spawn } from 'node:child_process';
import { hostname, networkInterfaces } from 'node:os';
import type { AppDatabase } from '../db/database';
import type { Vault } from '../vault';
import { tcpCheck, validHost } from '../tools';
import { SnmpClient, SnmpError, readPorts, type SnmpPort, type SnmpTarget } from './snmpClient';
import { TrapReceiver, type TrapEvent } from './trapReceiver';
import { sendMail, splitAddresses } from './mailer';
import { OID, TRAP, octetsToString, valueToString } from '../../shared/snmp';
import {
  applyCheck,
  composeAlertMail,
  initialState,
  parsePing,
  pingArgs,
  type CheckResult,
  type MailItem,
  type MonitorEvent,
  type MonitorEventLevel,
  type MonitorEventType,
  type MonitorNode,
  type MonitorSettings,
  type MonitorState,
  type MonitorStatus,
  type MonitorStatusInfo
} from '../../shared/monitor';

export type MonitorEmit =
  | { type: 'monitor:states'; states: MonitorState[] }
  | { type: 'monitor:event'; event: MonitorEvent }
  | { type: 'monitor:status'; status: MonitorStatusInfo };

export interface MonitorDeps {
  ping?: (host: string, timeoutMs: number) => Promise<{ ok: boolean; ms: number | null; text: string }>;
  tcp?: (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; ms: number; text: string }>;
  snmp?: SnmpClient;
  mail?: typeof sendMail;
  desktopNotify?: (title: string, body: string) => void;
  now?: () => number;
  /** Период внутреннего таймера (мс). */
  tickMs?: number;
}

export const communityKey = (nodeId: number) => `monitor:community:${nodeId}`;
export const MAIL_PASSWORD_KEY = 'monitor:smtp-password';
export const TRAP_COMMUNITY_KEY = 'monitor:trap-community';

/** Один ping через системную утилиту (ICMP требует прав администратора, системный ping их уже имеет). */
export function systemPing(host: string, timeoutMs: number): Promise<{ ok: boolean; ms: number | null; text: string }> {
  return new Promise((resolve) => {
    if (!validHost(host)) return resolve({ ok: false, ms: null, text: 'неверный адрес' });
    const p = spawn('ping', pingArgs(host, timeoutMs, process.platform), { windowsHide: true });
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.stderr.on('data', (d: Buffer) => chunks.push(d));
    const killer = setTimeout(() => p.kill(), timeoutMs + 3000);
    p.on('error', () => {
      clearTimeout(killer);
      resolve({ ok: false, ms: null, text: 'утилита ping не найдена' });
    });
    p.on('close', (code) => {
      clearTimeout(killer);
      const out = new TextDecoder(process.platform === 'win32' ? 'ibm866' : 'utf-8').decode(Buffer.concat(chunks));
      resolve(parsePing(out, code, process.platform));
    });
  });
}

async function tcpOnce(host: string, port: number, timeoutMs: number) {
  const [r] = await tcpCheck(host, [port], timeoutMs);
  return { ok: r.ok, ms: r.ms, text: r.ok ? `TCP-порт ${port} открыт` : r.text.replace(/^\d+(\s\([^)]*\))?:\s*/, `TCP-порт ${port}: `) };
}

export class MonitorEngine {
  private states = new Map<number, MonitorState>();
  private nodes = new Map<number, MonitorNode>();
  private due = new Map<number, number>();
  private inflight = new Set<number>();
  private communities = new Map<number, string | null>();
  private timer: NodeJS.Timeout | null = null;
  private trap: TrapReceiver;
  private snmp: SnmpClient;
  private pendingStates = new Map<number, MonitorState>();
  private flushTimer: NodeJS.Timeout | null = null;
  private mailQueue: MailItem[] = [];
  private mailTimer: NodeJS.Timeout | null = null;
  private lastMailError = '';
  private desktopBurst: { title: string; body: string }[] = [];
  private desktopTimer: NodeJS.Timeout | null = null;
  private unknownTrapSeen = new Map<string, number>();
  private running = false;
  private deps: Required<Omit<MonitorDeps, 'desktopNotify'>> & Pick<MonitorDeps, 'desktopNotify'>;

  constructor(
    private db: AppDatabase,
    private vault: Vault,
    private emit: (e: MonitorEmit) => void,
    deps: MonitorDeps = {}
  ) {
    this.snmp = deps.snmp ?? new SnmpClient();
    this.deps = {
      ping: deps.ping ?? systemPing,
      tcp: deps.tcp ?? tcpOnce,
      snmp: this.snmp,
      mail: deps.mail ?? sendMail,
      desktopNotify: deps.desktopNotify,
      now: deps.now ?? Date.now,
      tickMs: deps.tickMs ?? 1000
    };
    this.trap = new TrapReceiver((e) => void this.onTrap(e));
  }

  private get settings(): MonitorSettings {
    return this.db.getSettings().monitor;
  }

  private iso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  // ---------- Жизненный цикл ----------

  async start(): Promise<void> {
    this.reloadNodes();
    await this.applySettings();
  }

  /** Применить настройки: включить/выключить опрос и приёмник трапов. */
  async applySettings(): Promise<void> {
    const s = this.settings;
    this.running = s.enabled;
    if (s.enabled && !this.timer) this.timer = setInterval(() => this.tick(), this.deps.tickMs);
    if (!s.enabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const want = s.trap.enabled;
    const cur = this.trap.options;
    if (!want) this.trap.stop();
    else if (!this.trap.listening || cur?.port !== s.trap.port || cur?.bind !== s.trap.bind || (cur?.community ?? '') !== (this.trapCommunity() ?? '')) {
      try {
        await this.trap.start({ port: s.trap.port, bind: s.trap.bind || '0.0.0.0', community: this.trapCommunity() });
        this.event(null, '', 'info', 'system', `приём SNMP-трапов включён: UDP ${s.trap.bind || '0.0.0.0'}:${s.trap.port}`);
      } catch (e) {
        this.event(null, '', 'warn', 'system', `не удалось включить приём трапов: ${(e as Error).message}`);
      }
    }
    this.pushStatus();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.trap.stop();
    this.snmp.close();
    for (const t of [this.flushTimer, this.mailTimer, this.desktopTimer]) if (t) clearTimeout(t);
    this.running = false;
  }

  /** Перечитать узлы после изменения (добавление, правка, удаление). */
  reloadNodes(): void {
    const list = this.db.listMonitorNodes();
    const now = this.deps.now();
    const ids = new Set(list.map((n) => n.id));
    for (const id of [...this.states.keys()]) if (!ids.has(id)) this.states.delete(id);
    this.communities.clear();
    this.nodes = new Map(list.map((n) => [n.id, n]));
    list.forEach((n, i) => {
      const prev = this.states.get(n.id);
      if (!prev) {
        this.states.set(n.id, initialState(n.id, n.enabled, this.iso()));
        // Первая проверка — сразу, но с небольшим разносом, чтобы не запускать сотни ping одновременно.
        this.due.set(n.id, now + Math.min(i * 50, 5000));
      } else if (!n.enabled && prev.status !== 'paused') this.states.set(n.id, { ...initialState(n.id, false, this.iso()), sysName: prev.sysName });
      else if (n.enabled && prev.status === 'paused') {
        this.states.set(n.id, initialState(n.id, true, this.iso()));
        this.due.set(n.id, now);
      }
    });
    this.emit({ type: 'monitor:states', states: this.listStates() });
    this.pushStatus();
  }

  listStates(): MonitorState[] {
    return [...this.states.values()];
  }

  status(): MonitorStatusInfo {
    const s = this.settings;
    const counts: Record<MonitorStatus, number> = { up: 0, warn: 0, down: 0, unknown: 0, paused: 0 };
    for (const st of this.states.values()) counts[st.status]++;
    return {
      running: this.running,
      trap: { enabled: s.trap.enabled, listening: this.trap.listening, port: s.trap.port, bind: s.trap.bind, error: this.trap.lastError, received: this.trap.received, dropped: this.trap.dropped },
      counts,
      canStoreSecrets: this.vault.canStore(),
      emailPassword: this.vault.hasApp(MAIL_PASSWORD_KEY),
      trapCommunity: this.vault.hasApp(TRAP_COMMUNITY_KEY),
      mailQueue: this.mailQueue.length,
      lastMailError: this.lastMailError,
      localAddresses: Object.values(networkInterfaces())
        .flat()
        .filter((a): a is NonNullable<typeof a> => !!a && a.family === 'IPv4' && !a.internal)
        .map((a) => a.address)
    };
  }

  private pushStatus(): void {
    this.emit({ type: 'monitor:status', status: this.status() });
  }

  // ---------- Опрос ----------

  private tick(): void {
    const s = this.settings;
    const now = this.deps.now();
    for (const n of this.nodes.values()) {
      if (this.inflight.size >= Math.max(1, s.concurrency)) break;
      if (!n.enabled || this.inflight.has(n.id)) continue;
      if ((this.due.get(n.id) ?? 0) > now) continue;
      void this.runCheck(n);
    }
  }

  private community(n: MonitorNode): string | null {
    if (this.communities.has(n.id)) return this.communities.get(n.id)!;
    let c: string | null;
    try {
      c = this.vault.readApp(communityKey(n.id)) ?? null;
    } catch {
      // Хранилище заблокировано (режим мастер-пароля) — не запоминаем неудачу:
      // после разблокировки community прочитается при следующей проверке.
      return null;
    }
    this.communities.set(n.id, c);
    return c;
  }

  /** Сбросить кэш community: вызывается после разблокировки, блокировки и смены режима хранилища. */
  secretsChanged(): void {
    this.communities.clear();
    void this.applySettings();
  }

  private trapCommunity(): string | undefined {
    if (!this.settings.trap.checkCommunity) return undefined;
    try {
      return this.vault.readApp(TRAP_COMMUNITY_KEY) || undefined;
    } catch {
      return undefined;
    }
  }

  private target(n: MonitorNode, community: string): SnmpTarget {
    return { host: n.host, port: n.snmpPort || 161, community, version: n.snmpVersion, timeoutMs: this.settings.timeoutMs, retries: 1 };
  }

  /** Одна проверка узла. Не меняет состояние — только результат. */
  async probe(n: MonitorNode): Promise<CheckResult> {
    const timeout = this.settings.timeoutMs;
    if (n.method === 'tcp') {
      if (!n.tcpPort) return { reachable: false, latencyMs: null, message: 'не указан TCP-порт' };
      const r = await this.deps.tcp(n.host, n.tcpPort, timeout);
      if (r.ok) return { reachable: true, latencyMs: r.ms, message: r.text };
      // Порт не отвечает, но узел отвечает на ping — служба недоступна, сам узел в сети
      const p = await this.deps.ping(n.host, timeout);
      if (p.ok) return { reachable: true, latencyMs: p.ms, message: p.text, warn: `TCP-порт ${n.tcpPort}: ${r.text} — узел отвечает на ping, служба недоступна` };
      return { reachable: false, latencyMs: null, message: `TCP-порт ${n.tcpPort}: ${r.text}; ${p.text}` };
    }
    if (n.method === 'snmp') {
      const community = this.community(n);
      if (!community) {
        const p = await this.deps.ping(n.host, timeout);
        return { reachable: p.ok, latencyMs: p.ms, message: p.text, warn: p.ok ? 'SNMP не проверен: не задана community (или хранилище паролей заблокировано)' : undefined };
      }
      const t0 = this.deps.now();
      try {
        const first = !this.states.get(n.id)?.sysDescr;
        const vbs = await this.deps.snmp.get(this.target(n, community), first ? [OID.sysUpTime, OID.sysName, OID.sysDescr] : [OID.sysUpTime, OID.sysName]);
        const up = vbs.find((v) => v.oid === OID.sysUpTime);
        const nm = vbs.find((v) => v.oid === OID.sysName);
        const ds = vbs.find((v) => v.oid === OID.sysDescr);
        return {
          reachable: true,
          latencyMs: Math.max(0, this.deps.now() - t0),
          message: 'отвечает по SNMP',
          uptimeTicks: up?.value.type === 'ticks' ? up.value.value : undefined,
          sysName: nm?.value.type === 'str' ? octetsToString(nm.value.value) : undefined,
          sysDescr: ds ? valueToString(ds.value).slice(0, 300) : undefined
        };
      } catch (e) {
        const p = await this.deps.ping(n.host, timeout);
        const why = e instanceof SnmpError && e.kind === 'timeout' ? 'SNMP не отвечает: проверьте community, версию SNMP и разрешён ли опрос с этого компьютера' : `SNMP: ${(e as Error).message}`;
        if (p.ok) return { reachable: true, latencyMs: p.ms, message: p.text, warn: why };
        return { reachable: false, latencyMs: null, message: `${p.text}, SNMP не отвечает` };
      }
    }
    const p = await this.deps.ping(n.host, timeout);
    return { reachable: p.ok, latencyMs: p.ms, message: p.text };
  }

  private async runCheck(n: MonitorNode): Promise<MonitorState | undefined> {
    this.inflight.add(n.id);
    const interval = (n.intervalSec || this.settings.defaultIntervalSec) * 1000;
    try {
      const r = await this.probe(n);
      if (!this.nodes.has(n.id)) return undefined;
      const prev = this.states.get(n.id) ?? initialState(n.id, true, this.iso());
      const { state, changes } = applyCheck(prev, r, Math.max(1, this.settings.failThreshold), this.iso());
      this.states.set(n.id, state);
      for (const c of changes) this.event(n.id, n.name, c.level, c.type, c.message, n.host);
      this.queueState(state);
      // Пока узел «мигает» (первая неудача), перепроверяем быстрее, чтобы быстрее подтвердить проблему.
      const retry = state.failCount > 0 && state.status !== 'down' ? Math.min(interval, 5000) : interval;
      this.due.set(n.id, this.deps.now() + retry);
      return state;
    } catch (e) {
      this.due.set(n.id, this.deps.now() + interval);
      this.event(n.id, n.name, 'warn', 'system', `ошибка проверки: ${(e as Error).message}`);
      return undefined;
    } finally {
      this.inflight.delete(n.id);
    }
  }

  /** «Проверить сейчас» из интерфейса. */
  async checkNow(id: number): Promise<MonitorState | undefined> {
    const n = this.nodes.get(id);
    if (!n) throw new Error('Узел не найден');
    if (this.inflight.has(id)) return this.states.get(id);
    return this.runCheck(n);
  }

  /** Сбросить отметки о упавших портах (после разбора ситуации). */
  clearPorts(id: number): void {
    const st = this.states.get(id);
    if (!st) return;
    const next: MonitorState = { ...st, portsDown: [], status: st.status === 'warn' && !st.message.startsWith('SNMP') ? 'up' : st.status };
    this.states.set(id, next);
    this.queueState(next);
  }

  async ports(id: number): Promise<SnmpPort[]> {
    const n = this.nodes.get(id);
    if (!n) throw new Error('Узел не найден');
    const c = this.community(n);
    if (!c) throw new Error('Для узла не задана SNMP community (или хранилище паролей заблокировано)');
    try {
      return await readPorts(this.deps.snmp, { ...this.target(n, c), timeoutMs: Math.max(this.settings.timeoutMs, 2000) });
    } catch (e) {
      throw new Error(e instanceof SnmpError && e.kind === 'timeout' ? 'устройство не ответило по SNMP: проверьте адрес, community и версию SNMP' : (e as Error).message);
    }
  }

  private queueState(s: MonitorState): void {
    this.pendingStates.set(s.nodeId, s);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const states = [...this.pendingStates.values()];
      this.pendingStates.clear();
      this.emit({ type: 'monitor:states', states });
      this.pushStatus();
    }, 250);
  }

  // ---------- События и оповещения ----------

  private event(nodeId: number | null, nodeName: string, level: MonitorEventLevel, type: MonitorEventType, message: string, host = ''): void {
    let ev: MonitorEvent;
    try {
      ev = this.db.addMonitorEvent({ nodeId, nodeName, level, type, message, ts: this.iso() });
      if (ev.id % 500 === 0) this.db.pruneMonitorEvents();
    } catch {
      return;
    }
    this.emit({ type: 'monitor:event', event: ev });
    const s = this.settings;
    const notable = type === 'down' || (type === 'up' && s.notify.onRecovery) || type === 'reboot';
    if (notable && s.notify.desktop) this.desktop(type === 'down' ? `Не в сети: ${nodeName}` : type === 'up' ? `Снова в сети: ${nodeName}` : `${nodeName}: перезагрузка`, `${host ? `${host} — ` : ''}${message}`);
    if (s.email.enabled && (notable || (type === 'trap' && s.email.includeTraps))) this.queueMail({ ts: ev.ts, nodeName: nodeName || 'неизвестный узел', host, type, message });
  }

  private desktop(title: string, body: string): void {
    if (!this.deps.desktopNotify) return;
    this.desktopBurst.push({ title, body });
    if (this.desktopTimer) return;
    // Несколько событий подряд (например, упал коммутатор и всё за ним) — одним уведомлением.
    this.desktopTimer = setTimeout(() => {
      this.desktopTimer = null;
      const b = this.desktopBurst.splice(0);
      if (b.length <= 3) for (const x of b) this.deps.desktopNotify!(x.title, x.body);
      else this.deps.desktopNotify!(`Мониторинг: ${b.length} событий`, b.slice(0, 6).map((x) => x.title).join('\n') + (b.length > 6 ? '\n…' : ''));
    }, 1500);
  }

  private queueMail(item: MailItem): void {
    this.mailQueue.push(item);
    if (this.mailQueue.length > 500) this.mailQueue.splice(0, this.mailQueue.length - 500);
    if (!this.mailTimer) this.mailTimer = setTimeout(() => void this.flushMail(), Math.max(5, this.settings.email.delaySec) * 1000);
  }

  private mailConfig() {
    const e = this.settings.email;
    let password: string | undefined;
    if (e.user) {
      try {
        password = this.vault.readApp(MAIL_PASSWORD_KEY);
      } catch {
        throw new Error('хранилище паролей заблокировано — пароль почты недоступен');
      }
    }
    return { host: e.host, port: e.port, security: e.security, user: e.user || undefined, password, from: e.from, to: splitAddresses(e.to), allowInvalidCert: e.allowInvalidCert };
  }

  async flushMail(): Promise<void> {
    this.mailTimer = null;
    const items = this.mailQueue.splice(0);
    if (!items.length) return;
    try {
      const { subject, text } = composeAlertMail(items, this.status().counts, hostname());
      await this.deps.mail(this.mailConfig(), subject, text);
      this.lastMailError = '';
    } catch (e) {
      this.lastMailError = (e as Error).message;
      this.event(null, '', 'warn', 'mail', `не удалось отправить письмо (${items.length} событ.): ${this.lastMailError}`);
    }
    this.pushStatus();
  }

  async testMail(): Promise<void> {
    const cfg = this.mailConfig();
    await this.deps.mail(cfg, '[NetAdmin Desk] Проверка оповещений', `Это тестовое письмо мониторинга NetAdmin Desk.\r\nЕсли вы его получили, оповещения по почте настроены правильно.\r\n\r\nКомпьютер: ${hostname()}`);
    this.lastMailError = '';
    this.pushStatus();
  }

  // ---------- Трапы ----------

  private findNode(addr: string | undefined): MonitorNode | undefined {
    if (!addr) return undefined;
    for (const n of this.nodes.values()) if (n.host === addr) return n;
    return undefined;
  }

  private async onTrap(e: TrapEvent): Promise<void> {
    const t = e.trap;
    const node = this.findNode(e.source) ?? this.findNode(t.agentAddr);
    if (!node) {
      if (!this.settings.trap.logUnknown) return;
      const key = `${e.source}|${t.trapOid}`;
      const last = this.unknownTrapSeen.get(key) ?? 0;
      if (this.deps.now() - last < 60000) return; // не чаще раза в минуту от одного адреса
      this.unknownTrapSeen.set(key, this.deps.now());
      this.event(null, e.source, 'info', 'trap', `${t.name} — от адреса, которого нет в списке узлов`);
      return;
    }
    let label = t.ifLabel ?? '';
    if (t.ifIndex !== undefined && node.method === 'snmp') {
      // Уточняем имя и описание порта (например, «Gi1/0/5 — Камера 12»).
      const c = this.community(node);
      if (c) {
        try {
          const vbs = await this.deps.snmp.get({ ...this.target(node, c), retries: 0 }, [`${OID.ifName}.${t.ifIndex}`, `${OID.ifAlias}.${t.ifIndex}`, `${OID.ifDescr}.${t.ifIndex}`]);
          const val = (i: number) => (vbs[i]?.value.type === 'str' ? octetsToString(vbs[i].value.value as Uint8Array) : '');
          const name = val(0) || val(2) || label;
          const alias = val(1);
          label = alias ? `${name} (${alias})` : name;
        } catch {
          /* без уточнения */
        }
      }
    }
    const port = t.ifIndex !== undefined ? ` — порт ${label || `#${t.ifIndex}`}` : '';
    const st = this.states.get(node.id);
    if (st && t.ifIndex !== undefined && (t.trapOid === TRAP.linkDown || t.trapOid === TRAP.linkUp) && this.settings.trap.linkDownWarn) {
      const rest = st.portsDown.filter((p) => p.ifIndex !== t.ifIndex);
      const portsDown = t.trapOid === TRAP.linkDown ? [...rest, { ifIndex: t.ifIndex, label: label || `#${t.ifIndex}`, since: this.iso() }] : rest;
      const status: MonitorStatus = st.status === 'down' || st.status === 'paused' || st.status === 'unknown' ? st.status : portsDown.length || st.message.startsWith('SNMP') ? 'warn' : 'up';
      const next = { ...st, portsDown, status, since: status !== st.status ? this.iso() : st.since };
      this.states.set(node.id, next);
      this.queueState(next);
    }
    const level: MonitorEventLevel = t.trapOid === TRAP.linkDown ? 'warn' : t.trapOid === TRAP.linkUp ? 'ok' : t.trapOid === TRAP.coldStart || t.trapOid === TRAP.warmStart ? 'warn' : 'info';
    const type: MonitorEventType = t.trapOid === TRAP.coldStart || t.trapOid === TRAP.warmStart ? 'reboot' : 'trap';
    const extra = type === 'trap' && t.ifIndex === undefined && t.varbinds.length ? `: ${t.varbinds.slice(0, 3).map((v) => valueToString(v.value)).filter(Boolean).join('; ').slice(0, 200)}` : '';
    this.event(node.id, node.name, level, type, `трап: ${t.name}${port}${extra}`, node.host);
  }
}
