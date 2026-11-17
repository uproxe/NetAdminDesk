// Быстрый поиск по всей базе (Ctrl+K): команды, Linux, сценарии, устройства, заметки.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SearchIndex } from '../../shared/search';
import { useApp, type SearchRef } from '../lib/store';
import { Icon } from '../lib/icons';
import { RiskBadge, useDebounced } from './ui';
import type { SearchGroup } from '../../shared/search';
import { execSpecFor } from './Commands';
import { getPlatform } from '../../shared/platforms';
import { RISK_LABELS, RISK_ORDER } from '../../shared/risk';
import { SOURCE_SHORT, plural } from '../lib/format';
import type { CommandSource, RiskLevel } from '../../shared/types';

/** Раздел программы или действие, доступное из Ctrl+K (всё, что спрятано в простом режиме, находится здесь). */
export interface PaletteAction {
  id: string;
  title: string;
  hint: string;
  icon: string;
  keywords?: string;
  /** Показывать в подсказках при пустом запросе. */
  suggest?: boolean;
  run: () => void;
}

const GROUP_LABELS: Record<Exclude<SearchGroup, 'action'>, string> = {
  switch: 'Команды коммутаторов',
  linux: 'Linux-команды',
  sql: 'Команды SQL (базы данных)',
  guide: 'Руководства',
  scenario: 'Сценарии',
  device: 'Устройства',
  note: 'Пользовательские заметки'
};

