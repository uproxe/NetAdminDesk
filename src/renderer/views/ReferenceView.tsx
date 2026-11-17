// Справочник команд: фильтры по производителю, категории, риску и источнику; карточка команды; заметки.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, errMsg } from '../lib/store';
import { Icon } from '../lib/icons';
import { Button, Empty, Field, FlagBadges, Modal, RiskBadge, useDebounced } from '../components/ui';
import { CommandCard, CommandEditor, emptyCommand } from '../components/Commands';
import { categoriesFor, categoryName, LINUX_CATEGORIES, SQL_CATEGORIES, SWITCH_CATEGORIES } from '../../shared/categories';
import { getPlatform } from '../../shared/platforms';
import { RISK_LABELS, RISK_ORDER } from '../../shared/risk';
import { SOURCE_LABELS, SOURCE_SHORT, fmtDate } from '../lib/format';
import type { CommandRecord, CommandSource, Note, RiskLevel } from '../../shared/types';

type Preset = 'all' | 'switch' | 'linux' | 'sql';

interface Filters {
  kind: 'all' | 'switch' | 'linux' | 'sql';
  platform: string;
  category: string;
  risk: RiskLevel | '';
  source: CommandSource | '';
  favorites: boolean;
  review: boolean;
  /** Только простые команды для начинающих (метка «основы»). */
  basic: boolean;
}

const SOURCE_ORDER: Record<CommandRecord['source'], number> = { user_txt: 0, user: 1, imported: 2, builtin: 3 };

export function useFilteredCommands(q: string, f: Filters) {
  const app = useApp();
  const dq = useDebounced(q, 80);
  return useMemo(() => {
    const opts = {
      groups: f.kind === 'all' ? (['switch', 'linux', 'sql'] as const).slice() : [f.kind],
      platform: f.platform || undefined,
      category: f.category || undefined,
      risk: f.risk || undefined,
      source: f.source || undefined,
      favorite: f.favorites || undefined,
      includeSensitive: true
    };
    let hits = app.index.search(dq, opts as never, 5000).map((h) => (h.doc.ref as { item: CommandRecord }).item);
    // Без запроса ваши записи (из TXT и добавленные вручную) идут первыми, в порядке файла.
    if (!dq.trim()) hits = hits.map((c, i) => [c, i] as const).sort((a, b) => SOURCE_ORDER[a[0].source] - SOURCE_ORDER[b[0].source] || a[1] - b[1]).map((x) => x[0]);
    if (f.basic) hits = hits.filter((c) => c.tags.includes('основы'));
    return f.review ? hits.filter((c) => c.needsReview) : hits;
  }, [app.index, dq, f]);
}

export function ReferenceView({ preset, noteId, onNoteOpened }: { preset: Preset; noteId?: number | null; onNoteOpened?: () => void }) {
  const app = useApp();
  const [tab, setTab] = useState<'commands' | 'notes'>(noteId ? 'notes' : 'commands');
  useEffect(() => {
    if (noteId) setTab('notes');
  }, [noteId]);
  if (preset === 'all' && tab === 'notes')
    return (
      <div className="columns" style={{ flexDirection: 'column' }}>
        <TopTabs tab={tab} setTab={setTab} />
        <NotesPanel openId={noteId ?? null} onOpened={onNoteOpened} />
      </div>
    );
  return (
    <div className="columns" style={{ flexDirection: 'column' }}>
      {preset === 'all' && <TopTabs tab={tab} setTab={setTab} />}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReferenceBrowser key={preset} preset={preset} initialId={app.selectedCommandId} />
      </div>
    </div>
  );
}

function TopTabs({ tab, setTab }: { tab: 'commands' | 'notes'; setTab: (t: 'commands' | 'notes') => void }) {
  return (
    <div className="tabs-inline" style={{ margin: 0, padding: '0 12px', background: 'var(--bg-elev)', flexShrink: 0 }}>
      <button className={tab === 'commands' ? 'active' : ''} onClick={() => setTab('commands')}>
        Команды
      </button>
      <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>
        Заметки (база знаний)
      </button>
    </div>
  );
}

