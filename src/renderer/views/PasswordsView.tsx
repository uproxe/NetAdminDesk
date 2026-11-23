// Менеджер паролей (по образцу KeePass): отдельный мастер-пароль, папки, записи с логином,
// паролем, адресом и заметками, генератор, проверка слабых и повторяющихся паролей,
// зашифрованный экспорт и импорт. Пароли приходят в интерфейс только по «Показать» или для
// редактирования; копирование идёт через main-процесс с очисткой буфера.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { errMsg } from '../lib/store';
import { closePmDialogs, pmActivity, usePmApp } from './pmSession';
import { Icon } from '../lib/icons';
import { askText, Banner, Button, Empty } from '../components/ui';
import { PM_MIN_MASTER, type PmEntryDetails, type PmEntrySummary, type PmGroup, type PmStatus } from '../../shared/passwords';
import { ChangeMasterDialog, EntryEditor, ExportDialog, GeneratorDialog, ImportDialog, PasswordInput, PmSettingsDialog, ResetDialog, StrengthMeter, ageText } from './PasswordsDialogs';

type Filter = { kind: 'all' } | { kind: 'fav' } | { kind: 'weak' } | { kind: 'reused' } | { kind: 'nogroup' } | { kind: 'group'; id: string };
type Sort = 'title' | 'updated';

const LOCK_REASONS: Record<string, string> = {
  idle: 'Менеджер заблокирован после периода без действий.',
  screen: 'Менеджер заблокирован при блокировке экрана или переходе в сон.',
  minimize: 'Менеджер заблокирован при сворачивании окна.',
  reset: 'Все записи удалены.'
};

let lastFilter: Filter = { kind: 'all' };

export function PasswordsView() {
  const app = usePmApp();
  const [status, setStatus] = useState<PmStatus | null>(null);
  const [data, setData] = useState<{ groups: PmGroup[]; entries: PmEntrySummary[] } | null>(null);
  const loadStatus = useCallback(async () => {
    const s = await api.passwords.status();
    setStatus(s);
    if (s.unlocked) setData(await api.passwords.list());
    else setData(null);
    return s;
  }, []);
  useEffect(() => {
    void loadStatus().catch((e) => app.toast(errMsg(e), 'error'));
    const off = api.on((e) => {
      if (e.type === 'pm:locked') {
        closePmDialogs();
        setData(null);
        void loadStatus();
      }
    });
    return () => {
      off();
      closePmDialogs();
    };
  }, [loadStatus]);

  // Активность в разделе продлевает время до автоблокировки (не чаще раза в 20 с)
  const touch = () => {
    if (status?.unlocked) pmActivity();
  };

  if (!status) return <div className="page" />;
  if (!status.configured) return <SetupScreen onDone={loadStatus} />;
  if (!status.unlocked || !data) return <UnlockScreen status={status} onDone={loadStatus} />;
  return (
    <div className="columns pm-page" onMouseDown={touch} onKeyDown={touch}>
      <Manager data={data} reload={async () => setData(await api.passwords.list())} onLocked={loadStatus} />
    </div>
  );
}

// ---------- Создание мастер-пароля ----------

