// Управление SSH-сессиями: подключение по сохранённым параметрам, проверка ключей хостов,
// запрос паролей, журнал команд (без секретов), режим «Только чтение».
import { EventEmitter } from 'node:events';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database';
import { Vault, VaultLockedError, type SecretKind } from '../vault';
import { SshSession, type ConnectTarget, type HostKeyInfo, type CaptureOptions } from './session';
import type { ShellSession } from './shell';
import { TelnetSession } from './telnet';
import { SerialSession, type SerialBridge } from './serial';
import type { CaptureResult, Device, ExecResult, HistorySource, HostKeyPrompt, KbdPrompt, RiskLevel, SessionInfo } from '../../shared/types';
import { classifyCommand, maskSecrets } from '../../shared/risk';
import { getPlatform } from '../../shared/platforms';
import { stripAnsi } from '../../shared/terminalText';
import { isOpenSshKeyEncrypted } from './keys';

export { isOpenSshKeyEncrypted };

export interface CredentialPrompt {
  requestId: string;
  deviceName: string;
  kind: SecretKind | 'vaultUnlock';
  message: string;
}

export interface PromptBridge {
  hostKey(p: HostKeyPrompt): Promise<'accept' | 'reject' | 'replace'>;
  kbd(p: KbdPrompt): Promise<string[] | null>;
  credentials(p: CredentialPrompt): Promise<string | null>;
}

export interface CommandMeta {
  source: HistorySource;
  risk?: RiskLevel;
  note?: string;
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, { session: ShellSession; device: Device }>();

