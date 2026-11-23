// Менеджер паролей в режиме предпросмотра: записи в памяти, без настоящего шифрования.
// Демонстрационные данные — вымышленные адреса из документационных диапазонов и заведомо
// ненастоящие пароли. Мастер-пароль предпросмотра — любой непустой (для снимков экрана).
import type { NadApi, NadEvent } from '../../src/shared/ipc';
import {
  DEFAULT_PM,
  duplicateKey,
  estimateStrength,
  mapCsvRows,
  parseCsv,
  type PmEntryData,
  type PmEntrySummary,
  type PmGroup,
  type PmImportPreview,
  type PmImportRow,
  type PmStatus
} from '../../src/shared/passwords';

export const MOCK_PM_SETTINGS = DEFAULT_PM;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

export function createPasswordsMock(emit: (e: NadEvent) => void, opts: { configured?: boolean; unlocked?: boolean } = {}): NadApi['passwords'] {
  let configured = opts.configured ?? true;
  let unlocked = opts.unlocked ?? false;
  let lockedReason: PmStatus['lockedReason'] = 'startup';
  let nextId = 1;
  const groups = new Map<string, string>();
  const entries = new Map<string, PmEntryData>();
  const g = (name: string) => {
    const id = `g${nextId++}`;
    groups.set(id, name);
    return id;
  };
  const e = (data: Partial<PmEntryData> & { title: string }) => {
    const id = `e${nextId++}`;
    entries.set(id, { username: '', password: '', url: '', notes: '', groupId: null, favorite: false, tags: [], history: [], createdAt: iso(200), updatedAt: iso(20), passwordChangedAt: iso(120), ...data });
    return id;
  };
  const sw = g('Коммутаторы');
  const srv = g('Серверы');
  const cam = g('Видеонаблюдение');
  const svc = g('Сервисы');
  e({ title: 'SW-CORE-1', username: 'admin', password: 'Demo-Core#4417-x', url: 'ssh://192.0.2.1', groupId: sw, favorite: true, notes: 'Серверная, стойка 2, юнит 14.\nenable — тот же пароль.', tags: ['ядро'], history: [{ password: 'Old-Core-Pass-1', changedAt: iso(120) }] });
  e({ title: 'SW-ACCESS-1…4', username: 'admin', password: 'Demo-Access!2026', url: '192.0.2.11–14', groupId: sw, notes: 'Все коммутаторы доступа 2-го этажа.' });
  e({ title: 'OSNOVO SW-ACCESS-3', username: 'admin', password: 'admin123', url: 'http://192.0.2.13', groupId: sw, notes: 'Пароль по умолчанию — сменить!' });
  e({ title: 'UserGate NGFW', username: 'Admin', password: 'Demo-NGFW_9c2e!Lq', url: 'https://192.0.2.254:8001', groupId: srv, favorite: true, notes: 'CLI: ssh Admin@192.0.2.254 -p 2200' });
  e({ title: 'Файловый сервер', username: 'root', password: 'Demo-Files$7h3K', url: 'ssh://192.0.2.21', groupId: srv });
  e({ title: 'Видеосервер 1', username: 'operator', password: 'Video-Demo-1', url: 'http://192.0.2.51', groupId: cam });
  e({ title: 'Видеосервер 2', username: 'operator', password: 'Video-Demo-1', url: 'http://192.0.2.52', groupId: cam, notes: 'Пароль совпадает с видеосервером 1.' });
  e({ title: 'Камеры (общий)', username: 'admin', password: 'admin123', url: '198.51.100.11–16', groupId: cam });
  e({ title: 'Почта отдела', username: 'it@example.org', password: 'Mail-Demo-Pass-88', url: 'https://mail.example.org', groupId: svc });
  e({ title: 'Wi-Fi гостевой', username: '', password: 'Guest-Demo-2026', notes: 'SSID: Guest-Demo', groupId: svc });
  e({ title: 'Портал поставщика', username: 'ivanov', password: 'p4ss', url: 'https://portal.example.com' });

  const summaries = (): PmEntrySummary[] => {
    const uses = new Map<string, number>();
    for (const x of entries.values()) if (x.password) uses.set(x.password, (uses.get(x.password) ?? 0) + 1);
    return [...entries].map(([id, x]) => {
      const st = estimateStrength(x.password);
      return { id, title: x.title, username: x.username, url: x.url, groupId: x.groupId, favorite: x.favorite, tags: x.tags, hasPassword: !!x.password, hasNotes: !!x.notes, createdAt: x.createdAt, updatedAt: x.updatedAt, passwordChangedAt: x.passwordChangedAt, strength: st.bits, weak: !!x.password && st.level <= 1, reused: (uses.get(x.password) ?? 0) > 1, historyCount: x.history.length };
    });
  };
  const need = () => {
    if (!unlocked) throw new Error('Менеджер паролей заблокирован. Введите мастер-пароль.');
  };
  const get = (id: string) => {
    const x = entries.get(id);
    if (!x) throw new Error('Запись не найдена');
    return x;
  };
  const pending = new Map<string, PmImportRow[]>();
  const status = async (): Promise<PmStatus> => ({ configured, unlocked, entryCount: entries.size, lockedReason, retryAfterSec: 0 });
  return {
    status,
    setup: async (pw) => {
      if (pw.length < 8) throw new Error('Мастер-пароль должен быть не короче 8 символов');
      configured = true;
      unlocked = true;
      return status();
    },
    unlock: async (pw) => {
      if (!pw) throw new Error('Неверный мастер-пароль');
      unlocked = true;
      return status();
    },
    lock: async () => {
      unlocked = false;
      lockedReason = 'manual';
      emit({ type: 'pm:locked', reason: 'manual' });
    },
    changeMaster: async () => undefined,
    reset: async (word) => {
      if (word !== 'УДАЛИТЬ') throw new Error('Для удаления введите слово УДАЛИТЬ');
      entries.clear();
      groups.clear();
      configured = false;
      unlocked = false;
    },
    touch: async () => undefined,
    list: async () => {
      need();
      const all = summaries();
      const gl: PmGroup[] = [...groups].map(([id, name]) => ({ id, name, count: all.filter((x) => x.groupId === id).length }));
      return { groups: gl.sort((a, b) => a.name.localeCompare(b.name, 'ru')), entries: all.sort((a, b) => a.title.localeCompare(b.title, 'ru')) };
    },
    get: async (id) => {
      need();
      const x = get(id);
      return { ...summaries().find((s) => s.id === id)!, notes: x.notes, history: x.history.map((h) => ({ changedAt: h.changedAt })) };
    },
    reveal: async (id, hi) => {
      need();
      const x = get(id);
      return hi === undefined || hi === null ? x.password : x.history[hi]?.password ?? '';
    },
    save: async (input) => {
      need();
      const id = input.id ?? `e${nextId++}`;
      const prev = input.id ? get(id) : null;
      const now = new Date().toISOString();
      const changed = input.password !== undefined && input.password !== (prev?.password ?? '');
      entries.set(id, {
        title: input.title.trim(),
        username: input.username,
        password: input.password ?? prev?.password ?? '',
        url: input.url,
        notes: input.notes,
        groupId: input.groupId,
        favorite: input.favorite,
        tags: input.tags,
        history: changed && prev?.password ? [{ password: prev.password, changedAt: now }, ...prev.history] : prev?.history ?? [],
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        passwordChangedAt: changed ? now : prev?.passwordChangedAt ?? now
      });
      return summaries().find((s) => s.id === id)!;
    },
    remove: async (id) => void entries.delete(id),
    saveGroup: async ({ id, name }) => {
      const gid = id ?? `g${nextId++}`;
      groups.set(gid, name.trim());
      return { id: gid, name: name.trim(), count: 0 };
    },
    removeGroup: async (id) => {
      groups.delete(id);
      for (const x of entries.values()) if (x.groupId === id) x.groupId = null;
    },
    copy: async (id, field, hi) => {
      need();
      const x = get(id);
      const v = field === 'password' ? (hi === undefined ? x.password : x.history[hi]?.password ?? '') : field === 'username' ? x.username : x.url;
      await navigator.clipboard?.writeText(v).catch(() => undefined);
      return { clearAfterSec: field === 'password' ? DEFAULT_PM.clipboardClearSec : 0 };
    },
    copyValue: async (v) => {
      await navigator.clipboard?.writeText(v).catch(() => undefined);
      return { clearAfterSec: DEFAULT_PM.clipboardClearSec };
    },
    exportFile: async () => ({ count: entries.size }),
    importOpen: async (): Promise<PmImportPreview> => {
      // В предпросмотре файл не читается — показываем пример выгрузки KeePassXC
      const csv = '"Group","Title","Username","Password","URL","Notes","TOTP"\n"Root/Сеть","SW-DIST-1","admin","demo-1","ssh://192.0.2.2","",""\n"Root/Сеть","SW-CORE-1","admin","demo-2","ssh://192.0.2.1","",""\n"Root/Почта","Почта отдела","it@example.org","demo-3","https://mail.example.org","",""\n';
      const { rows, source } = mapCsvRows(parseCsv(csv));
      const token = `t${nextId++}`;
      pending.set(token, rows);
      const existing = new Set([...entries.values()].map(duplicateKey));
      return { token, file: 'keepassxc-export.csv', kind: 'csv', needsPassword: false, source, rows: rows.map((r, index) => ({ index, title: r.title, username: r.username, url: r.url, group: r.group, hasPassword: !!r.password, hasNotes: !!r.notes, duplicate: existing.has(duplicateKey(r)) })), groups: [...new Set(rows.map((r) => r.group))] };
    },
    importDecrypt: async () => {
      throw new Error('Неверный пароль файла или файл повреждён');
    },
    importCommit: async (token, o) => {
      const rows = pending.get(token) ?? [];
      o.indexes.forEach((i) => e({ ...rows[i], groupId: o.groupMode === 'target' ? o.targetGroupId : null }));
      pending.delete(token);
      return { added: o.indexes.length, skipped: rows.length - o.indexes.length, groupsCreated: 0 };
    },
    importCancel: async (token) => void pending.delete(token)
  };
}
