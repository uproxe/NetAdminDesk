// COM-порт / USB-консоль через Web Serial (встроен в Chromium, нативные модули не нужны).
// Порт открывается здесь, а сессия (журнал, «Только чтение», захват вывода) живёт в main-процессе:
// данные из порта отправляются туда, а ввод из терминала приходит обратно событием serial:write.
import { api } from '../api';

interface WebSerialPort {
  open(o: { baudRate: number; dataBits?: number; stopBits?: number; parity?: 'none' | 'even' | 'odd'; flowControl?: 'none' | 'hardware' }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface WebSerial {
  requestPort(o?: { filters?: unknown[] }): Promise<WebSerialPort>;
}
interface Entry {
  port: WebSerialPort;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  closing: boolean;
}

const ports = new Map<string, Entry>();
const enc = new TextEncoder();

function webSerial(): WebSerial | null {
  return (navigator as unknown as { serial?: WebSerial }).serial ?? null;
}

export function serialSupported(): boolean {
  return !!webSerial();
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function openPort(id: string, baudRate: number): Promise<void> {
  const ser = webSerial();
  if (!ser) return void api.serial.opened(id, 'в этой сборке нет поддержки Web Serial');
  let port: WebSerialPort;
  try {
    // Выбор порта по имени из карточки устройства делает main-процесс (select-serial-port).
    port = await ser.requestPort({});
  } catch (e) {
    return void api.serial.opened(id, (e as Error).name === 'NotFoundError' ? 'not-found' : msg(e));
  }
  try {
    await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  } catch (e) {
    return void api.serial.opened(id, msg(e));
  }
  if (!port.writable) return void api.serial.opened(id, 'порт открыт только для чтения');
  const entry: Entry = { port, writer: port.writable.getWriter(), reader: null, closing: false };
  ports.set(id, entry);
  await api.serial.opened(id);
  void readLoop(id, entry);
}

async function readLoop(id: string, entry: Entry): Promise<void> {
  const dec = new TextDecoder();
  let reason = '';
  try {
    // Ошибки кадра/чётности/переполнения не фатальны: читатель пересоздаётся, пока порт readable.
    while (entry.port.readable && !entry.closing) {
      const reader = entry.port.readable.getReader();
      entry.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.length) void api.serial.feed(id, dec.decode(value, { stream: true }));
        }
      } catch (e) {
        reason = msg(e);
      } finally {
        reader.releaseLock();
      }
    }
  } finally {
    ports.delete(id);
    try {
      await entry.writer.close();
    } catch {
      /* уже закрыт */
    }
    try {
      await entry.port.close();
    } catch {
      /* уже закрыт */
    }
    if (!entry.closing) void api.serial.closed(id, reason ? `Порт закрыт: ${reason}` : 'Порт закрыт: кабель или USB-переходник отключён');
  }
}

function writePort(id: string, data: string): void {
  const e = ports.get(id);
  if (e) void e.writer.write(enc.encode(data)).catch(() => undefined);
}

function closePort(id: string): void {
  const e = ports.get(id);
  if (!e) return;
  e.closing = true;
  void e.reader?.cancel().catch(() => undefined);
}

/** Список COM-портов, видимых программой (для карточки устройства). */
export async function listSerialPorts(): Promise<{ portName: string; displayName?: string }[]> {
  const ser = webSerial();
  if (!ser) return [];
  await api.serial.listBegin();
  try {
    await ser.requestPort({});
  } catch {
    /* в режиме списка выбор всегда отменяется */
  }
  return api.serial.listEnd();
}

let installed = false;
/** Подписка на команды main-процесса: открыть порт, записать данные, закрыть. */
export function installSerialRuntime(): void {
  if (installed) return;
  installed = true;
  api.on((e) => {
    if (e.type === 'serial:open') void openPort(e.id, e.baudRate);
    else if (e.type === 'serial:write') writePort(e.id, e.data);
    else if (e.type === 'serial:close') closePort(e.id);
  });
}