  constructor(
    private db: AppDatabase,
    private vault: Vault,
    private bridge: PromptBridge,
    private opts: { sessionLogDir?: string; serialBridge?: SerialBridge } = {}
  ) {
    super();
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.session.info);
  }

  get(id: string): { session: ShellSession; device: Device } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Сессия не найдена или закрыта');
    return s;
  }

  private async readSecret(device: Device, kind: SecretKind): Promise<string | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return this.vault.read(device.id, kind);
      } catch (e) {
        if (!(e instanceof VaultLockedError)) throw e;
        const pw = await this.bridge.credentials({
          requestId: randomUUID(),
          deviceName: device.name,
          kind: 'vaultUnlock',
          message: 'Введите мастер-пароль хранилища, чтобы использовать сохранённые пароли.'
        });
        if (pw === null) return undefined;
        if (!this.vault.unlock(pw)) continue;
      }
    }
    return undefined;
  }

  private async askSecret(device: Device, kind: SecretKind, message: string): Promise<string | undefined> {
    const v = await this.bridge.credentials({ requestId: randomUUID(), deviceName: device.name, kind, message });
    return v ?? undefined;
  }

  private async buildTarget(device: Device, askIfMissing: boolean): Promise<ConnectTarget> {
    const known = this.db.getKnownHost(device.host, device.port);
    const t: ConnectTarget = {
      deviceId: device.id,
      deviceName: device.name,
      host: device.host,
      port: device.port,
      username: device.username,
      authMethod: device.authMethod,
      legacyAlgorithms: device.legacyAlgorithms,
      keepaliveSec: device.keepaliveSec,
      timeoutSec: device.timeoutSec,
      platform: device.platform,
      knownKeyType: known?.keyType,
      // Пока пользователь читает отпечаток ключа или отвечает на запрос, рукопожатие не должно прерываться
      extraReadyMs: (known ? 0 : 180000) + (device.authMethod === 'keyboard-interactive' ? 180000 : 0)
    };
    if (!device.username) throw new Error(`Для устройства «${device.name}» не указан логин`);
    if (device.authMethod === 'password' || device.authMethod === 'keyboard-interactive') {
      t.password = await this.readSecret(device, 'password');
      if (!t.password && askIfMissing && device.authMethod === 'password') {
        t.password = await this.askSecret(device, 'password', `Пароль пользователя ${device.username}@${device.host}`);
        if (!t.password) throw new Error('Подключение отменено: пароль не введён');
      }
    }
    if (device.authMethod === 'key') {
      if (!device.keyPath) throw new Error('Не указан путь к приватному ключу');
      const path = device.keyPath.replace(/^~(?=$|[\\/])/, homedir());
      try {
        t.privateKey = readFileSync(path);
      } catch (e) {
        throw new Error(`Не удалось прочитать ключ ${path}: ${(e as Error).message}`);
      }
      t.passphrase = await this.readSecret(device, 'keyPassphrase');
      const text = t.privateKey.toString('utf8');
      const encrypted = /ENCRYPTED/.test(text) || (/BEGIN OPENSSH PRIVATE KEY/.test(text) && isOpenSshKeyEncrypted(text));
      if (encrypted && !t.passphrase && askIfMissing) {
        t.passphrase = await this.askSecret(device, 'keyPassphrase', `Парольная фраза ключа ${path}`);
        if (!t.passphrase) throw new Error('Подключение отменено: не введена парольная фраза ключа');
      }
    }
    return t;
  }

  private async verifyHostKey(info: HostKeyInfo): Promise<boolean> {
    const known = this.db.getKnownHost(info.host, info.port);
    if (known && known.fingerprint === info.fingerprint) {
      this.db.touchKnownHost(info.host, info.port);
      return true;
    }
    const prompt: HostKeyPrompt = {
      requestId: randomUUID(),
      deviceName: info.deviceName,
      host: info.host,
      port: info.port,
      keyType: info.keyType,
      fingerprint: info.fingerprint,
      knownFingerprint: known?.fingerprint,
      knownKeyType: known?.keyType,
      mismatch: !!known
    };
    const answer = await this.bridge.hostKey(prompt);
    if ((!known && answer === 'accept') || (known && answer === 'replace')) {
      this.db.saveKnownHost(info.host, info.port, info.keyType, info.fingerprint, info.keyB64);
      this.db.addHistory({
        deviceId: null,
        deviceName: info.deviceName,
        command: known ? `[ключ хоста заменён] ${known.fingerprint} → ${info.fingerprint}` : `[ключ хоста принят] ${info.keyType} ${info.fingerprint}`,
        source: 'reference',
        risk: known ? 'danger' : 'info',
        result: 'done',
        note: `${info.host}:${info.port}`
      });
      return true;
    }
    return false;
  }

  /** Сессия по протоколу из карточки устройства: SSH (по умолчанию), Telnet или COM-порт. */
  private async createSession(device: Device): Promise<{ session: ShellSession; extra?: unknown }> {
    const base = { deviceId: device.id, deviceName: device.name, host: device.host, platform: device.platform };
    if (device.protocol === 'telnet') {
      // Пароль берётся только из хранилища; если его нет — пользователь вводит его сам в терминале.
      const password = device.authMethod === 'password' ? await this.readSecret(device, 'password') : undefined;
      return { session: new TelnetSession({ ...base, port: device.port || 23, username: device.username, password, timeoutSec: device.timeoutSec, keepaliveSec: device.keepaliveSec }) };
    }
    if (device.protocol === 'serial') {
      if (!this.opts.serialBridge) throw new Error('COM-порт недоступен в этом режиме запуска');
      return { session: new SerialSession({ ...base, portName: device.host, baudRate: device.serialBaud || 9600 }, this.opts.serialBridge) };
    }
    const target = await this.buildTarget(device, true);
    let jumpTarget: ConnectTarget | undefined;
    if (device.jumpDeviceId) {
      const jd = this.db.getDevice(device.jumpDeviceId);
      if (!jd) throw new Error('Промежуточный сервер (Jump Host) не найден');
      jumpTarget = await this.buildTarget(jd, true);
    }
    const session = new SshSession(target, {
      verifyHostKey: (i) => this.verifyHostKey(i),
      keyboardInteractive: (req) => this.bridge.kbd({ requestId: randomUUID(), ...req })
    });
    return { session, extra: jumpTarget };
  }

  async connect(deviceId: number, size: { cols: number; rows: number }): Promise<SessionInfo> {
    const device = this.db.getDevice(deviceId);
    if (!device) throw new Error('Устройство не найдено');
    const { session, extra } = await this.createSession(device);
    this.sessions.set(session.id, { session, device });
    const settings = this.db.getSettings();
    const logFile = settings.saveSessionLogs && this.opts.sessionLogDir ? this.sessionLogPath(device) : null;
    session.on('data', (chunk: string) => {
      this.emit('data', session.id, chunk);
      if (logFile) {
        try {
          appendFileSync(logFile, stripAnsi(chunk));
        } catch {
          /* журнал необязателен */
        }
      }
    });
    session.on('status', (info: SessionInfo) => this.emit('status', info));
    session.on('typed', ({ line, uncertain }: { line: string; uncertain: boolean }) => {
      if (!this.db.getSettings().logTypedCommands) return;
      const kind = device.platform === 'linux' ? 'linux' : 'switch';
      this.db.addHistory({
        deviceId: device.id,
        deviceName: device.name,
        command: maskSecrets(line),
        source: 'typed',
        risk: classifyCommand(line, kind).level,
        result: 'sent',
        note: uncertain ? 'введено вручную; строка могла быть изменена автодополнением или историей CLI' : 'введено вручную'
      });
    });
    session.on('closed', () => {
      this.sessions.delete(session.id);
      this.emit('closed', session.id);
    });
    try {
      await session.connect(size, extra);
    } catch (e) {
      this.sessions.delete(session.id);
      try {
        session.close();
      } catch {
        /* соединение уже закрыто */
      }
      this.db.markDeviceStatus(device.id, 'error', (e as Error).message.split('\n')[0]);
      this.emit('status', { ...session.info, status: 'error', error: (e as Error).message });
      throw e;
    }
    this.db.markDeviceStatus(device.id, 'ok');
    // Действия после входа выполняются видимо в терминале
    void this.postConnect(session, device);
    return session.info;
  }

  private async postConnect(session: ShellSession, device: Device): Promise<void> {
    try {
      if (device.autoEnable && device.platform !== 'linux') {
        const secret = await this.readSecret(device, 'enablePassword');
        if (secret) await session.autoEnable(secret);
      }
      if (device.disablePagerOnConnect) {
        const p = getPlatform(device.platform);
        if (p.pagerOff.length) {
          await session.waitQuiet(500, 3000);
          await session.sendLines(p.pagerOff);
        }
      }
      // Команды после входа из карточки устройства: видны в терминале, проходят проверку «Только чтение».
      const login = (device.loginCommands ?? '').trim();
      if (login) {
        await session.waitQuiet(500, 3000);
        await this.sendCommand(session.id, login, { source: 'reference', note: 'команды после входа (карточка устройства)' });
      }
    } catch {
      /* действия после входа не критичны */
    }
  }

  private sessionLogPath(device: Device): string {
    const dir = join(this.opts.sessionLogDir!, device.name.replace(/[^\w.\-а-яё]+/gi, '_'));
    mkdirSync(dir, { recursive: true });
    return join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.session.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.session.resize(cols, rows);
  }

  disconnect(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      s.session.close();
      this.sessions.delete(id);
    }
  }

  disconnectAll(): void {
    for (const id of [...this.sessions.keys()]) this.disconnect(id);
  }

  /** Проверка режима «Только чтение» (глобального и для устройства). */
  private guard(device: Device, command: string, meta: CommandMeta): RiskLevel {
    const kind = device.platform === 'linux' ? 'linux' : 'switch';
    const risk = meta.risk ?? classifyCommand(command, kind).level;
    const ro = this.db.getSettings().readOnlyMode || device.readOnly;
    if (ro && risk !== 'info') {
      this.db.addHistory({ deviceId: device.id, deviceName: device.name, command: maskSecrets(command), source: meta.source, risk, result: 'blocked', note: 'режим «Только чтение»' });
      throw new Error('Включён режим «Только чтение»: изменяющие команды не отправляются. Отключите режим в настройках или в карточке устройства.');
    }
    return risk;
  }

  async sendCommand(id: string, command: string, meta: CommandMeta): Promise<void> {
    const { session, device } = this.get(id);
    const risk = this.guard(device, command, meta);
    const lines = command
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => l.trim());
    await session.sendLines(lines);
    this.db.addHistory({ deviceId: device.id, deviceName: device.name, command: maskSecrets(command), source: meta.source, risk, result: 'sent', note: meta.note ?? '' });
  }

  /** Отправка enable-пароля в текущее приглашение (пароль не записывается в историю). */
  async sendEnablePassword(id: string): Promise<boolean> {
    const { session, device } = this.get(id);
    const secret = await this.readSecret(device, 'enablePassword');
    if (!secret) return false;
    session.writeRaw(`${secret}\r`);
    return true;
  }

  async capture(id: string, command: string, opts: CaptureOptions, meta: CommandMeta): Promise<CaptureResult> {
    const { session, device } = this.get(id);
    const risk = this.guard(device, command, meta);
    const r = await session.capture(command, opts);
    this.db.addHistory({
      deviceId: device.id,
      deviceName: device.name,
      command: maskSecrets(command),
      source: meta.source,
      risk,
      result: r.timedOut ? 'error' : 'done',
      note: r.timedOut ? 'превышено время ожидания вывода' : meta.note ?? ''
    });
    return r;
  }

  async exec(id: string, command: string, meta: CommandMeta, timeoutMs?: number): Promise<ExecResult> {
    const { session, device } = this.get(id);
    if (device.platform !== 'linux') throw new Error('SSH exec используется только для Linux-серверов. Для коммутаторов команды выполняются в терминале.');
    const risk = this.guard(device, command, meta);
    const r = await session.exec(command, timeoutMs);
    this.db.addHistory({ deviceId: device.id, deviceName: device.name, command: maskSecrets(command), source: meta.source, risk, result: 'done', note: meta.note ?? `код ${r.code}` });
    return r;
  }

  /** SSH-сессия (для SFTP и туннелей); для Telnet и COM-порта — понятная ошибка. */
  session(id: string): SshSession {
    const s = this.get(id).session;
    if (!(s instanceof SshSession)) throw new Error(`Эта функция работает только по SSH, а «${this.get(id).device.name}» подключён по ${s.protocol === 'telnet' ? 'Telnet' : 'COM-порту'}.`);
    return s;
  }

  /** Сессия консоли COM-порта (данные приходят из окна программы). */
  serial(id: string): SerialSession | undefined {
    const s = this.sessions.get(id)?.session;
    return s instanceof SerialSession ? s : undefined;
  }

  device(id: string): Device {
    return this.get(id).device;
  }
}