function SetupScreen({ onDone }: { onDone: () => Promise<unknown> }) {
  const app = usePmApp();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ok = pw.length >= PM_MIN_MASTER && pw === pw2 && ack;
  const create = async () => {
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.passwords.setup(pw);
      setPw('');
      setPw2('');
      app.toast('Менеджер паролей создан', 'ok');
      await onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page pm-center">
      <div className="card pm-lock-card">
        <div className="pm-lock-icon">
          <Icon name="key" size={30} />
        </div>
        <h2>Менеджер паролей</h2>
        <p className="muted">
          Храните логины, пароли и заметки — как в KeePass. Все записи шифруются (AES-256-GCM) ключом из <b>мастер-пароля</b>, который знаете только вы. Он не связан с паролями устройств и не сохраняется в программе.
        </p>
        <PasswordInput label="Мастер-пароль" value={pw} onChange={setPw} autoFocus placeholder={`не короче ${PM_MIN_MASTER} символов`} />
        <StrengthMeter password={pw} />
        <PasswordInput label="Повторите мастер-пароль" value={pw2} onChange={setPw2} onEnter={create} error={mismatch ? 'Пароли не совпадают' : null} />
        <Banner kind="warn">
          Восстановить забытый мастер-пароль нельзя — ни программе, ни разработчику. Запишите его и храните в надёжном месте. Длинная фраза из нескольких слов надёжнее короткого сложного пароля.
        </Banner>
        <label className="check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>Понимаю: без мастер-пароля записи не открыть</span>
        </label>
        {error && <div className="pm-error">{error}</div>}
        <Button variant="primary" icon="lock" disabled={!ok || busy} onClick={create}>
          {busy ? 'Создаётся ключ…' : 'Создать хранилище'}
        </Button>
        <button className="linklike small" onClick={() => app.openGuide('pm-start')}>
          Как пользоваться менеджером паролей
        </button>
      </div>
    </div>
  );
}

// ---------- Разблокировка ----------

