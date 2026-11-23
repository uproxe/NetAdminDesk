// Мониторинг доступности: карта сети, список узлов, журнал событий, настройки.
// Принцип — как можно проще: добавить узел, расставить на карте, видеть, что в сети, а что нет.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { api } from '../api';
import { useApp, errMsg } from '../lib/store';
import { Icon } from '../lib/icons';
import { Banner, Button, Empty, Modal, Tabs } from '../components/ui';
import { reloadMonitor, useMonitor } from '../lib/monitor';
import { durationText, MONITOR_KINDS, STATUS_LABELS, type MapItem, type MapLink, type MonitorMap, type MonitorNode, type MonitorState, type MonitorStatus } from '../../shared/monitor';
import { BulkAddDialog, FromDevicesDialog, MonitorSettingsPanel, NodeDetailsDialog, NodeEditor } from './MonitorDialogs';

type Tab = 'map' | 'nodes' | 'events' | 'settings';
let lastTab: Tab = 'map';
let lastMapId: number | null = null;

export const STATUS_COLORS: Record<MonitorStatus, string> = {
  up: 'var(--ok)',
  warn: 'var(--warn)',
  down: 'var(--crit)',
  unknown: 'var(--text-dim)',
  paused: 'var(--text-dim)'
};

export function kindIcon(kind: string): string {
  return MONITOR_KINDS.find((k) => k.id === kind)?.icon ?? 'box';
}

export function sinceText(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = d.toDateString() === new Date().toDateString() ? '' : `${d.toLocaleDateString('ru-RU')} `;
  return `с ${day}${time} (${durationText(Date.now() - d.getTime())})`;
}

export function MonitorView() {
  const app = useApp();
  const mon = useMonitor();
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  // Обновлять «сколько минут» раз в 30 секунд
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const c = mon.status?.counts ?? { up: 0, warn: 0, down: 0, unknown: 0, paused: 0 };
  const enabled = app.settings.monitor.enabled;
  const toggle = async () => {
    await app.updateSettings({ monitor: { ...app.settings.monitor, enabled: !enabled } });
    await api.monitor.applySettings();
  };
  const addNode = () => app.openDialog((close) => <NodeEditor onClose={close} />);
  return (
    <div className="page monitor-page">
      <div className="monitor-head">
        <div className="monitor-counts">
          <span className="mchip up" title="Отвечают на проверку">
            <i /> В сети <b>{c.up}</b>
          </span>
          <span className={`mchip warn ${c.warn ? '' : 'zero'}`} title="Доступны, но есть замечание: SNMP не отвечает или упал порт (трап linkDown)">
            <i /> Проблемы <b>{c.warn}</b>
          </span>
          <span className={`mchip down ${c.down ? '' : 'zero'}`} title="Не ответили несколько проверок подряд">
            <i /> Не в сети <b>{c.down}</b>
          </span>
          {c.unknown > 0 && (
            <span className="mchip unknown">
              <i /> Проверяются <b>{c.unknown}</b>
            </span>
          )}
          {c.paused > 0 && (
            <span className="mchip unknown" title="Проверка узла выключена">
              <i /> Отключены <b>{c.paused}</b>
            </span>
          )}
          {mon.status?.trap.enabled && (
            <span className={`mchip ${mon.status.trap.listening ? 'info' : 'down'}`} title={mon.status.trap.listening ? `Принято трапов: ${mon.status.trap.received}` : mon.status.trap.error}>
              <Icon name="download" size={13} /> Трапы: {mon.status.trap.listening ? `UDP ${mon.status.trap.port}` : 'ошибка'}
            </span>
          )}
        </div>
        <div className="btn-row">
          <Button icon={enabled ? 'pause' : 'play'} onClick={toggle} title={enabled ? 'Остановить все проверки' : 'Возобновить проверки'}>
            {enabled ? 'Пауза' : 'Включить'}
          </Button>
          <Button variant="primary" icon="plus" onClick={addNode}>
            Добавить узел
          </Button>
        </div>
      </div>
      {!enabled && <Banner kind="warn">Мониторинг на паузе: узлы не проверяются и трапы не принимаются.</Banner>}
      {mon.status && !mon.status.canStoreSecrets && mon.nodes.some((n) => n.method === 'snmp') && (
        <Banner kind="warn">Хранилище паролей не настроено или заблокировано — SNMP community недоступна, узлы с проверкой SNMP проверяются только ping. «Настройки → Пароли».</Banner>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'map', label: 'Карта' },
          { id: 'nodes', label: `Узлы (${mon.nodes.length})` },
          { id: 'events', label: 'События' },
          { id: 'settings', label: 'Настройки' }
        ]}
      />
      {mon.loaded && !mon.nodes.length && tab !== 'settings' ? (
        <FirstSteps />
      ) : (
        <>
          {tab === 'map' && <MapTab />}
          {tab === 'nodes' && <NodesTab />}
          {tab === 'events' && <EventsTab />}
        </>
      )}
      {tab === 'settings' && <MonitorSettingsPanel />}
    </div>
  );
}