export function CommandPalette({ onClose, onOpenScenario, onOpenNote, actions = [] }: { onClose: () => void; onOpenScenario: (id: number) => void; onOpenNote: (id: number) => void; actions?: PaletteAction[] }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [risk, setRisk] = useState<RiskLevel | ''>('');
  const [source, setSource] = useState<CommandSource | ''>('');
  const [platform, setPlatform] = useState('');
  const [fav, setFav] = useState(false);
  const [sel, setSel] = useState(0);
  const dq = useDebounced(q, 60);
  const listRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => {
    if (!dq.trim() && !groups.length && !risk && !source && !fav && !platform) return [];
    return app.index.search(dq, { groups, risk: risk || undefined, source: source || undefined, favorite: fav || undefined, platform: platform || undefined, includeSensitive: app.settings.showSensitive }, 80);
  }, [dq, groups, risk, source, fav, platform, app.index, app.settings.showSensitive]);

  // Группы упорядочены по лучшему совпадению: если запрос про Apache, Linux-команды будут первыми.
  // Частичные совпадения (совпали не все слова) показываются отдельно в конце.
  const ordered = useMemo(() => {
    const full = hits.filter((h) => !h.partial);
    const part = hits.filter((h) => h.partial);
    const groups: SearchGroup[] = ['switch', 'linux', 'sql', 'guide', 'scenario', 'device', 'note'];
    const best = (g: SearchGroup) => Math.max(0, ...full.filter((h) => h.doc.group === g).map((h) => h.score));
    const order = [...groups].sort((a, b) => best(b) - best(a));
    const main = order.flatMap((g) => full.filter((h) => h.doc.group === g).slice(0, g === 'guide' ? 6 : 25));
    const rest = part.slice(0, full.length ? 12 : 40).map((h) => ({ ...h, doc: { ...h.doc, group: 'partial' as unknown as SearchGroup } }));
    return [...main, ...rest];
  }, [hits]);

  const actionIndex = useMemo(() => new SearchIndex<PaletteAction>(actions.map((a) => ({ id: a.id, group: 'action' as const, title: a.title, fields: [{ text: a.title, weight: 3 }, { text: `${a.hint} ${a.keywords ?? ''}`, weight: 1 }], facets: {}, ref: a }))), [actions]);
  const noFilters = !groups.length && !risk && !source && !fav && !platform;
  const actionHits = useMemo(() => {
    if (!noFilters) return [];
    if (!dq.trim()) return actions.filter((a) => a.suggest);
    return actionIndex
      .search(dq, {}, 6)
      .filter((h) => !h.partial)
      .slice(0, 5)
      .map((h) => h.doc.ref as PaletteAction);
  }, [dq, actionIndex, actions, noFilters]);
  const total = actionHits.length + ordered.length;

  useEffect(() => setSel(0), [dq, groups, risk, source, fav, platform]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const open = (ref: SearchRef, run = false) => {
    onClose();
    if (ref.type === 'command') {
      if (run) app.execute(execSpecFor(ref.item));
      else app.openCommand(ref.item.id);
    } else if (ref.type === 'device') {
      if (run) void app.connect(ref.item.id);
      else app.setSection('devices');
    } else if (ref.type === 'scenario') onOpenScenario(ref.item.id);
    else if (ref.type === 'guide') app.openGuide(ref.item.id);
    else onOpenNote(ref.item.id);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(total - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter' && sel < actionHits.length) {
      e.preventDefault();
      onClose();
      actionHits[sel].run();
    } else if (e.key === 'Enter' && ordered[sel - actionHits.length]) {
      e.preventDefault();
      open(ordered[sel - actionHits.length].doc.ref, e.ctrlKey || e.metaKey);
    } else if (e.key === 'Escape') onClose();
  };

  const toggleGroup = (g: SearchGroup) => setGroups((gs) => (gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]));
  const platforms = useMemo(() => [...new Set(app.commands.map((c) => c.platform))], [app.commands]);
  let lastGroup = '';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input autoFocus placeholder="Поиск: vlan, мак, arp, poe, systemctl, проверка дисков… (раскладку можно не переключать)" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-filters">
          {(Object.keys(GROUP_LABELS) as Exclude<SearchGroup, 'action'>[]).map((g) => (
            <button key={g} className={`chip ${groups.includes(g) ? 'active' : ''}`} onClick={() => toggleGroup(g)}>
              {GROUP_LABELS[g]}
            </button>
          ))}
          <button className={`chip ${fav ? 'active' : ''}`} onClick={() => setFav(!fav)}>
            ★ Избранное
          </button>
          <select className="select" style={{ width: 150, height: 24, fontSize: 12 }} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">Все производители</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {getPlatform(p).name}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 120, height: 24, fontSize: 12 }} value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel | '')}>
            <option value="">Любой риск</option>
            {RISK_ORDER.map((r) => (
              <option key={r} value={r}>
                {RISK_LABELS[r]}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 130, height: 24, fontSize: 12 }} value={source} onChange={(e) => setSource(e.target.value as CommandSource | '')}>
            <option value="">Любой источник</option>
            {(Object.keys(SOURCE_SHORT) as CommandSource[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_SHORT[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="palette-results" ref={listRef}>
          {actionHits.length > 0 && <div className="palette-group">{dq.trim() ? 'Разделы и действия' : 'Быстрые действия'}</div>}
          {actionHits.map((a, i) => (
            <div key={a.id} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => (onClose(), a.run())}>
              <Icon name={a.icon} />
              <div className="main-t">
                <div className="ellipsis">{a.title}</div>
                <div className="sub prose">{a.hint}</div>
              </div>
            </div>
          ))}
          {!ordered.length && (
            <div className="empty small">{dq ? (actionHits.length ? 'Команд и записей не найдено.' : 'Ничего не найдено. Попробуйте другое слово или уберите фильтры.') : 'Начните вводить запрос: команду, задачу («как найти мак»), раздел или действие. Enter — открыть, Ctrl+Enter — выполнить / подключиться.'}</div>
          )}
          {ordered.map((h, j) => {
            const i = j + actionHits.length;
            const ref = h.doc.ref;
            const header = h.doc.group !== lastGroup ? (GROUP_LABELS[h.doc.group as Exclude<SearchGroup, 'action'>] ?? 'Похожие (совпали не все слова)') : null;
            lastGroup = h.doc.group;
            return (
              <div key={h.doc.id}>
                {header && <div className="palette-group">{header}</div>}
                <div className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => open(ref)}>
                  <Icon name={ref.type === 'device' ? 'server' : ref.type === 'scenario' ? 'list' : ref.type === 'note' ? 'note' : ref.type === 'guide' ? 'book' : ref.item.kind === 'linux' ? 'linux' : ref.item.kind === 'sql' ? 'database' : 'switch'} />
                  <div className="main-t">
                    <div className="ellipsis">{h.doc.title}</div>
                    <div className="sub">
                      {ref.type === 'command'
                        ? `${ref.item.vendorLabel} · ${ref.item.command.split('\n')[0]}`
                        : ref.type === 'device'
                          ? `${ref.item.host}:${ref.item.port} · ${getPlatform(ref.item.platform).name}`
                          : ref.type === 'scenario'
                            ? `${ref.item.steps.length} ${plural(ref.item.steps.length, 'шаг', 'шага', 'шагов')}`
                            : ref.type === 'guide'
                              ? ref.item.summary
                              : ref.item.body.slice(0, 80)}
                    </div>
                  </div>
                  {ref.type === 'command' && <RiskBadge risk={ref.item.risk} />}
                  {ref.type === 'command' && ref.item.favorite && <Icon name="star" size={14} style={{ color: 'var(--warn)' }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