function UnlockScreen({ status, onDone }: { status: PmStatus; onDone: () => Promise<PmStatus> }) {
  const app = usePmApp();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(status.retryAfterSec);
  useEffect(() => setWait(status.retryAfterSec), [status.retryAfterSec]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const unlock = async () => {
    if (!pw || busy || wait > 0) return;
    setBusy(true);
    setError('');
    try {
      await api.passwords.unlock(pw);
      setPw('');
      await onDone();
    } catch (e) {
      setError(errMsg(e));
      setPw('');
      const s = await api.passwords.status();
      setWait(s.retryAfterSec);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => app.openDialog((close) => <ResetDialog onClose={close} onDone={() => void onDone()} />);
  return (
    <div className="page pm-center">
      <div className="card pm-lock-card">
        <div className="pm-lock-icon">
          <Icon name="lock" size={30} />
        </div>
        <h2>Менеджер паролей заблокирован</h2>
        <p className="muted">
          {LOCK_REASONS[status.lockedReason] ?? ''} В хранилище {status.entryCount} {plural(status.entryCount, 'запись', 'записи', 'записей')}.
        </p>
        <PasswordInput label="Мастер-пароль" value={pw} onChange={setPw} onEnter={unlock} autoFocus />
        {error && <div className="pm-error">{error}</div>}
        {wait > 0 && <div className="small muted">Следующая попытка через {wait} с</div>}
        <Button variant="primary" icon="unlock" disabled={!pw || busy || wait > 0} onClick={unlock}>
          {busy ? 'Проверка…' : 'Открыть'}
        </Button>
        <button className="linklike small" onClick={reset}>
          Забыли мастер-пароль?
        </button>
      </div>
    </div>
  );
}

// ---------- Открытый менеджер ----------

function Manager({ data, reload, onLocked }: { data: { groups: PmGroup[]; entries: PmEntrySummary[] }; reload: () => Promise<void>; onLocked: () => Promise<unknown> }) {
  const app = usePmApp();
  const [filter, setFilterState] = useState<Filter>(lastFilter);
  const setFilter = (f: Filter) => {
    lastFilter = f;
    setFilterState(f);
  };
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('title');
  const [selId, setSelId] = useState<string | null>(null);
  const { groups, entries } = data;
  const groupName = (id: string | null) => (id ? groups.find((g) => g.id === id)?.name ?? '' : '');

  useEffect(() => {
    if (filter.kind === 'group' && !groups.some((g) => g.id === filter.id)) setFilter({ kind: 'all' });
  }, [groups]);

  const counts = useMemo(
    () => ({
      all: entries.length,
      fav: entries.filter((e) => e.favorite).length,
      weak: entries.filter((e) => e.weak).length,
      reused: entries.filter((e) => e.reused).length,
      nogroup: entries.filter((e) => !e.groupId).length
    }),
    [entries]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries.filter((e) => {
      if (filter.kind === 'fav' && !e.favorite) return false;
      if (filter.kind === 'weak' && !e.weak) return false;
      if (filter.kind === 'reused' && !e.reused) return false;
      if (filter.kind === 'nogroup' && e.groupId) return false;
      if (filter.kind === 'group' && e.groupId !== filter.id) return false;
      if (!q) return true;
      return [e.title, e.username, e.url, groupName(e.groupId), ...e.tags].some((s) => s.toLowerCase().includes(q));
    });
    list = [...list].sort((a, b) => (sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title, 'ru')));
    return list;
  }, [entries, filter, query, sort, groups]);

  useEffect(() => {
    if (selId && !entries.some((e) => e.id === selId)) setSelId(null);
  }, [entries]);

  const defaultGroup = filter.kind === 'group' ? filter.id : null;
  const addEntry = () =>
    app.openDialog((close) => (
      <EntryEditor
        groups={groups}
        defaultGroupId={defaultGroup}
        onClose={close}
        onSaved={async (e) => {
          await reload();
          setSelId(e.id);
        }}
      />
    ));
  const addGroup = async () => {
    const name = await askName(app, 'Новая папка', '');
    if (!name) return;
    try {
      const g = await api.passwords.saveGroup({ name });
      await reload();
      setFilter({ kind: 'group', id: g.id });
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const lock = async () => {
    await api.passwords.lock();
    await onLocked();
  };

  const copyPassword = async (id: string) => {
    try {
      const r = await api.passwords.copy(id, 'password');
      app.toast(r.clearAfterSec ? `Пароль скопирован. Будет удалён из буфера через ${r.clearAfterSec} с` : 'Пароль скопирован', 'ok');
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };

  const sel = shown.find((e) => e.id === selId) ?? entries.find((e) => e.id === selId) ?? null;
  return (
    <>
      <div className="col col-filter">
        <div className="filter-group">
          <Button icon="lock" onClick={lock} className="pm-lock-btn" title="Заблокировать менеджер: потребуется мастер-пароль">
            Заблокировать
          </Button>
        </div>
        <div className="filter-group">
          <FilterItem label="Все записи" icon="key" n={counts.all} active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })} />
          <FilterItem label="Избранное" icon="star" n={counts.fav} active={filter.kind === 'fav'} onClick={() => setFilter({ kind: 'fav' })} />
          <FilterItem label="Слабые пароли" icon="alert" n={counts.weak} active={filter.kind === 'weak'} onClick={() => setFilter({ kind: 'weak' })} warn={counts.weak > 0} />
          <FilterItem label="Повторяются" icon="copy" n={counts.reused} active={filter.kind === 'reused'} onClick={() => setFilter({ kind: 'reused' })} warn={counts.reused > 0} />
        </div>
        <div className="filter-group">
          <div className="filter-title pm-groups-title">
            Папки
            <button className="pm-mini-btn" onClick={addGroup} title="Новая папка">
              <Icon name="plus" size={13} />
            </button>
          </div>
          {groups.map((g) => (
            <GroupItem key={g.id} g={g} active={filter.kind === 'group' && filter.id === g.id} onClick={() => setFilter({ kind: 'group', id: g.id })} reload={reload} />
          ))}
          <FilterItem label="Без папки" icon="folder" n={counts.nogroup} active={filter.kind === 'nogroup'} onClick={() => setFilter({ kind: 'nogroup' })} dim />
        </div>
        <div className="filter-group pm-tools">
          <div className="filter-title">Инструменты</div>
          <FilterItem label="Генератор паролей" icon="zap" onClick={() => app.openDialog((close) => <GeneratorDialog onClose={close} />)} />
          <FilterItem label="Импорт…" icon="download" onClick={() => app.openDialog((close) => <ImportDialog groups={groups} onClose={close} onDone={reload} />)} />
          <FilterItem label="Экспорт…" icon="upload" onClick={() => app.openDialog((close) => <ExportDialog count={entries.length} onClose={close} />)} />
          <FilterItem label="Сменить мастер-пароль" icon="shield" onClick={() => app.openDialog((close) => <ChangeMasterDialog onClose={close} />)} />
          <FilterItem label="Настройки" icon="settings" onClick={() => app.openDialog((close) => <PmSettingsDialog onClose={close} onReset={() => void onLocked()} />)} />
        </div>
      </div>
      <div className="col col-list">
        <div className="col-header">
          <input className="input grow pm-search" placeholder="Поиск: название, логин, адрес" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} title="Сортировка">
            <option value="title">А–Я</option>
            <option value="updated">Недавние</option>
          </select>
          <Button variant="primary" icon="plus" onClick={addEntry}>
            Добавить
          </Button>
        </div>
        <div className="col-body">
          {!entries.length ? (
            <Empty icon="key" title="Записей пока нет">
              Нажмите «Добавить» или импортируйте записи из KeePass, KeePassXC, Bitwarden, браузера (CSV) или файла .nadpass.
            </Empty>
          ) : !shown.length ? (
            <Empty icon="search" title="Ничего не найдено" />
          ) : (
            shown.map((e) => (
              <div key={e.id} className={`list-item pm-item ${selId === e.id ? 'active' : ''}`} onClick={() => setSelId(e.id)} onDoubleClick={() => void copyPassword(e.id)} title="Двойной щелчок — скопировать пароль">
                <div className="title">
                  {e.favorite && <Icon name="star" size={13} className="pm-star" />}
                  <span className="t">{e.title}</span>
                  {e.weak && <span className="badge warn">слабый</span>}
                  {e.reused && <span className="badge warn">повтор</span>}
                </div>
                <div className="pm-item-sub">
                  <span className="ellipsis">{e.username || <i className="faint">без логина</i>}</span>
                  {e.url && <span className="ellipsis faint">{shortUrl(e.url)}</span>}
                  {filter.kind !== 'group' && e.groupId && (
                    <span className="pm-group-chip">
                      <Icon name="folder" size={11} /> {groupName(e.groupId)}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="col col-detail">
        {sel ? (
          <EntryDetails key={sel.id} summary={sel} groups={groups} reload={reload} onDeleted={() => setSelId(null)} copyPassword={copyPassword} />
        ) : (
          <div className="pm-detail-empty">
            <Empty icon="lock" title="Выберите запись">
              Пароль не показывается, пока вы не нажмёте «Показать». Двойной щелчок по записи копирует пароль; через {app.settings.passwords.clipboardClearSec || '—'} с он будет удалён из буфера обмена.
            </Empty>
            <div className="small muted pm-autolock-note">
              {app.settings.passwords.autoLockMin > 0 ? `Автоблокировка через ${app.settings.passwords.autoLockMin} мин без действий.` : 'Автоблокировка выключена.'}{' '}
              <button className="linklike" onClick={() => app.openGuide('pm-start')}>
                Руководство
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FilterItem({ label, icon, n, active, onClick, warn, dim }: { label: string; icon: string; n?: number; active?: boolean; onClick: () => void; warn?: boolean; dim?: boolean }) {
  return (
    <button className={`filter-item ${active ? 'active' : ''} ${dim ? 'dim' : ''}`} onClick={onClick}>
      <Icon name={icon} size={14} />
      <span className="ellipsis">{label}</span>
      {n !== undefined && <span className={`n ${warn ? 'pm-warn-n' : ''}`}>{n}</span>}
    </button>
  );
}

function GroupItem({ g, active, onClick, reload }: { g: PmGroup; active: boolean; onClick: () => void; reload: () => Promise<void> }) {
  const app = usePmApp();
  const rename = async () => {
    const name = await askName(app, 'Переименовать папку', g.name);
    if (!name || name === g.name) return;
    try {
      await api.passwords.saveGroup({ id: g.id, name });
      await reload();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const remove = async () => {
    const ok = await app.confirm({
      title: `Удалить папку «${g.name}»?`,
      text: g.count ? `Записи из папки (${g.count}) не удалятся — они останутся без папки.` : 'Папка пуста.',
      okText: 'Удалить папку',
      danger: true
    });
    if (!ok) return;
    await api.passwords.removeGroup(g.id);
    await reload();
  };
  return (
    <div className={`pm-group-row ${active ? 'active' : ''}`}>
      <button className={`filter-item ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={rename} title="Двойной щелчок — переименовать">
        <Icon name="folder" size={14} />
        <span className="ellipsis">{g.name}</span>
        <span className="n">{g.count}</span>
      </button>
      <span className="pm-group-actions">
        <button className="pm-mini-btn" onClick={rename} title="Переименовать">
          <Icon name="edit" size={12} />
        </button>
        <button className="pm-mini-btn" onClick={remove} title="Удалить папку">
          <Icon name="trash" size={12} />
        </button>
      </span>
    </div>
  );
}

// ---------- Карточка записи ----------

function EntryDetails({ summary, groups, reload, onDeleted, copyPassword }: { summary: PmEntrySummary; groups: PmGroup[]; reload: () => Promise<void>; onDeleted: () => void; copyPassword: (id: string) => Promise<void> }) {
  const app = usePmApp();
  const [d, setD] = useState<PmEntryDetails | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [historyShown, setHistoryShown] = useState<Record<number, string>>({});
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    let alive = true;
    api.passwords
      .get(summary.id)
      .then((x) => alive && setD(x))
      .catch((e) => app.toast(errMsg(e), 'error'));
    return () => {
      alive = false;
    };
  }, [summary.id, summary.updatedAt]);
  // Показанный пароль скрывается сам через 30 секунд
  useEffect(() => {
    if (revealed === null) return;
    const t = setTimeout(() => setRevealed(null), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);
  if (!d) return null;
  const group = groups.find((g) => g.id === d.groupId);
  const copy = async (field: 'username' | 'url') => {
    await api.passwords.copy(d.id, field);
    app.toast(field === 'username' ? 'Логин скопирован' : 'Адрес скопирован', 'ok');
  };
  const reveal = async () => setRevealed(revealed === null ? await api.passwords.reveal(d.id) : null);
  const revealHistory = async (i: number) => {
    if (historyShown[i] !== undefined) {
      const { [i]: _x, ...rest } = historyShown;
      setHistoryShown(rest);
    } else setHistoryShown({ ...historyShown, [i]: await api.passwords.reveal(d.id, i) });
  };
  const copyHistory = async (i: number) => {
    const r = await api.passwords.copy(d.id, 'password', i);
    app.toast(r.clearAfterSec ? `Старый пароль скопирован. Будет удалён из буфера через ${r.clearAfterSec} с` : 'Старый пароль скопирован', 'ok');
  };
  const edit = () => app.openDialog((close) => <EntryEditor id={d.id} groups={groups} onClose={close} onSaved={() => reload()} />);
  const toggleFav = async () => {
    const pw = await api.passwords.reveal(d.id);
    await api.passwords.save({ id: d.id, title: d.title, username: d.username, password: pw, url: d.url, notes: d.notes, groupId: d.groupId, favorite: !d.favorite, tags: d.tags });
    await reload();
  };
  const remove = async () => {
    const ok = await app.confirm({ title: `Удалить запись «${d.title}»?`, text: 'Запись и история её паролей будут удалены без возможности восстановления.', okText: 'Удалить', danger: true });
    if (!ok) return;
    await api.passwords.remove(d.id);
    onDeleted();
    await reload();
  };
  const isWeb = /^https?:\/\//i.test(d.url);
  return (
    <div className="pm-detail">
      <div className="pm-detail-head">
        <h2 className="ellipsis">{d.title}</h2>
        <div className="btn-row">
          <Button variant="ghost" iconOnly icon="star" className={d.favorite ? 'pm-fav-on' : ''} onClick={toggleFav} title={d.favorite ? 'Убрать из избранного' : 'В избранное'} />
          <Button icon="edit" onClick={edit}>
            Изменить
          </Button>
          <Button variant="ghost" iconOnly icon="trash" onClick={remove} title="Удалить запись" />
        </div>
      </div>
      {(d.weak || d.reused) && (
        <Banner kind="warn">
          {d.weak && 'Пароль слабый — его легко подобрать. '}
          {d.reused && 'Такой же пароль используется в другой записи: если его узнают в одном месте, откроют и другое. '}
          Нажмите «Изменить» → «Сгенерировать».
        </Banner>
      )}
      <div className="pm-fields">
        <FieldRow label="Логин">
          <span className="mono pm-value">{d.username || <span className="faint">—</span>}</span>
          {d.username && <Button size="sm" variant="ghost" icon="copy" onClick={() => copy('username')} title="Скопировать логин" />}
        </FieldRow>
        <FieldRow label="Пароль">
          <span className={`mono pm-value ${revealed === null ? 'pm-masked' : ''}`}>{d.hasPassword ? (revealed ?? '••••••••••••') : <span className="faint">—</span>}</span>
          {d.hasPassword && (
            <>
              <Button size="sm" variant="ghost" icon="eye" onClick={reveal} title={revealed === null ? 'Показать (скроется через 30 с)' : 'Скрыть'} />
              <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyPassword(d.id)} title="Скопировать пароль" />
            </>
          )}
        </FieldRow>
        {d.hasPassword && (
          <FieldRow label="Стойкость">
            <StrengthMeter bits={d.strength} compact />
          </FieldRow>
        )}
        <FieldRow label="Адрес">
          <span className="mono pm-value">{d.url || <span className="faint">—</span>}</span>
          {d.url && <Button size="sm" variant="ghost" icon="copy" onClick={() => copy('url')} title="Скопировать адрес" />}
          {isWeb && <Button size="sm" variant="ghost" icon="link" onClick={() => void api.app.openExternal(d.url)} title="Открыть в браузере" />}
        </FieldRow>
        <FieldRow label="Папка">
          <span className="pm-value">{group ? group.name : <span className="faint">без папки</span>}</span>
        </FieldRow>
        {d.tags.length > 0 && (
          <FieldRow label="Метки">
            <span className="pm-value">
              {d.tags.map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </span>
          </FieldRow>
        )}
      </div>
      <div className="section-title">Заметки</div>
      {d.notes ? <pre className="pm-notes">{d.notes}</pre> : <div className="faint small">Нет заметок</div>}
      <div className="section-title">Сведения</div>
      <div className="pm-meta small muted">
        <div>Создана: {fmt(d.createdAt)}</div>
        <div>Изменена: {fmt(d.updatedAt)}</div>
        {d.hasPassword && (
          <div>
            Пароль не менялся {ageText(d.passwordChangedAt)} (с {fmt(d.passwordChangedAt)})
          </div>
        )}
      </div>
      {d.history.length > 0 && (
        <>
          <button className="linklike section-title pm-history-toggle" onClick={() => setShowHistory(!showHistory)}>
            <Icon name={showHistory ? 'chevronDown' : 'chevronRight'} size={12} /> История паролей ({d.history.length})
          </button>
          {showHistory && (
            <div className="pm-history">
              {d.history.map((h, i) => (
                <div key={i} className="pm-history-row">
                  <span className="small muted">до {fmt(h.changedAt)}</span>
                  <span className={`mono pm-value ${historyShown[i] === undefined ? 'pm-masked' : ''}`}>{historyShown[i] ?? '••••••••'}</span>
                  <Button size="sm" variant="ghost" icon="eye" onClick={() => void revealHistory(i)} title="Показать или скрыть" />
                  <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyHistory(i)} title="Скопировать" />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pm-field">
      <div className="pm-field-label">{label}</div>
      <div className="pm-field-value">{children}</div>
    </div>
  );
}

// ---------- Вспомогательное ----------

function askName(app: ReturnType<typeof usePmApp>, title: string, initial: string): Promise<string | null> {
  return askText(app.openDialog, title, 'Название папки', initial);
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortUrl(u: string): string {
  return u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '');
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