function FirstSteps() {
  const app = useApp();
  return (
    <div className="card" style={{ maxWidth: 820 }}>
      <Empty icon="pulse" title="Добавьте устройства, за которыми нужно следить">
        Программа будет проверять их каждые {app.settings.monitor.defaultIntervalSec} секунд и покажет на карте, что в сети, а что нет. Проверять можно простым ping, по SNMP или подключением к TCP-порту.
      </Empty>
      <div className="btn-row" style={{ justifyContent: 'center', marginTop: 8 }}>
        <Button variant="primary" icon="plus" onClick={() => app.openDialog((close) => <NodeEditor onClose={close} />)}>
          Добавить узел
        </Button>
        <Button icon="list" onClick={() => app.openDialog((close) => <BulkAddDialog onClose={close} />)}>
          Добавить списком
        </Button>
        <Button icon="server" disabled={!app.devices.length} onClick={() => app.openDialog((close) => <FromDevicesDialog onClose={close} />)}>
          Из раздела «Устройства»
        </Button>
      </div>
      <ol className="small muted" style={{ marginTop: 18, lineHeight: 1.7 }}>
        <li>Добавьте узлы: коммутаторы, серверы, камеры. Достаточно названия и IP-адреса.</li>
        <li>На вкладке «Карта» создайте карту и расставьте узлы, соедините их линиями.</li>
        <li>По желанию: включите приём SNMP-трапов и письма на почту во вкладке «Настройки».</li>
      </ol>
    </div>
  );
}

// ---------- Карта ----------

const NODE_R = 22;

