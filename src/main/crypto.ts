// Криптография: AES-256-GCM и вывод ключа scrypt.
// Используется для мастер-пароля хранилища секретов и для зашифрованного переноса данных между ОС.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export interface KdfParams {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
}

export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

export const DEFAULT_KDF = { N: 1 << 15, r: 8, p: 1 };

export function newKdf(): KdfParams {
  return { name: 'scrypt', ...DEFAULT_KDF, salt: randomBytes(16).toString('base64') };
}

export function deriveKey(password: string, kdf: KdfParams): Buffer {
  if (kdf.name !== 'scrypt') throw new Error(`Неподдерживаемый KDF: ${kdf.name}`);
  return scryptSync(password.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 256 * 1024 * 1024
  });
}

export function seal(key: Buffer, plaintext: Buffer | string, aad?: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function open(key: Buffer, s: Sealed, aad?: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ---------- Зашифрованный пакет переноса данных ----------

export const BUNDLE_FORMAT = 'netadmin-desk-export';
export const BUNDLE_VERSION = 1;

export interface EncryptedBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  kdf: KdfParams;
  cipher: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

export function encryptBundle(payload: unknown, password: string, meta: { schemaVersion: number; appVersion: string }): EncryptedBundle {
  if (!password || password.length < 8) throw new Error('Пароль для экспорта должен быть не короче 8 символов');
  const kdf = newKdf();
  const key = deriveKey(password, kdf);
  const sealed = seal(key, JSON.stringify(payload), BUNDLE_FORMAT);
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    schemaVersion: meta.schemaVersion,
    appVersion: meta.appVersion,
    createdAt: new Date().toISOString(),
    kdf,
    cipher: 'aes-256-gcm',
    ...sealed
  };
}

export function decryptBundle<T = unknown>(bundle: EncryptedBundle, password: string): T {
  if (bundle?.format !== BUNDLE_FORMAT) throw new Error('Файл не является зашифрованной копией NetAdmin Desk');
  if (bundle.version > BUNDLE_VERSION) throw new Error(`Файл создан более новой версией формата (${bundle.version})`);
  const key = deriveKey(password, bundle.kdf);
  try {
    return JSON.parse(open(key, bundle, BUNDLE_FORMAT).toString('utf8')) as T;
  } catch {
    throw new Error('Неверный пароль или файл повреждён');
  }
}
