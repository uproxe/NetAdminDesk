// Вспомогательные функции для приватных ключей SSH (без зависимости от ssh2).

/** Проверка, зашифрован ли ключ нового формата OpenSSH (поле ciphername != none). */
export function isOpenSshKeyEncrypted(pem: string): boolean {
  try {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const buf = Buffer.from(b64, 'base64');
    const magic = 'openssh-key-v1\0';
    if (buf.subarray(0, magic.length).toString('latin1') !== magic) return false;
    const len = buf.readUInt32BE(magic.length);
    const cipher = buf.subarray(magic.length + 4, magic.length + 4 + len).toString('ascii');
    return cipher !== 'none';
  } catch {
    return false;
  }
}
