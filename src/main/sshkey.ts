// Создание SSH-ключа ed25519 в формате OpenSSH (как ssh-keygen -t ed25519).
// Без парольной фразы ключ кодируется здесь (формат openssh-key-v1); с фразой — средствами ssh2
// (bcrypt-pbkdf + aes256-ctr). Приватный ключ записывается только в файл и не передаётся в интерфейс.
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}
function str(v: Buffer | string): Buffer {
  const b = typeof v === 'string' ? Buffer.from(v, 'utf8') : v;
  return Buffer.concat([u32(b.length), b]);
}

export interface Ed25519Raw {
  seed: Buffer;
  pub: Buffer;
}

export function newEd25519(): Ed25519Raw {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return { pub: spki.subarray(spki.length - 32), seed: pkcs8.subarray(pkcs8.length - 32) };
}

export function publicBlob(pub: Buffer): Buffer {
  return Buffer.concat([str('ssh-ed25519'), str(pub)]);
}

export function publicLine(pub: Buffer, comment: string): string {
  return `ssh-ed25519 ${publicBlob(pub).toString('base64')}${comment ? ` ${comment}` : ''}`;
}

export function fingerprint(pub: Buffer): string {
  return `SHA256:${createHash('sha256').update(publicBlob(pub)).digest('base64').replace(/=+$/, '')}`;
}

/** Приватный ключ OpenSSH без шифрования (то же, что ssh-keygen с пустой парольной фразой). */
export function encodeOpenSshPrivate(k: Ed25519Raw, comment: string, checkint = randomBytes(4).readUInt32BE()): string {
  const pubBlob = publicBlob(k.pub);
  let priv = Buffer.concat([u32(checkint), u32(checkint), str('ssh-ed25519'), str(k.pub), str(Buffer.concat([k.seed, k.pub])), str(comment)]);
  const pad: number[] = [];
  for (let i = 1; (priv.length + pad.length) % 8 !== 0; i++) pad.push(i);
  priv = Buffer.concat([priv, Buffer.from(pad)]);
  const body = Buffer.concat([Buffer.from('openssh-key-v1\0', 'binary'), str('none'), str('none'), str(''), u32(1), str(pubBlob), str(priv)]);
  const b64 = body.toString('base64').match(/.{1,70}/g)!.join('\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

export interface GeneratedKey {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

type Ssh2Utils = { generateKeyPairSync?: (type: string, opts: Record<string, unknown>) => { private: string; public: string }; parseKey?: (data: string | Buffer) => unknown };

export function generateEd25519(comment: string, passphrase?: string, ssh2Utils?: Ssh2Utils): GeneratedKey {
  if (passphrase) {
    if (!ssh2Utils?.generateKeyPairSync) throw new Error('Шифрование ключа парольной фразой недоступно в этой сборке. Создайте ключ без фразы или через ssh-keygen.');
    const r = ssh2Utils.generateKeyPairSync('ed25519', { comment, passphrase, cipher: 'aes256-ctr', rounds: 16 });
    const pubB64 = r.public.trim().split(/\s+/)[1] ?? '';
    const blob = Buffer.from(pubB64, 'base64');
    return { privateKey: r.private, publicKey: r.public.trim(), fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}` };
  }
  const k = newEd25519();
  return { privateKey: encodeOpenSshPrivate(k, comment), publicKey: publicLine(k.pub, comment), fingerprint: fingerprint(k.pub) };
}
