// Хранилище секретов (пароли устройств, парольные фразы ключей, enable-пароли).
// Режимы:
//  os     — шифрование системным хранилищем (Electron safeStorage: DPAPI / Keychain / libsecret/kwallet);
//  master — AES-256-GCM, ключ из мастер-пароля (scrypt) — для Linux без защищённого хранилища;
//  prompt — секреты не сохраняются, пароль запрашивается при каждом подключении.
// В SQLite попадают только зашифрованные значения.
import type { AppDatabase } from './db/database';
import type { DeviceSecretsState, VaultStatus, Settings } from '../shared/types';
import { deriveKey, newKdf, open, seal, type KdfParams, type Sealed } from './crypto';

export interface OsCrypto {
  isAvailable(): boolean;
  /** Имя backend (на Linux: gnome_libsecret, kwallet5, basic_text …). */
  backend(): string;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export type SecretKind = 'password' | 'keyPassphrase' | 'enablePassword';
export const SECRET_KINDS: SecretKind[] = ['password', 'keyPassphrase', 'enablePassword'];

export class VaultLockedError extends Error {
  constructor() {
    super('Хранилище паролей заблокировано. Введите мастер-пароль.');
    this.name = 'VaultLockedError';
  }
}

const CHECK_TEXT = 'netadmin-desk-vault-check';

export class Vault {
  private masterKey: Buffer | null = null;

  constructor(private db: AppDatabase, private os: OsCrypto | null) {}

  private get settings(): Settings {
    return this.db.getSettings();
  }

  osBackend(): string {
    try {
      return this.os?.backend() ?? 'none';
    } catch {
      return 'unknown';
    }
  }

  osAvailable(): boolean {
    try {
      return !!this.os && this.os.isAvailable();
    } catch {
      return false;
    }
  }

  /** Системное хранилище считается защищённым, если backend не «basic_text» (открытый ключ). */
  osSecure(): boolean {
    if (!this.osAvailable()) return false;
    const be = this.osBackend();
    return !['basic_text', 'unknown', 'none'].includes(be);
  }

  private masterMeta(): { kdf: KdfParams; check: Sealed } | null {
    const raw = this.db.getMeta('vault_master');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  status(): VaultStatus {
    return {
      mode: this.settings.vaultMode,
      osAvailable: this.osAvailable(),
      osBackend: this.osBackend(),
      osSecure: this.osSecure(),
      masterConfigured: !!this.masterMeta(),
      unlocked: !!this.masterKey
    };
  }

  /** При первом запуске на Windows/macOS (и Linux с keyring) выбирается системное хранилище. */
  autoInit(): void {
    if (this.settings.vaultMode === 'unset' && this.osSecure()) this.db.setSettings({ vaultMode: 'os' });
  }

  canStore(): boolean {
    const mode = this.settings.vaultMode;
    if (mode === 'os') return this.osSecure();
    if (mode === 'master') return !!this.masterKey;
    return false;
  }

  setupMaster(password: string): void {
    if (password.length < 8) throw new Error('Мастер-пароль должен быть не короче 8 символов');
    const plain = this.settings.vaultMode !== 'unset' ? this.readAll() : [];
    const kdf = newKdf();
    const key = deriveKey(password, kdf);
    this.db.setMeta('vault_master', JSON.stringify({ kdf, check: seal(key, CHECK_TEXT, 'vault-check') }));
    this.masterKey = key;
    this.db.setSettings({ vaultMode: 'master' });
    this.writeAll(plain);
  }

  unlock(password: string): boolean {
    const meta = this.masterMeta();
    if (!meta) throw new Error('Мастер-пароль не настроен');
    const key = deriveKey(password, meta.kdf);
    try {
      if (open(key, meta.check, 'vault-check').toString() !== CHECK_TEXT) return false;
    } catch {
      return false;
    }
    this.masterKey = key;
    return true;
  }

  lock(): void {
    this.masterKey = null;
  }

  changeMaster(oldPassword: string, newPassword: string): void {
    if (!this.unlock(oldPassword)) throw new Error('Неверный текущий мастер-пароль');
    this.setupMaster(newPassword);
  }

  /** Переключение режима с перешифрованием сохранённых секретов. */
  switchMode(mode: 'os' | 'prompt'): void {
    if (mode === 'os' && !this.osSecure()) throw new Error('Системное защищённое хранилище недоступно');
    const plain = this.readAll();
    this.db.setSettings({ vaultMode: mode });
    if (mode === 'prompt') {
      for (const r of this.db.listSecretRows()) this.db.deleteSecret(r.deviceId, r.kind);
      return;
    }
    this.writeAll(plain);
  }

  private encrypt(value: string): { scheme: string; blob: string } {
    const mode = this.settings.vaultMode;
    if (mode === 'os') {
      if (!this.osSecure() || !this.os) throw new Error('Системное хранилище недоступно');
      return { scheme: 'os', blob: this.os.encrypt(value).toString('base64') };
    }
    if (mode === 'master') {
      if (!this.masterKey) throw new VaultLockedError();
      return { scheme: 'master', blob: JSON.stringify(seal(this.masterKey, value, 'secret')) };
    }
    throw new Error('Сохранение паролей отключено (режим «запрашивать при подключении»)');
  }

  private decrypt(scheme: string, blob: string): string {
    if (scheme === 'os') {
      if (!this.os || !this.osAvailable()) throw new Error('Системное хранилище недоступно на этом компьютере');
      return this.os.decrypt(Buffer.from(blob, 'base64'));
    }
    if (scheme === 'master') {
      if (!this.masterKey) throw new VaultLockedError();
      return open(this.masterKey, JSON.parse(blob) as Sealed, 'secret').toString('utf8');
    }
    throw new Error(`Неизвестная схема шифрования: ${scheme}`);
  }

  store(deviceId: number, kind: SecretKind, value: string | null | undefined): void {
    if (value === undefined) return;
    if (value === null || value === '') {
      this.db.deleteSecret(deviceId, kind);
      return;
    }
    const { scheme, blob } = this.encrypt(value);
    this.db.setSecret(deviceId, kind, scheme, blob);
  }

  read(deviceId: number, kind: SecretKind): string | undefined {
    const row = this.db.getSecret(deviceId, kind);
    if (!row) return undefined;
    try {
      return this.decrypt(row.scheme, row.blob);
    } catch (e) {
      if (e instanceof VaultLockedError) throw e;
      throw new Error(
        `Не удалось расшифровать сохранённый секрет (${(e as Error).message}). Если база перенесена с другого компьютера, введите пароль заново или используйте зашифрованный перенос.`
      );
    }
  }

  state(deviceId: number): DeviceSecretsState {
    return {
      password: !!this.db.getSecret(deviceId, 'password'),
      keyPassphrase: !!this.db.getSecret(deviceId, 'keyPassphrase'),
      enablePassword: !!this.db.getSecret(deviceId, 'enablePassword')
    };
  }

  /** Все секреты в открытом виде (только для зашифрованного экспорта и смены режима). */
  readAll(): { deviceId: number; kind: SecretKind; value: string }[] {
    const out: { deviceId: number; kind: SecretKind; value: string }[] = [];
    for (const r of this.db.listSecretRows()) {
      try {
        out.push({ deviceId: r.deviceId, kind: r.kind as SecretKind, value: this.decrypt(r.scheme, r.blob) });
      } catch (e) {
        if (e instanceof VaultLockedError) throw e;
      }
    }
    return out;
  }

  writeAll(list: { deviceId: number; kind: SecretKind; value: string }[]): void {
    for (const s of list) this.store(s.deviceId, s.kind, s.value);
  }
}
