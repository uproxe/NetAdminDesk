// Разбор адреса для быстрого подключения: admin@10.0.0.1, 10.0.0.1:2222, telnet://10.0.0.2, COM3, /dev/ttyUSB0.

export function parseQuickAddress(input: string): { protocol: 'ssh' | 'telnet' | 'serial'; host: string; port: number; username: string } | null {
  const v = input.trim();
  if (!v) return null;
  if (/^(com\d{1,3}|\/dev\/tty[\w.\-]+)$/i.test(v)) return { protocol: 'serial', host: /^com/i.test(v) ? v.toUpperCase() : v, port: 0, username: '' };
  const m = /^(?:(ssh|telnet):\/\/)?(?:([^@\s/]+)@)?(\[[0-9a-f:]+\]|[\w.\-]+)(?::(\d{1,5}))?$/i.exec(v);
  if (!m) return null;
  const protocol = (m[1]?.toLowerCase() as 'ssh' | 'telnet' | undefined) ?? 'ssh';
  const host = m[3].replace(/^\[|\]$/g, '');
  // Отдельное слово без точки — скорее поиск по названию устройства, а не адрес
  if (!m[1] && !m[2] && !m[4] && !/[.:]/.test(host)) return null;
  const port = m[4] ? Number(m[4]) : protocol === 'telnet' ? 23 : 22;
  if (port < 1 || port > 65535) return null;
  return { protocol, host, port, username: m[2] ?? '' };
}