function MapTab() {
  const app = useApp();
  const mon = useMonitor();
  const [maps, setMaps] = useState<MonitorMap[] | null>(null);
  const [mapId, setMapIdState] = useState<number | null>(lastMapId);
  const [draft, setDraft] = useState<MonitorMap | null>(null);
  const [edit, setEdit] = useState(false);
  const [linkFrom, setLinkFrom] = useState<number | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ nodeId: number; dx: number; dy: number; moved: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const setMapId = (id: number | null) => {
    lastMapId = id;
    setMapIdState(id);
  };
  const load = async (select?: number) => {
    const list = await api.monitor.maps();
    setMaps(list);
    const id = select ?? (list.some((m) => m.id === mapId) ? mapId : list[0]?.id ?? null);
    setMapId(id);
    setDraft(list.find((m) => m.id === id) ?? null);
    setDirty(false);
  };
  useEffect(() => {
    void load();
  }, []);

  const nodesById = useMemo(() => new Map(mon.nodes.map((n) => [n.id, n])), [mon.nodes]);
  const state = (id: number): MonitorState | undefined => mon.states.get(id);
  const statusOf = (id: number): MonitorStatus => state(id)?.status ?? 'unknown';

  const save = async (m = draft) => {
    if (!m) return;
    try {
      const r = await api.monitor.saveMap(m);
      setMaps((list) => (list ?? []).map((x) => (x.id === r.id ? r : x)));
      setDirty(false);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  // Автосохранение через секунду после изменения
  useEffect(() => {
    if (!dirty || !draft) return;
    const t = setTimeout(() => void save(), 900);
    return () => clearTimeout(t);
  }, [dirty, draft]);

  const change = (fn: (m: MonitorMap) => MonitorMap) => {
    setDraft((m) => (m ? fn(m) : m));
    setDirty(true);
  };

  const createMap = async () => {
    const name = `Карта ${(maps?.length ?? 0) + 1}`;
    // Новая карта сразу со всеми узлами, разложенными сеткой
    const items = gridLayout(mon.nodes.map((n) => n.id), [], 1600);
    const m = await api.monitor.saveMap({ name, background: '', width: 1600, height: Math.max(900, gridHeight(items.length)), items, links: [] });
    await load(m.id);
    setEdit(true);
    app.toast('Карта создана: узлы разложены сеткой. Перетащите их на свои места и соедините линиями.', 'ok');
  };
  const rename = async () => {
    if (!draft) return;
    app.openDialog((close) => <RenameMap map={draft} onClose={close} onSave={(n) => (change((m) => ({ ...m, name: n })), close())} />);
  };
  const remove = async () => {
    if (!draft) return;
    if (!(await app.confirm({ title: 'Удалить карту?', text: `Карта «${draft.name}» будет удалена. Узлы и их проверки останутся.`, okText: 'Удалить', danger: true }))) return;
    await api.monitor.removeMap(draft.id);
    await load();
  };

  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const svg = wrap.current?.querySelector('svg');
    const r = svg?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const onNodeDown = (e: RPointerEvent<SVGGElement>, id: number) => {
    e.stopPropagation();
    if (linkMode) {
      if (linkFrom === null) setLinkFrom(id);
      else if (linkFrom !== id) {
        const a = linkFrom;
        change((m) => (m.links.some((l) => (l.a === a && l.b === id) || (l.a === id && l.b === a)) ? m : { ...m, links: [...m.links, { a, b: id, label: '' }] }));
        setLinkFrom(null);
      }
      return;
    }
    if (!edit) {
      setSelected(id);
      return;
    }
    const p = svgPoint(e);
    const it = draft?.items.find((i) => i.nodeId === id);
    if (!it) return;
    drag.current = { nodeId: id, dx: p.x - it.x, dy: p.y - it.y, moved: false };
    (e.currentTarget as unknown as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !draft) return;
    const p = svgPoint(e);
    const x = Math.max(NODE_R + 4, Math.min(draft.width - NODE_R - 4, Math.round((p.x - d.dx) / 10) * 10));
    const y = Math.max(NODE_R + 4, Math.min(draft.height - NODE_R - 24, Math.round((p.y - d.dy) / 10) * 10));
    d.moved = true;
    setDraft({ ...draft, items: draft.items.map((i) => (i.nodeId === d.nodeId ? { ...i, x, y } : i)) });
  };
  const onUp = () => {
    if (drag.current?.moved) setDirty(true);
    else if (drag.current) setSelected(drag.current.nodeId);
    drag.current = null;
  };
  const onWheel = (e: RWheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom((z) => Math.max(0.3, Math.min(2.5, Math.round((z - Math.sign(e.deltaY) * 0.1) * 10) / 10)));
  };
  const fit = (maxZoom = 1.5) => {
    const w = (wrap.current?.clientWidth ?? 1000) - 4;
    if (draft) setZoom(Math.max(0.3, Math.min(maxZoom, Math.floor((w / draft.width) * 20) / 20)));
  };
  // При открытии карты, которая шире окна, сразу вписываем её по ширине (но не увеличиваем)
  const draftId = draft?.id;
  useEffect(() => {
    if (!draftId) return;
    const t = requestAnimationFrame(() => fit(1));
    return () => cancelAnimationFrame(t);
  }, [draftId]);
  const addToMap = (id: number) => {
    const el = wrap.current;
    const cx = el ? (el.scrollLeft + el.clientWidth / 2) / zoom : 200;
    const cy = el ? (el.scrollTop + el.clientHeight / 2) / zoom : 200;
    change((m) => ({ ...m, items: [...m.items, { nodeId: id, x: Math.round(cx / 10) * 10, y: Math.round(cy / 10) * 10 }] }));
  };
  const removeFromMap = (id: number) => change((m) => ({ ...m, items: m.items.filter((i) => i.nodeId !== id), links: m.links.filter((l) => l.a !== id && l.b !== id) }));
  const setBackground = (file: File) => {
    if (file.size > 8 * 1024 * 1024) return app.toast('Картинка больше 8 МБ — уменьшите её', 'error');
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      const img = new Image();
      img.onload = () => change((m) => ({ ...m, background: url, width: Math.max(800, Math.min(6000, img.naturalWidth)), height: Math.max(500, Math.min(6000, img.naturalHeight)) }));
      img.onerror = () => app.toast('Не удалось открыть картинку', 'error');
      img.src = url;
    };
    r.readAsDataURL(file);
  };
  const arrange = () =>
    change((m) => {
      const placed = new Set(m.items.map((i) => i.nodeId));
      const extra = mon.nodes.filter((n) => !placed.has(n.id)).map((n) => n.id);
      return { ...m, items: gridLayout(extra, m.items, m.width) };
    });

  if (!maps) return null;
  if (!maps.length)
    return (
      <div className="card" style={{ maxWidth: 720 }}>
        <Empty icon="map" title="Карт пока нет">
          Карта — это схема, на которой узлы расставлены так, как вам удобно: по этажам, шкафам или по схеме сети. Цвет узла показывает его состояние, а линия между узлами становится красной, если один из них не в сети.
        </Empty>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <Button variant="primary" icon="plus" onClick={createMap}>
            Создать карту
          </Button>
        </div>
      </div>
    );

  const onMap = new Set(draft?.items.map((i) => i.nodeId) ?? []);
  const notPlaced = mon.nodes.filter((n) => !onMap.has(n.id));
  const problems = mon.nodes.filter((n) => ['down', 'warn'].includes(statusOf(n.id))).sort((a, b) => (statusOf(a.id) === 'down' ? 0 : 1) - (statusOf(b.id) === 'down' ? 0 : 1));
  const sel = selected ? nodesById.get(selected) : undefined;

  return (
    <div className="monitor-map-layout">
      <div className="monitor-map-main">
        <div className="map-toolbar">
          <select className="select" style={{ width: 220 }} value={mapId ?? ''} onChange={(e) => void (dirty && save(), setMapId(Number(e.target.value)), setDraft(maps.find((m) => m.id === Number(e.target.value)) ?? null), setEdit(false))}>
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <Button size="sm" icon="plus" onClick={createMap} title="Новая карта">
            Новая
          </Button>
          <span className="grow" />
          <Button size="sm" variant="ghost" iconOnly icon="minimize" title="Уменьшить (Ctrl + колесо)" onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 10) / 10))} />
          <span className="small muted" style={{ minWidth: 38, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <Button size="sm" variant="ghost" iconOnly icon="maximize" title="Увеличить (Ctrl + колесо)" onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))} />
          <Button size="sm" variant="ghost" onClick={() => fit()} title="Вписать по ширине">
            По ширине
          </Button>
          <Button
            size="sm"
            variant={edit ? 'primary' : 'default'}
            icon={edit ? 'check' : 'edit'}
            onClick={() => {
              if (edit) void save();
              setEdit(!edit);
              setLinkMode(false);
              setLinkFrom(null);
            }}
          >
            {edit ? 'Готово' : 'Редактировать'}
          </Button>
        </div>
        {edit && (
          <div className="map-toolbar edit">
            <Button size="sm" variant={linkMode ? 'primary' : 'default'} icon="link" onClick={() => (setLinkMode(!linkMode), setLinkFrom(null))} title="Щёлкните два узла, чтобы соединить их линией">
              {linkMode ? (linkFrom ? 'Выберите второй узел…' : 'Выберите первый узел…') : 'Связь'}
            </Button>
            <Button size="sm" icon="grid" onClick={arrange} disabled={!notPlaced.length} title="Добавить на карту все узлы, которых на ней нет, сеткой">
              Добавить все ({notPlaced.length})
            </Button>
            <Button size="sm" icon="image" onClick={() => fileInput.current?.click()} title="План этажа, схема — картинка PNG или JPEG">
              Подложка…
            </Button>
            {draft?.background && (
              <Button size="sm" variant="ghost" onClick={() => change((m) => ({ ...m, background: '' }))}>
                Убрать подложку
              </Button>
            )}
            <Button size="sm" variant="ghost" icon="edit" onClick={rename}>
              Переименовать
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={remove}>
              Удалить карту
            </Button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={(e) => (e.target.files?.[0] && setBackground(e.target.files[0]), (e.target.value = ''))} />
            <span className="small muted">Перетаскивайте узлы мышью. Щелчок по линии в режиме «Связь» удаляет её. {dirty ? 'Сохраняется…' : 'Сохранено'}</span>
          </div>
        )}
        <div className={`map-canvas ${edit ? 'editing' : ''}`} ref={wrap} onWheel={onWheel}>
          {draft && (
            <svg
              width={draft.width * zoom}
              height={draft.height * zoom}
              viewBox={`0 0 ${draft.width} ${draft.height}`}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              onPointerDown={() => (setSelected(null), setLinkFrom(null))}
            >
              {draft.background ? <image href={draft.background} x={0} y={0} width={draft.width} height={draft.height} preserveAspectRatio="xMidYMid meet" opacity={0.55} /> : <rect className="map-grid" x={0} y={0} width={draft.width} height={draft.height} />}
              {draft.links.map((l, i) => (
                <MapLinkLine
                  key={l.id ?? `n${i}`}
                  link={l}
                  items={draft.items}
                  a={statusOf(l.a)}
                  b={statusOf(l.b)}
                  onClick={() => {
                    if (edit && linkMode) change((m) => ({ ...m, links: m.links.filter((x) => x !== l) }));
                  }}
                />
              ))}
              {draft.items.map((it) => {
                const n = nodesById.get(it.nodeId);
                if (!n) return null;
                return <MapNode key={it.nodeId} node={n} item={it} st={state(n.id)} selected={selected === n.id || linkFrom === n.id} edit={edit} onDown={(e) => onNodeDown(e, n.id)} onRemove={() => removeFromMap(n.id)} />;
              })}
            </svg>
          )}
        </div>
      </div>
      <div className="monitor-side">
        {edit && notPlaced.length > 0 && (
          <div className="card">
            <h3>Нет на карте</h3>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Щёлкните, чтобы поставить узел в центр видимой области.
            </div>
            <div className="mlist">
              {notPlaced.map((n) => (
                <button key={n.id} className="mlist-item" onClick={() => addToMap(n.id)}>
                  <span className="mdot" style={{ background: STATUS_COLORS[statusOf(n.id)] }} />
                  <Icon name={kindIcon(n.kind)} size={14} />
                  <span className="ellipsis">{n.name}</span>
                  <Icon name="plus" size={13} />
                </button>
              ))}
            </div>
          </div>
        )}
        {sel ? (
          <NodeQuickCard node={sel} st={state(sel.id)} onClose={() => setSelected(null)} />
        ) : (
          <div className="card">
            <h3>{problems.length ? 'Требуют внимания' : 'Всё в порядке'}</h3>
            {!problems.length && <div className="small muted">Все включённые узлы отвечают на проверку.</div>}
            <div className="mlist">
              {problems.map((n) => {
                const st = state(n.id);
                return (
                  <button key={n.id} className="mlist-item tall" onClick={() => setSelected(n.id)}>
                    <span className={`mdot ${st?.status === 'down' ? 'blink' : ''}`} style={{ background: STATUS_COLORS[statusOf(n.id)] }} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="ellipsis" style={{ display: 'block' }}>
                        {n.name}
                      </span>
                      <span className="small muted ellipsis" style={{ display: 'block' }}>
                        {st?.status === 'down' ? `не в сети ${sinceText(st.since).replace(/^с /, 'с ')}` : st?.portsDown.length ? `упал порт: ${st.portsDown.map((p) => p.label).join(', ')}` : st?.message}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <RecentEvents limit={8} />
      </div>
    </div>
  );
}

function gridHeight(n: number): number {
  return Math.ceil(n / 10) * 130 + 140;
}

/** Разложить узлы сеткой, не занимая места уже расставленных. */
export function gridLayout(ids: number[], existing: MapItem[], width: number): MapItem[] {
  const taken = new Set(existing.map((i) => `${Math.round(i.x / 140)}:${Math.round(i.y / 130)}`));
  const out = [...existing];
  const cols = Math.max(1, Math.floor((width - 80) / 140));
  let cell = 0;
  for (const id of ids) {
    let x = 0;
    let y = 0;
    do {
      x = 90 + (cell % cols) * 140;
      y = 80 + Math.floor(cell / cols) * 130;
      cell++;
    } while (taken.has(`${Math.round(x / 140)}:${Math.round(y / 130)}`));
    out.push({ nodeId: id, x, y });
  }
  return out;
}

function MapLinkLine({ link, items, a, b, onClick }: { link: MapLink; items: MapItem[]; a: MonitorStatus; b: MonitorStatus; onClick: () => void }) {
  const pa = items.find((i) => i.nodeId === link.a);
  const pb = items.find((i) => i.nodeId === link.b);
  if (!pa || !pb) return null;
  const broken = a === 'down' || b === 'down';
  const warn = !broken && (a === 'warn' || b === 'warn');
  return (
    <g className="map-link" onPointerDown={(e) => (e.stopPropagation(), onClick())}>
      <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="hit" />
      <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className={broken ? 'broken' : warn ? 'warn' : ''} />
      {link.label && (
        <text x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - 6} textAnchor="middle" className="map-link-label">
          {link.label}
        </text>
      )}
    </g>
  );
}

function MapNode({ node, item, st, selected, edit, onDown, onRemove }: { node: MonitorNode; item: MapItem; st?: MonitorState; selected: boolean; edit: boolean; onDown: (e: RPointerEvent<SVGGElement>) => void; onRemove: () => void }) {
  const status = st?.status ?? 'unknown';
  const title = `${node.name} — ${node.host}\n${STATUS_LABELS[status]}${st?.since && status !== 'unknown' ? ` ${sinceText(st.since)}` : ''}${st?.message ? `\n${st.message}` : ''}${st?.latencyMs != null && status !== 'down' ? `\nОтклик: ${st.latencyMs} мс` : ''}`;
  return (
    <g className={`map-node s-${status} ${selected ? 'selected' : ''}`} transform={`translate(${item.x} ${item.y})`} onPointerDown={onDown}>
      <title>{title}</title>
      {status === 'down' && <circle r={NODE_R + 6} className="pulse-ring" />}
      <circle r={NODE_R} className="body" style={{ stroke: STATUS_COLORS[status] }} />
      <g transform="translate(-11 -11)" style={{ color: STATUS_COLORS[status] }}>
        <Icon name={kindIcon(node.kind)} size={22} />
      </g>
      <text y={NODE_R + 15} textAnchor="middle" className="map-node-label">
        {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
      </text>
      <text y={NODE_R + 28} textAnchor="middle" className="map-node-sub">
        {status === 'down' ? `нет ${st ? durationText(Date.now() - Date.parse(st.since)) : ''}` : node.host}
      </text>
      {edit && (
        <g className="map-node-remove" transform={`translate(${NODE_R - 2} ${-NODE_R + 2})`} onPointerDown={(e) => (e.stopPropagation(), onRemove())}>
          <title>Убрать с карты</title>
          <circle r={8} />
          <path d="M-3 -3 L3 3 M3 -3 L-3 3" />
        </g>
      )}
    </g>
  );
}

function NodeQuickCard({ node, st, onClose }: { node: MonitorNode; st?: MonitorState; onClose: () => void }) {
  const app = useApp();
  const status = st?.status ?? 'unknown';
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      await api.monitor.checkNow(node.id);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="mdot" style={{ background: STATUS_COLORS[status], marginTop: 6 }} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0 }} className="ellipsis">
            {node.name}
          </h3>
          <div className="small muted mono">{node.host}</div>
        </div>
        <Button size="sm" variant="ghost" iconOnly icon="x" onClick={onClose} title="Закрыть" />
      </div>
      <div className="kv" style={{ marginTop: 8 }}>
        <span>Состояние</span>
        <b style={{ color: STATUS_COLORS[status] }}>{STATUS_LABELS[status]}</b>
        <span>С какого времени</span>
        <span>{status === 'unknown' ? '—' : sinceText(st?.since)}</span>
        <span>Последняя проверка</span>
        <span>{st?.lastCheck ? new Date(st.lastCheck).toLocaleTimeString('ru-RU') : '—'}</span>
        {st?.latencyMs != null && status !== 'down' && (
          <>
            <span>Отклик</span>
            <span>{st.latencyMs} мс</span>
          </>
        )}
        {st?.message && (
          <>
            <span>Результат</span>
            <span>{st.message}</span>
          </>
        )}
        {st?.sysName && (
          <>
            <span>Имя (SNMP)</span>
            <span>{st.sysName}</span>
          </>
        )}
        {!!st?.portsDown.length && (
          <>
            <span>Упавшие порты</span>
            <span>{st.portsDown.map((p) => p.label).join(', ')}</span>
          </>
        )}
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <Button size="sm" icon="refresh" disabled={busy} onClick={check}>
          Проверить
        </Button>
        <Button size="sm" icon="info" onClick={() => app.openDialog((close) => <NodeDetailsDialog node={node} onClose={close} />)}>
          Подробнее
        </Button>
        {node.deviceId && (
          <Button size="sm" icon="terminal" onClick={() => void app.connect(node.deviceId!)}>
            SSH
          </Button>
        )}
      </div>
    </div>
  );
}

function RecentEvents({ limit }: { limit: number }) {
  const mon = useMonitor();
  const list = mon.events.filter((e) => e.type !== 'system').slice(0, limit);
  if (!list.length) return null;
  return (
    <div className="card">
      <h3>Последние события</h3>
      <div className="mevents compact">
        {list.map((e) => (
          <div key={e.id} className={`mevent l-${e.level}`}>
            <span className="t">{new Date(e.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="m">
              <b>{e.nodeName}</b> {e.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RenameMap({ map, onClose, onSave }: { map: MonitorMap; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(map.name);
  return (
    <Modal
      title="Название карты"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            Сохранить
          </Button>
        </>
      }
    >
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} />
    </Modal>
  );
}

// ---------- Узлы ----------

function NodesTab() {
  const app = useApp();
  const mon = useMonitor();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'problems' | 'down'>('all');
  const [busy, setBusy] = useState<number | null>(null);
  const st = (id: number) => mon.states.get(id);
  const order: Record<MonitorStatus, number> = { down: 0, warn: 1, unknown: 2, up: 3, paused: 4 };
  const list = mon.nodes
    .filter((n) => !q.trim() || `${n.name} ${n.host} ${n.notes} ${st(n.id)?.sysName ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((n) => filter === 'all' || (filter === 'down' ? st(n.id)?.status === 'down' : ['down', 'warn'].includes(st(n.id)?.status ?? '')))
    .sort((a, b) => order[st(a.id)?.status ?? 'unknown'] - order[st(b.id)?.status ?? 'unknown'] || a.name.localeCompare(b.name, 'ru'));
  const check = async (id: number) => {
    setBusy(id);
    try {
      await api.monitor.checkNow(id);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const remove = async (n: MonitorNode) => {
    if (!(await app.confirm({ title: 'Удалить узел из мониторинга?', text: `«${n.name}» (${n.host}) пропадёт со всех карт. Журнал событий сохранится.`, okText: 'Удалить', danger: true }))) return;
    await api.monitor.removeNode(n.id);
    await reloadMonitor();
  };
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="col-header" style={{ flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: '1 1 200px', minWidth: 160 }} placeholder="Поиск по названию, адресу, заметке…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {(
            [
              ['all', 'Все'],
              ['problems', 'Проблемы'],
              ['down', 'Не в сети']
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <Button icon="list" onClick={() => app.openDialog((close) => <BulkAddDialog onClose={close} />)}>
          Списком
        </Button>
        <Button icon="server" disabled={!app.devices.length} onClick={() => app.openDialog((close) => <FromDevicesDialog onClose={close} />)} title="Взять устройства из раздела «Устройства»">
          Из устройств
        </Button>
        <Button variant="primary" icon="plus" onClick={() => app.openDialog((close) => <NodeEditor onClose={close} />)}>
          Добавить
        </Button>
      </div>
      <div style={{ overflow: 'auto' }}>
        <table className="table monitor-table">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th>Узел</th>
              <th>Адрес</th>
              <th>Проверка</th>
              <th>Состояние</th>
              <th>Отклик</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {list.map((n) => {
              const s = st(n.id);
              const status = s?.status ?? 'unknown';
              return (
                <tr key={n.id} className={status === 'down' ? 'row-down' : ''} onDoubleClick={() => app.openDialog((close) => <NodeDetailsDialog node={n} onClose={close} />)}>
                  <td>
                    <span className={`mdot ${status === 'down' ? 'blink' : ''}`} style={{ background: STATUS_COLORS[status] }} title={STATUS_LABELS[status]} />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Icon name={kindIcon(n.kind)} size={15} />
                      <b>{n.name}</b>
                    </div>
                    {s?.sysName && s.sysName !== n.name && <div className="small muted">{s.sysName}</div>}
                  </td>
                  <td className="mono small">{n.host}</td>
                  <td className="small">{n.method === 'ping' ? 'ping' : n.method === 'snmp' ? `SNMP v${n.snmpVersion === 1 ? '1' : '2c'}` : `TCP ${n.tcpPort}`}</td>
                  <td className="small">
                    <span style={{ color: STATUS_COLORS[status] }}>{STATUS_LABELS[status]}</span>
                    {status !== 'unknown' && status !== 'paused' && <span className="muted"> {sinceText(s?.since)}</span>}
                    {(status === 'warn' || status === 'down') && s?.message && <div className="muted">{s.portsDown.length ? `упал порт: ${s.portsDown.map((p) => p.label).join(', ')}` : s.message}</div>}
                  </td>
                  <td className="small">{s?.latencyMs != null && status !== 'down' ? `${s.latencyMs} мс` : '—'}</td>
                  <td>
                    <div className="btn-row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      <Button size="sm" variant="ghost" iconOnly icon="refresh" title="Проверить сейчас" disabled={busy === n.id || !n.enabled} onClick={() => check(n.id)} />
                      <Button size="sm" variant="ghost" iconOnly icon="info" title="Подробнее, история и порты" onClick={() => app.openDialog((close) => <NodeDetailsDialog node={n} onClose={close} />)} />
                      <Button size="sm" variant="ghost" iconOnly icon="edit" title="Изменить" onClick={() => app.openDialog((close) => <NodeEditor node={n} onClose={close} />)} />
                      <Button size="sm" variant="ghost" iconOnly icon="trash" title="Удалить" onClick={() => remove(n)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <Empty title="Ничего не найдено">{filter !== 'all' ? 'Проблемных узлов нет.' : 'Измените поиск.'}</Empty>}
      </div>
    </div>
  );
}

// ---------- События ----------

function EventsTab() {
  const app = useApp();
  const mon = useMonitor();
  const [all, setAll] = useState(mon.events);
  const [level, setLevel] = useState<'all' | 'problems' | 'traps'>('all');
  const [q, setQ] = useState('');
  useEffect(() => {
    void api.monitor.events({ limit: 2000 }).then(setAll);
  }, [mon.events.length]);
  const list = all
    .filter((e) => level === 'all' || (level === 'traps' ? e.type === 'trap' : e.level === 'crit' || e.level === 'warn'))
    .filter((e) => !q.trim() || `${e.nodeName} ${e.message}`.toLowerCase().includes(q.trim().toLowerCase()));
  const clear = async () => {
    if (!(await app.confirm({ title: 'Очистить журнал событий?', text: 'Все записи журнала мониторинга будут удалены.', okText: 'Очистить', danger: true }))) return;
    await api.monitor.clearEvents();
    setAll([]);
  };
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="col-header">
        <input className="input" style={{ flex: 1 }} placeholder="Поиск по узлу или тексту…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {(
            [
              ['all', 'Все'],
              ['problems', 'Проблемы'],
              ['traps', 'Трапы']
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={level === id ? 'on' : ''} onClick={() => setLevel(id)}>
              {label}
            </button>
          ))}
        </div>
        <Button icon="trash" variant="ghost" onClick={clear} disabled={!all.length}>
          Очистить
        </Button>
      </div>
      <div className="mevents" style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto' }}>
        {list.map((e) => (
          <div key={e.id} className={`mevent l-${e.level}`}>
            <span className="t">{new Date(e.ts).toLocaleString('ru-RU')}</span>
            <span className="m">
              {e.nodeName && <b>{e.nodeName} </b>}
              {e.message}
            </span>
          </div>
        ))}
        {!list.length && <Empty icon="history" title="Событий нет" />}
      </div>
    </div>
  );
}