export function ReferenceBrowser({ preset, initialId }: { preset: Preset; initialId?: number | null }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filters>({ kind: preset, platform: '', category: '', risk: '', source: '', favorites: false, review: false, basic: false });
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  useEffect(() => {
    if (initialId) setSelId(initialId);
  }, [initialId]);
  const items = useFilteredCommands(q, f);
  const sel = app.commands.find((c) => c.id === selId) ?? null;

  // счётчики для фильтров (без учёта самого фильтра)
  const base = app.commands.filter((c) => f.kind === 'all' || c.kind === f.kind);
  const platformCounts = countBy(base, (c) => c.platform);
  const catBase = base.filter((c) => !f.platform || c.platform === f.platform);
  const catCounts = countBy(catBase, (c) => `${c.kind}:${c.category}`);
  const cats = f.kind === 'all' ? [...SWITCH_CATEGORIES, ...LINUX_CATEGORIES, ...SQL_CATEGORIES] : categoriesFor(f.kind);
  const set = (patch: Partial<Filters>) => setF((x) => ({ ...x, ...patch }));

  const addNew = () => app.openDialog((close) => <CommandEditor initial={emptyCommand(f.kind === 'all' ? 'switch' : f.kind, f.platform || undefined)} onClose={close} />);

  return (
    <div className="columns">
      <div className="col col-filter">
        {preset === 'all' && (
          <div className="filter-group">
            <div className="filter-title">Раздел</div>
            {(
              [
                ['all', 'Все команды'],
                ['switch', 'Коммутаторы'],
                ['linux', 'Linux'],
                ['sql', 'Базы данных']
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={`filter-item ${f.kind === k ? 'active' : ''}`} onClick={() => set({ kind: k, platform: '', category: '' })}>
                {l}
                <span className="n">{k === 'all' ? app.commands.length : app.commands.filter((c) => c.kind === k).length}</span>
              </button>
            ))}
          </div>
        )}
        {f.kind !== 'linux' && (
          <div className="filter-group">
            <div className="filter-title">{f.kind === 'sql' ? 'СУБД' : 'Производитель / платформа'}</div>
            <button className={`filter-item ${!f.platform ? 'active' : ''}`} onClick={() => set({ platform: '', category: '' })}>
              Все
              <span className="n">{base.length}</span>
            </button>
            {Object.entries(platformCounts)
              .filter(([p]) => f.kind === 'all' || getPlatform(p).kind !== 'linux')
              .sort((a, b) => b[1] - a[1])
              .map(([p, n]) => (
                <button key={p} className={`filter-item ${f.platform === p ? 'active' : ''}`} onClick={() => set({ platform: p, category: '' })} title={getPlatform(p).notes}>
                  <span className="ellipsis">{getPlatform(p).name}</span>
                  <span className="n">{n}</span>
                </button>
              ))}
          </div>
        )}
        <div className="filter-group">
          <label className="check" title="Простые команды с подробными пояснениями — для тех, кто только начинает">
            <input type="checkbox" checked={f.basic} onChange={(e) => set({ basic: e.target.checked })} />
            <span>
              <b>Только простые команды</b> ({base.filter((c) => c.tags.includes('основы')).length})
            </span>
          </label>
        </div>
        <div className="filter-group">
          <div className="filter-title">Категория</div>
          <button className={`filter-item ${!f.category ? 'active' : ''}`} onClick={() => set({ category: '' })}>
            Все категории
          </button>
          {cats
            .filter((c) => catCounts[`${c.kind}:${c.id}`])
            .map((c) => (
              <button key={`${c.kind}:${c.id}`} className={`filter-item ${f.category === c.id ? 'active' : ''}`} onClick={() => set({ category: c.id })}>
                <span className="ellipsis">{c.name}</span>
                <span className="n">{catCounts[`${c.kind}:${c.id}`]}</span>
              </button>
            ))}
        </div>
        <div className="filter-group">
          <div className="filter-title">Дополнительно</div>
          <Field label="Уровень риска">
            <select className="select" value={f.risk} onChange={(e) => set({ risk: e.target.value as RiskLevel | '' })}>
              <option value="">Любой</option>
              {RISK_ORDER.map((r) => (
                <option key={r} value={r}>
                  {RISK_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Источник">
            <select className="select" value={f.source} onChange={(e) => set({ source: e.target.value as CommandSource | '' })}>
              <option value="">Любой</option>
              {(Object.keys(SOURCE_SHORT) as CommandSource[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={f.favorites} onChange={(e) => set({ favorites: e.target.checked })} />
            <span>Только избранное</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={f.review} onChange={(e) => set({ review: e.target.checked })} />
            <span>Только «Требует проверки»</span>
          </label>
        </div>
      </div>
      <div className="col col-list">
        <div className="col-header">
          <input className="input" placeholder="Поиск в справочнике… (мак, влан, ошибки порта, systemctl)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <Button icon="plus" onClick={addNew} title="Добавить свою команду">
            Добавить
          </Button>
        </div>
        <div className="small faint" style={{ padding: '4px 14px', borderBottom: '1px solid var(--border)' }}>
          Найдено: {items.length}
        </div>
        <div className="col-body">
          {!items.length && <Empty title="Ничего не найдено">Измените запрос или фильтры.</Empty>}
          {items.slice(0, 600).map((c) => (
            <CommandListItem key={c.id} c={c} active={c.id === selId} onClick={() => setSelId(c.id)} />
          ))}
          {items.length > 600 && <div className="small faint" style={{ padding: 12 }}>Показаны первые 600 — уточните запрос.</div>}
        </div>
      </div>
      <div className="col col-detail">{sel ? <CommandCard c={sel} /> : <Empty icon="book" title="Выберите команду">Карточка покажет синтаксис, пояснения, примеры и кнопки «Копировать» / «Выполнить на устройстве».</Empty>}</div>
    </div>
  );
}

export function CommandListItem({ c, active, onClick }: { c: CommandRecord; active: boolean; onClick: () => void }) {
  const app = useApp();
  const hidden = c.sensitive && !app.settings.showSensitive;
  return (
    <div className={`list-item ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="title">
        {c.favorite && <Icon name="star" size={12} style={{ color: 'var(--warn)', flexShrink: 0 }} />}
        <span className="t">{hidden ? 'Запись с учётными данными (скрыто)' : c.title}</span>
      </div>
      {c.entryType !== 'note' && <div className="cmd">{c.command.split('\n')[0]}{c.command.includes('\n') ? ` … (+${c.command.split('\n').length - 1})` : ''}</div>}
      <div className="meta">
        <RiskBadge risk={c.risk} />
        {(c.kind === 'linux' || !c.vendorUnknown) && <span className="badge outline">{c.kind === 'linux' ? categoryName('linux', c.category) : c.vendorLabel}</span>}
        <span className="badge outline">{SOURCE_SHORT[c.source]}</span>
        {c.verified && <span className="badge ok">проверено</span>}
        <FlagBadges c={c} />
      </div>
    </div>
  );
}

function countBy<T>(list: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of list) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}

export function NotesPanel({ openId, onOpened }: { openId: number | null; onOpened?: () => void }) {
  const app = useApp();
  const [sel, setSel] = useState<number | null>(openId);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (openId) {
      setSel(openId);
      onOpened?.();
    }
  }, [openId, onOpened]);
  const list = app.notes.filter((n) => !q || `${n.title} ${n.body} ${n.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const note = app.notes.find((n) => n.id === sel);
  const edit = (n?: Note) => app.openDialog((close) => <NoteEditor note={n} onClose={close} onSaved={(id) => setSel(id)} />);
  return (
    <div className="columns" style={{ flex: 1, minHeight: 0 }}>
      <div className="col col-list" style={{ maxWidth: 420 }}>
        <div className="col-header">
          <input className="input" placeholder="Поиск по заметкам" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button icon="plus" onClick={() => edit()}>
            Заметка
          </Button>
        </div>
        <div className="col-body">
          {!list.length && <Empty icon="note" title="Заметок нет">Храните здесь схемы VLAN, особенности оборудования, контакты, инструкции.</Empty>}
          {list.map((n) => (
            <div key={n.id} className={`list-item ${sel === n.id ? 'active' : ''}`} onClick={() => setSel(n.id)}>
              <div className="title">
                <span className="t">{n.title}</span>
              </div>
              <div className="small muted ellipsis">{n.body.split('\n')[0]}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="col grow" style={{ overflowY: 'auto' }}>
        {note ? (
          <div className="detail">
            <div className="row">
              <h2 className="grow">{note.title}</h2>
              <Button icon="edit" onClick={() => edit(note)}>
                Изменить
              </Button>
              <Button
                variant="ghost"
                icon="trash"
                onClick={async () => {
                  if (!(await app.confirm({ title: 'Удалить заметку?', text: note.title, okText: 'Удалить', danger: true }))) return;
                  await api.notes.remove(note.id);
                  await app.refresh('notes');
                  setSel(null);
                }}
              />
            </div>
            <div className="row wrap small muted" style={{ gap: 6 }}>
              {note.tags.map((t) => (
                <span key={t} className="badge outline">
                  {t}
                </span>
              ))}
              <span>изменено {fmtDate(note.updatedAt)}</span>
            </div>
            <pre className="output" style={{ whiteSpace: 'pre-wrap', maxHeight: 'none', marginTop: 14, fontFamily: 'var(--ui-font)', fontSize: 13.5 }}>
              {note.body}
            </pre>
          </div>
        ) : (
          <Empty icon="note" title="Выберите заметку" />
        )}
      </div>
    </div>
  );
}

function NoteEditor({ note, onClose, onSaved }: { note?: Note; onClose: () => void; onSaved: (id: number) => void }) {
  const app = useApp();
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [tags, setTags] = useState(note?.tags.join(', ') ?? '');
  const save = async () => {
    try {
      const n = await api.notes.save({ id: note?.id, title: title.trim() || 'Без названия', body, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      await app.refresh('notes');
      onSaved(n.id);
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <Modal
      title={note ? 'Изменить заметку' : 'Новая заметка'}
      width="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <Field label="Заголовок">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field label="Текст">
        <textarea className="textarea" rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label="Теги">
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
    </Modal>
  );
}
