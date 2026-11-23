// Сессии: вкладки (SSH, Telnet, COM-порт), терминал xterm.js, разделение экрана, ввод во все сессии,
// окно команд, быстрые команды, справочник в соседней панели, SFTP, туннели.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { api } from '../api';
import { useApp, errMsg, type OpenSession } from '../lib/store';
import * as terms from '../lib/terminals';
import { Icon } from '../lib/icons';
import { Banner, Button, Check, Empty, Field, Modal, PopupMenu, RiskBadge, Splitter, StatusDot, askText, useDebounced, type MenuEntry } from '../components/ui';
import { CommandCard, execSpecFor } from '../components/Commands';
import { CommandListItem } from './ReferenceView';
import { colorCss, blankDevice, PROTOCOL_LABELS } from '../components/DeviceEditor';
import { getPlatform } from '../../shared/platforms';
import { parseQuickAddress } from '../../shared/address';
import { classifyCommand, maxRisk, RISK_LABELS } from '../../shared/risk';
import type { CommandRecord, RiskLevel, SftpEntry, TunnelSpec } from '../../shared/types';
import { fmtDate, fmtSize, plural } from '../lib/format';

const MAX_PANES = 4;

/** Действие раздела «Сессии» из любого места программы (Ctrl+K, главная). */
export function sessionsAction(app: ReturnType<typeof useApp>, action: 'split' | 'compose'): void {
  if (!app.sessions.length) {
    app.toast('Сначала подключитесь хотя бы к одному устройству.', 'warn');
    app.openDialog((close) => <QuickConnect onClose={close} />);
    return;
  }
  app.setSection('sessions');
  setTimeout(() => window.dispatchEvent(new CustomEvent('nad:sessions-action', { detail: action })), 0);
}

const isLive = (s: OpenSession) => s.status === 'ready' || s.status === 'connecting' || s.status === 'authenticating';

export function SessionsView({ visible }: { visible: boolean }) {
  const app = useApp();
  const active = app.sessions.find((s) => s.key === app.activeSession) ?? null;
  const [ratio, setRatio] = useState(app.settings.splitRatio || 0.62);
  const [search, setSearch] = useState<{ key: string; q: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [layout, setLayout] = useState<string[]>([]);
  const [broadcast, setBroadcast] = useState(false);
  const [compose, setCompose] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  // Разделённый экран: только существующие вкладки; меньше двух — обычный режим.
  const panes = layout.filter((k) => app.sessions.some((s) => s.key === k));
  const split = panes.length > 1;
  const shownKeys = split ? panes : active ? [active.key] : [];
  useEffect(() => {
    if (panes.length !== layout.length) setLayout(panes);
  }, [panes, layout.length]);
  useEffect(() => {
    if (!split && broadcast) setBroadcast(false);
  }, [split, broadcast]);
  useEffect(() => {
    app.setBroadcast(broadcast && split ? panes : null);
  }, [app, broadcast, split, panes.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  // В разделённом экране активная вкладка — одна из панелей.
  useEffect(() => {
    if (split && app.activeSession && !panes.includes(app.activeSession)) app.setActiveSession(panes[0]);
  }, [split, app.activeSession, panes.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Закрыть несколько вкладок (как в браузере); активные подключения — с одним подтверждением. */
  const closeMany = async (keys: string[]) => {
    const list = app.sessions.filter((s) => keys.includes(s.key));
    if (!list.length) return;
    const live = list.filter(isLive);
    if (live.length && !(await app.confirm({ title: `Закрыть вкладки: ${list.length}?`, text: `Будут разорваны активные подключения: ${live.map((s) => s.deviceName).join(', ')}.`, okText: 'Закрыть' }))) return;
    for (const s of list) await app.closeSession(s.key);
  };

  const openSplitPicker = useCallback(() => {
    app.openDialog((close) => <SplitPicker initial={panes.length > 1 ? panes : [app.activeSession, ...app.sessions.map((s) => s.key)].filter((k, i, a): k is string => !!k && a.indexOf(k) === i).slice(0, 2)} onClose={close} onApply={(keys) => setLayout(keys)} />);
  }, [app, panes.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBroadcast = async () => {
    if (broadcast) return setBroadcast(false);
    const names = panes.map((k) => app.sessionByKey(k)?.deviceName).join(', ');
    const ok = await app.confirm({
      title: 'Ввод во все сессии',
      text: (
        <>
          <p>
            Всё, что вы печатаете в любой панели, будет отправляться одновременно в <b>{panes.length}</b> {plural(panes.length, 'сессию', 'сессии', 'сессий')}: {names}.
          </p>
          <p className="small muted">Вывод всех устройств виден на экране. Перед изменяющими командами убедитесь, что они подходят каждому устройству (синтаксис у производителей разный).</p>
        </>
      ),
      okText: 'Включить'
    });
    if (ok) setBroadcast(true);
  };

  // Действия из Ctrl+K и главной
  useEffect(() => {
    const h = (e: Event) => {
      const a = (e as CustomEvent<string>).detail;
      if (a === 'split') openSplitPicker();
      if (a === 'compose') setCompose(true);
    };
    window.addEventListener('nad:sessions-action', h);
    return () => window.removeEventListener('nad:sessions-action', h);
  }, [openSplitPicker]);

  // Пересчёт размеров при показе раздела, смене вкладки, изменении панели
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      for (const k of shownKeys) {
        const s = app.sessionByKey(k);
        const sz = terms.fitTerminal(k);
        if (s && sz && !s.pending) void api.ssh.resize(s.id, sz.cols, sz.rows);
      }
      if (active) terms.focusTerminal(active.key);
    }, 30);
    return () => clearTimeout(t);
  }, [visible, active?.key, app.splitOpen, ratio, shownKeys.join('|'), compose, app.settings.quickCommandsBar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl + колесо мыши — размер шрифта терминала (как в браузере и Windows Terminal)
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    let pending = app.settings.terminalFontSize;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      pending = Math.max(9, Math.min(28, pending + (e.deltaY < 0 ? 1 : -1)));
      clearTimeout(timer);
      timer = setTimeout(() => void app.updateSettings({ terminalFontSize: pending }), 120);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => {
      el.removeEventListener('wheel', h);
      clearTimeout(timer);
    };
  }, [app, app.settings.terminalFontSize, app.sessions.length]);

  // Вставка (с подтверждением для многострочного текста) и поиск в выводе
  useEffect(() => {
    const paste = async (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      const s = app.sessionByKey(key);
      if (!s || s.pending) return;
      const text = await api.app.clipboardRead();
      if (!text) return;
      const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim()).length;
      const many = broadcast && split && panes.includes(key) ? panes.length : 1;
      if (lines > 1 || many > 1) {
        const ok = await app.confirm({
          title: lines > 1 ? 'Вставить несколько строк?' : 'Вставить во все сессии?',
          text: (
            <>
              <p>
                Будет вставлено строк: <b>{lines}</b> {many > 1 ? <>во все сессии разделённого экрана (<b>{many}</b>)</> : <>в сессию <b>{s.deviceName}</b></>}. Каждая строка выполнится как команда.
              </p>
              <pre className="output" style={{ maxHeight: 200 }}>
                {text.slice(0, 2000)}
              </pre>
            </>
          ),
          okText: 'Вставить'
        });
        if (!ok) return;
      }
      terms.pasteToTerminal(key, text);
    };
    const find = (e: Event) => setSearch({ key: (e as CustomEvent<string>).detail, q: '' });
    window.addEventListener('nad:paste', paste);
    window.addEventListener('nad:term-search', find);
    return () => {
      window.removeEventListener('nad:paste', paste);
      window.removeEventListener('nad:term-search', find);
    };
  }, [app, broadcast, split, panes.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => void api.settings.set({ splitRatio: ratio }), 500);
    return () => clearTimeout(t);
  }, [ratio]);

  const newSession = () => app.openDialog((close) => <QuickConnect onClose={close} />);

  if (!app.sessions.length) {
    return (
      <div className="page">
        <Empty icon="terminal" title="Нет открытых сессий">
          Откройте устройство в разделе «Устройства» или нажмите «Подключиться». Можно сразу ввести адрес: <code>admin@10.0.0.1</code>, <code>telnet://10.0.0.2</code> или <code>COM3</code>.
          <div style={{ marginTop: 14 }}>
            <Button variant="primary" icon="plug" onClick={newSession}>
              Подключиться
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  const tabMenu = (x: number, y: number, key: string) => {
    const idx = app.sessions.findIndex((s) => s.key === key);
    const cur = app.sessions[idx];
    if (!cur) return;
    const keys = app.sessions.map((s) => s.key);
    const left = keys.slice(0, idx);
    const right = keys.slice(idx + 1);
    const others = keys.filter((k) => k !== cur.key);
    const dead = app.sessions.filter((s) => s.status === 'closed' || s.status === 'error').map((s) => s.key);
    const inSplit = panes.includes(key);
    const items: MenuEntry[] = [
      { label: 'Переподключиться', icon: 'refresh', onClick: () => void app.reconnect(cur.key) },
      { label: `Ещё одна сессия к «${cur.deviceName}»`, icon: 'plus', onClick: () => void app.connect(cur.deviceId) },
      { sep: true },
      inSplit
        ? { label: 'Убрать из разделённого экрана', icon: 'columns', onClick: () => setLayout(panes.filter((k) => k !== key)) }
        : {
            label: split ? 'Добавить в разделённый экран' : 'Показать рядом с текущей',
            icon: 'columns',
            disabled: app.sessions.length < 2 || panes.length >= MAX_PANES,
            onClick: () => setLayout(split ? [...panes, key] : [app.activeSession && app.activeSession !== key ? app.activeSession : (others[0] ?? key), key])
          },
      { sep: true },
      { label: 'Закрыть', icon: 'x', onClick: () => void closeMany([cur.key]) },
      { label: `Закрыть другие вкладки (${others.length})`, icon: 'x', disabled: !others.length, onClick: () => void closeMany(others) },
      { label: `Закрыть вкладки слева (${left.length})`, icon: 'chevronLeft', disabled: !left.length, onClick: () => void closeMany(left) },
      { label: `Закрыть вкладки справа (${right.length})`, icon: 'chevronRight', disabled: !right.length, onClick: () => void closeMany(right) },
      { label: `Закрыть отключённые (${dead.length})`, icon: 'unplug', disabled: !dead.length, onClick: () => void closeMany(dead) },
      { sep: true },
      { label: `Закрыть все вкладки (${keys.length})`, icon: 'trash', onClick: () => void closeMany(keys) }
    ];
    setMenu({ x, y, items });
  };

  const termMenu = (x: number, y: number, key: string) =>
    setMenu({
      x,
      y,
      items: [
        { label: 'Копировать', icon: 'copy', onClick: () => void (terms.terminalSelection(key) && app.copy(terms.terminalSelection(key))) },
        { label: 'Вставить', icon: 'clipboard', onClick: () => window.dispatchEvent(new CustomEvent('nad:paste', { detail: key })) },
        { label: 'Найти в выводе', icon: 'search', onClick: () => setSearch({ key, q: '' }) },
        { label: 'Очистить экран', icon: 'trash', onClick: () => terms.clearTerminal(key) }
      ]
    });

  const gridClass = split ? `split-grid n${Math.min(panes.length, MAX_PANES)}` : '';

  return (
    <div className="sessions">
      <div className="tabs">
        {app.sessions.map((s, i) => {
          const dev = app.devices.find((d) => d.id === s.deviceId);
          return (
            <div
              key={s.key}
              className={`tab ${s.key === app.activeSession ? 'active' : ''} ${panes.includes(s.key) && split ? 'in-split' : ''}`}
              onClick={() => (split && !panes.includes(s.key) ? setLayout([]) : undefined, app.setActiveSession(s.key))}
              onAuxClick={(e) => {
                // Средняя кнопка мыши закрывает вкладку, как в браузере
                if (e.button === 1) {
                  e.preventDefault();
                  void closeMany([s.key]);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                tabMenu(e.clientX, e.clientY, s.key);
              }}
              title={`${s.deviceName} — ${s.host} (${PROTOCOL_LABELS[s.protocol ?? 'ssh']}, Alt+${i + 1}). Правая кнопка — меню вкладок, средняя — закрыть.`}
            >
              {dev?.color && <span className="tab-color" style={{ background: colorCss(dev.color) }} />}
              <StatusDot status={s.status} />
              <span className="name">{s.deviceName}</span>
              {s.protocol && s.protocol !== 'ssh' && <span className={`proto-badge ${s.protocol}`}>{s.protocol === 'telnet' ? 'TELNET' : 'COM'}</span>}
              <button
                className="btn ghost icon sm close"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (s.status === 'ready' && !(await app.confirm({ title: 'Закрыть сессию?', text: `Отключиться от «${s.deviceName}»?`, okText: 'Закрыть' }))) return;
                  await app.closeSession(s.key);
                }}
                title="Закрыть"
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          );
        })}
        <button className="tab" onClick={newSession} title="Подключиться (устройство или адрес)">
          <Icon name="plus" size={14} />
        </button>
      </div>
      {active && (
        <SessionToolbar
          s={active}
          split={split}
          broadcast={broadcast}
          compose={compose}
          onSearch={() => setSearch({ key: active.key, q: '' })}
          onSplit={() => (split ? setLayout([]) : openSplitPicker())}
          onBroadcast={() => void toggleBroadcast()}
          onCompose={() => setCompose(!compose)}
        />
      )}
      {broadcast && split && (
        <div className="broadcast-bar">
          <Icon name="broadcast" size={15} />
          <span>
            Ввод во все сессии: <b>{panes.map((k) => app.sessionByKey(k)?.deviceName).join(', ')}</b>
          </span>
          <div className="grow" />
          <Button size="sm" onClick={() => setBroadcast(false)}>
            Выключить
          </Button>
        </div>
      )}
      {app.settings.quickCommandsBar && active && <QuickBar s={active} />}
      <div className="session-body">
        <div ref={areaRef} className={`term-area ${gridClass}`} style={app.splitOpen ? { flex: `0 0 ${ratio * 100}%` } : undefined}>
          {app.sessions.map((s) => {
            const shown = shownKeys.includes(s.key);
            const order = split ? panes.indexOf(s.key) : 0;
            return (
              <div
                key={s.key}
                className={`pane ${shown ? '' : 'hidden'} ${split && s.key === app.activeSession ? 'focused' : ''} ${broadcast && split && shown ? 'broadcasting' : ''}`}
                style={split ? { order } : undefined}
                onMouseDown={() => split && s.key !== app.activeSession && app.setActiveSession(s.key)}
                onContextMenu={(e) => (e.preventDefault(), termMenu(e.clientX, e.clientY, s.key))}
              >
                {split && shown && (
                  <div className="pane-head">
                    <StatusDot status={s.status} />
                    <b className="ellipsis">{s.deviceName}</b>
                    <span className="muted small mono ellipsis">{s.host}</span>
                    <div className="grow" />
                    <button className="btn ghost icon sm" title="Только эта сессия (выйти из разделения)" onClick={(e) => (e.stopPropagation(), setLayout([]), app.setActiveSession(s.key))}>
                      <Icon name="maximize" size={13} />
                    </button>
                    <button className="btn ghost icon sm" title="Убрать из разделённого экрана" onClick={(e) => (e.stopPropagation(), setLayout(panes.filter((k) => k !== s.key)))}>
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                )}
                <TermHost s={s} hidden={!shown} />
                {shown && s.status !== 'ready' && !s.pending && (
                  <div className="term-overlay" style={{ alignItems: 'end', paddingBottom: 30 }}>
                    <div className="card" style={{ pointerEvents: 'auto', textAlign: 'center', maxWidth: 560 }}>
                      <div style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{s.status === 'error' ? `Ошибка: ${s.error ?? ''}` : 'Соединение закрыто'}</div>
                      <div className="row" style={{ justifyContent: 'center' }}>
                        <Button variant="primary" icon="refresh" onClick={() => void app.reconnect(s.key)}>
                          Переподключиться
                        </Button>
                        <Button icon="plug" onClick={() => void probeConnection(app, s)}>
                          Проверка связи
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {search && search.key === s.key && shown && <TermSearch k={search.key} onClose={() => (terms.clearSearch(search.key), setSearch(null), terms.focusTerminal(search.key))} />}
              </div>
            );
          })}
        </div>
        {app.splitOpen && active && (
          <>
            <Splitter onRatio={setRatio} />
            <div className="side-panel" style={{ flex: 1 }}>
              <SideReference session={active} />
            </div>
          </>
        )}
      </div>
      {compose && active && <CommandWindow active={active} panes={split ? panes : []} onClose={() => setCompose(false)} />}
      {menu && <PopupMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function TermHost({ s, hidden }: { s: OpenSession; hidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) terms.attachTerminal(s.key, ref.current);
  }, [s.key]);
  useEffect(() => {
    if (!hidden && ref.current) {
      const ro = new ResizeObserver(() => {
        const sz = terms.fitTerminal(s.key);
        if (sz && !s.pending && s.status === 'ready') void api.ssh.resize(s.id, sz.cols, sz.rows);
      });
      ro.observe(ref.current);
      return () => ro.disconnect();
    }
  }, [hidden, s.key, s.id, s.pending, s.status]);
  return <div ref={ref} className={`term-host ${hidden ? 'hidden' : ''}`} />;
}

/** Выбор сессий для разделённого экрана (до четырёх). */
function SplitPicker({ initial, onClose, onApply }: { initial: string[]; onClose: () => void; onApply: (keys: string[]) => void }) {
  const app = useApp();
  const [sel, setSel] = useState<string[]>(initial);
  const toggle = (k: string) => setSel((x) => (x.includes(k) ? x.filter((y) => y !== k) : x.length >= MAX_PANES ? x : [...x, k]));
  return (
    <Modal
      title="Разделить экран"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon="grid" disabled={sel.length < 2} onClick={() => (onApply(sel), onClose())}>
            Показать рядом
          </Button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Выберите от двух до четырёх сессий — они будут видны одновременно. Затем можно включить «Ввод во все»: набранное в одной панели уйдёт во все.
      </p>
      {app.sessions.length < 2 && <Banner kind="warn">Откройте хотя бы две сессии.</Banner>}
      {app.sessions.map((s) => (
        <div key={s.key} className="row" style={{ padding: '4px 0' }}>
          <Check label={<><StatusDot status={s.status} /> {s.deviceName} <span className="muted small mono">{s.host}</span></>} checked={sel.includes(s.key)} onChange={() => toggle(s.key)} />
        </div>
      ))}
      {sel.length >= MAX_PANES && <div className="small muted">Максимум {MAX_PANES} панели.</div>}
    </Modal>
  );
}

interface ToolAction {
  id: string;
  label: string;
  icon: string;
  title?: string;
  onClick: () => void;
  /** Показывать кнопкой даже в простом режиме. */
  primary?: boolean;
  /** Кнопка-переключатель во включённом состоянии. */
  on?: boolean;
  disabled?: boolean;
  /** В полном режиме — только значок. */
  iconOnly?: boolean;
  /** Всегда в меню «⋯» (настройки отображения). */
  menuOnly?: boolean;
}

/** Панель сессии: главное на виду, остальное — в меню «⋯ Ещё» (в простом режиме). */
function SessionToolbar({ s, split, broadcast, compose, onSearch, onSplit, onBroadcast, onCompose }: { s: OpenSession; split: boolean; broadcast: boolean; compose: boolean; onSearch: () => void; onSplit: () => void; onBroadcast: () => void; onCompose: () => void }) {
  const app = useApp();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const device = app.devices.find((d) => d.id === s.deviceId);
  const isLinux = s.platform === 'linux';
  const ssh = (s.protocol ?? 'ssh') === 'ssh';
  const ready = s.status === 'ready' && !s.pending;
  const full = app.settings.uiMode === 'full';
  const sessionTunnels = app.tunnels.filter((t) => t.sessionId === s.id);
  const backup = async () => {
    try {
      app.toast('Получение конфигурации… Команды видны в терминале.', 'info');
      const b = await api.backups.fetchSwitchConfig(s.id);
      app.toast(`Резервная копия сохранена (${fmtSize(b.size)})${b.sameAsPrevious ? ', изменений с прошлой копии нет' : ''}`, 'ok');
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const actions: ToolAction[] = [
    { id: 'ref', label: 'Справочник', icon: 'split', primary: true, on: app.splitOpen, title: 'Справочник рядом с терминалом (Ctrl+\\)', onClick: () => app.setSplitOpen(!app.splitOpen) },
    { id: 'compose', label: 'Окно команд', icon: 'command', primary: true, on: compose, title: 'Подготовить несколько строк и отправить в одну или все сессии', onClick: onCompose },
    { id: 'split', label: split ? 'Одна сессия' : 'Разделить экран', icon: 'grid', primary: split, on: split, title: 'Несколько сессий рядом', disabled: !split && app.sessions.length < 2, onClick: onSplit },
    ...(split ? [{ id: 'broadcast', label: 'Ввод во все', icon: 'broadcast', primary: true, on: broadcast, title: 'Набранное в одной панели уходит во все', onClick: onBroadcast }] : []),
    ...(!isLinux
      ? [
          {
            id: 'enable',
            label: 'enable-пароль',
            icon: 'key',
            disabled: !ready,
            title: 'Ввести сохранённый enable-пароль в текущий запрос',
            onClick: async () => {
              const ok = await api.ssh.sendEnable(s.id).catch((e) => (app.toast(errMsg(e), 'error'), true));
              if (!ok) app.toast('Enable-пароль для устройства не сохранён (карточка устройства → Подключение)', 'warn');
            }
          },
          { id: 'config', label: 'Сохранить конфигурацию', icon: 'archive', disabled: !ready, title: 'Сохранить текущую конфигурацию в резервные копии', onClick: () => void backup() }
        ]
      : []),
    ...(isLinux && ssh ? [{ id: 'sftp', label: 'Файлы (SFTP)', icon: 'folder', disabled: !ready, onClick: () => app.openDialog((close) => <SftpDialog s={s} onClose={close} />) }] : []),
    ...(ssh ? [{ id: 'tunnels', label: `Туннели${sessionTunnels.length ? ` (${sessionTunnels.length})` : ''}`, icon: 'route', disabled: !ready, onClick: () => app.openDialog((close) => <TunnelsDialog s={s} onClose={close} />) }] : []),
    { id: 'diag', label: 'Диагностика', icon: 'activity', onClick: () => app.setSection('diagnostics') },
    { id: 'probe', label: 'Проверка связи', icon: 'plug', primary: s.status === 'error', title: 'Проверить, доступен ли порт устройства (без входа)', onClick: () => void probeConnection(app, s) },
    { id: 'quick', label: 'Панель быстрых команд', icon: 'zap', menuOnly: true, on: app.settings.quickCommandsBar, onClick: () => void app.updateSettings({ quickCommandsBar: !app.settings.quickCommandsBar }) },
    { id: 'hl', label: 'Подсветка вывода', icon: 'type', menuOnly: true, on: app.settings.terminalHighlight, title: 'up/down, ошибки, IP и MAC-адреса цветом', onClick: () => void app.updateSettings({ terminalHighlight: !app.settings.terminalHighlight }) }
  ];
  const inline = actions.filter((a) => !a.menuOnly && (a.primary || full));
  const inMenu = actions.filter((a) => a.menuOnly || !(a.primary || full));
  return (
    <div className="session-toolbar">
      <StatusDot status={s.status} />
      <b>{s.deviceName}</b>
      <span className="muted small mono ellipsis">
        {s.protocol === 'serial' ? `${s.host} · ${device?.serialBaud ?? 9600} бод` : `${device?.username ? `${device.username}@` : ''}${s.host}`}
      </span>
      <span className="badge outline">{getPlatform(s.platform).name}</span>
      {s.protocol === 'telnet' && (
        <span className="badge warn" title="Telnet не шифрует трафик">
          Telnet без шифрования
        </span>
      )}
      {(app.settings.readOnlyMode || device?.readOnly) && <span className="badge warn">только чтение</span>}
      <div className="grow" />
      {inline.map((a) => (
        <Button key={a.id} size="sm" variant={a.on ? 'primary' : a.id === 'probe' && s.status === 'error' ? 'primary' : 'default'} icon={a.icon} disabled={a.disabled} title={a.title ?? a.label} onClick={a.onClick}>
          {a.label}
        </Button>
      ))}
      <Button size="sm" variant="ghost" icon="more" title="Ещё действия" onClick={(e: MouseEvent<HTMLElement>) => setMenu({ x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().bottom + 4 })}>
        {full ? '' : 'Ещё'}
      </Button>
      <Button size="sm" variant="ghost" iconOnly icon="search" title="Поиск в выводе (Ctrl+Shift+F)" onClick={onSearch} />
      <Button size="sm" variant="ghost" iconOnly icon="trash" title="Очистить экран" onClick={() => terms.clearTerminal(s.key)} />
      <Button size="sm" variant="ghost" iconOnly icon="refresh" title="Переподключиться" onClick={() => void app.reconnect(s.key)} />
      {menu && (
        <PopupMenu
          x={menu.x}
          y={menu.y}
          align="right"
          onClose={() => setMenu(null)}
          items={[
            ...inMenu.filter((a) => !a.menuOnly).map((a) => ({ label: a.label, icon: a.icon, disabled: a.disabled, title: a.title, active: a.on, onClick: a.onClick })),
            ...(inMenu.some((a) => !a.menuOnly) ? [{ sep: true }] : []),
            { header: 'Вид' },
            ...inMenu.filter((a) => a.menuOnly).map((a) => ({ label: a.label, icon: a.icon, title: a.title, active: a.on, onClick: a.onClick })),
            { label: `Шрифт терминала: ${app.settings.terminalFontSize} (Ctrl + колесо мыши)`, icon: 'type', onClick: () => app.setSection('settings') }
          ]}
        />
      )}
    </div>
  );
}

/** Панель быстрых команд: избранные команды для платформы текущей сессии. */
function QuickBar({ s }: { s: OpenSession }) {
  const app = useApp();
  const kind = s.platform === 'linux' ? 'linux' : 'switch';
  const list = useMemo(() => app.commands.filter((c) => c.favorite && (c.kind === kind || (kind === 'linux' && c.kind === 'sql')) && (kind !== 'switch' || c.platform === s.platform)).slice(0, 24), [app.commands, kind, s.platform]);
  return (
    <div className="quick-bar">
      <Icon name="zap" size={14} />
      {!list.length && <span className="small muted">Отметьте нужные команды звёздочкой в справочнике ({getPlatform(s.platform).name}) — они появятся здесь кнопками.</span>}
      {list.map((c) => (
        <button key={c.id} className="chip" title={`${c.command}\n${RISK_LABELS[c.risk]}`} onClick={() => app.execute(execSpecFor(c, undefined, s.key))}>
          {c.title}
        </button>
      ))}
    </div>
  );
}

/**
 * Окно команд (как Command window в SecureCRT): несколько строк готовятся заранее и отправляются
 * в текущую сессию или во все сессии разделённого экрана. Риск оценивается до отправки.
 */
function CommandWindow({ active, panes, onClose }: { active: OpenSession; panes: string[]; onClose: () => void }) {
  const app = useApp();
  const [text, setText] = useState('');
  const [target, setTarget] = useState<'current' | 'split' | 'all'>(panes.length > 1 ? 'split' : 'current');
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const [sugSel, setSugSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ta.current?.focus(), []);
  useEffect(() => {
    if (target === 'split' && panes.length < 2) setTarget('current');
  }, [panes.length, target]);

  const ready = app.sessions.filter((x) => x.status === 'ready' && !x.pending);
  const targets = target === 'current' ? [active] : target === 'split' ? ready.filter((x) => panes.includes(x.key)) : ready;
  const risk: RiskLevel = text.trim() ? targets.reduce<RiskLevel>((r, t) => maxRisk(r, classifyCommand(text, t.platform === 'linux' ? 'linux' : 'switch', t.platform).level), 'info') : 'info';

  // Подсказки из справочника по текущей строке
  const caret = ta.current?.selectionStart ?? text.length;
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = text.indexOf('\n', caret) < 0 ? text.length : text.indexOf('\n', caret);
  const line = text.slice(lineStart, lineEnd);
  const dl = useDebounced(line, 100);
  const kind = active.platform === 'linux' ? 'linux' : 'switch';
  const suggestions = useMemo(() => {
    if (dl.trim().length < 2) return [];
    return app.index
      .search(dl, { groups: kind === 'linux' ? ['linux', 'sql'] : [kind], platform: kind === 'switch' ? active.platform : undefined, includeSensitive: false }, 6)
      .filter((h) => !h.partial)
      .map((h) => (h.doc.ref as { item: CommandRecord }).item)
      .filter((c) => c.command.split('\n')[0].trim() !== dl.trim());
  }, [dl, app.index, kind, active.platform]);
  useEffect(() => setSugSel(0), [suggestions.length, dl]);

  const insert = (c: CommandRecord) => {
    const cmd = c.template ?? c.command;
    const next = text.slice(0, lineStart) + cmd + text.slice(lineEnd);
    setText(next);
    setTimeout(() => {
      const pos = lineStart + cmd.length;
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    }, 0);
  };

  const send = async () => {
    const cmd = text.replace(/\s+$/, '');
    if (!cmd.trim() || busy) return;
    if (!targets.length) return app.toast('Нет подключённых сессий для отправки', 'warn');
    if (/\{\{[A-Z0-9_]+\}\}/.test(cmd)) return app.toast('В тексте остались параметры {{…}} — замените их значениями.', 'warn');
    if (targets.length > 1 && risk !== 'info' && !app.settings.allowMassConfig)
      return app.toast('Изменяющие команды сразу в несколько сессий запрещены. Разрешить: «Настройки → Безопасность → Массовое выполнение». Или отправьте в одну сессию.', 'warn');
    if (risk !== 'info' && (app.settings.confirmChangeCommands || targets.length > 1)) {
      const ok = await app.confirm({
        title: `Отправить: ${RISK_LABELS[risk].toLowerCase()}?`,
        danger: risk === 'danger' || risk === 'critical',
        text: (
          <>
            <p>
              <RiskBadge risk={risk} /> Куда: <b>{targets.map((t) => t.deviceName).join(', ')}</b>
            </p>
            <pre className="output" style={{ maxHeight: 220 }}>
              {cmd}
            </pre>
          </>
        ),
        okText: 'Отправить'
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      for (const t of targets) await api.ssh.send(t.id, cmd, { source: 'compose', note: targets.length > 1 ? `окно команд → ${targets.length} сессий` : 'окно команд' });
      setHist((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50));
      setHi(-1);
      setText('');
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
      ta.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length && (e.key === 'Tab' || (e.key === 'ArrowDown' && e.altKey))) {
      e.preventDefault();
      if (e.key === 'Tab') insert(suggestions[sugSel]);
      else setSugSel((x) => (x + 1) % suggestions.length);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      const p = ta.current?.selectionStart ?? text.length;
      setText(text.slice(0, p) + '\n' + text.slice(p));
    } else if (e.key === 'ArrowUp' && !text.includes('\n') && hist.length) {
      e.preventDefault();
      const n = Math.min(hist.length - 1, hi + 1);
      setHi(n);
      setText(hist[n]);
    } else if (e.key === 'ArrowDown' && hi >= 0 && !text.includes('\n')) {
      e.preventDefault();
      const n = hi - 1;
      setHi(n);
      setText(n >= 0 ? hist[n] : '');
    } else if (e.key === 'Escape') onClose();
  };

  return (
    <div className="command-window">
      <div className="cw-head">
        <Icon name="command" size={14} />
        <b>Окно команд</b>
        <span className="small muted">Enter — отправить, Shift+Enter — новая строка, Tab — подставить подсказку, ↑ — история</span>
        <div className="grow" />
        <span className="small muted">Куда:</span>
        <div className="seg">
          <button className={target === 'current' ? 'on' : ''} onClick={() => setTarget('current')} title={active.deviceName}>
            {active.deviceName}
          </button>
          {panes.length > 1 && (
            <button className={target === 'split' ? 'on' : ''} onClick={() => setTarget('split')}>
              Экран ({panes.length})
            </button>
          )}
          <button className={target === 'all' ? 'on' : ''} onClick={() => setTarget('all')}>
            Все подключённые ({ready.length})
          </button>
        </div>
        <Button size="sm" variant="ghost" iconOnly icon="x" title="Закрыть (Esc)" onClick={onClose} />
      </div>
      <div className="cw-body">
        <textarea ref={ta} className="textarea mono" rows={3} value={text} onChange={(e) => (setText(e.target.value), setHi(-1))} onKeyDown={onKey} spellCheck={false} placeholder={kind === 'linux' ? 'например: df -h' : 'например: show interfaces status'} />
        <div className="cw-side">
          {text.trim() && <RiskBadge risk={risk} />}
          <Button variant="primary" icon="play" disabled={!text.trim() || busy || !targets.length} onClick={() => void send()}>
            Отправить{targets.length > 1 ? ` (${targets.length})` : ''}
          </Button>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="cw-suggest">
          {suggestions.map((c, i) => (
            <button key={c.id} className={i === sugSel ? 'sel' : ''} onMouseDown={(e) => (e.preventDefault(), insert(c))} title={c.description}>
              <span className="mono">{(c.template ?? c.command).split('\n')[0]}</span>
              <span className="muted small ellipsis">{c.title}</span>
              <RiskBadge risk={c.risk} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Подключение: к сохранённому устройству или сразу по адресу (user@host:port, telnet://host, COM3). */
export function QuickConnect({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const list = app.devices.filter((d) => `${d.name} ${d.host} ${d.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const addr = parseQuickAddress(q);
  const exact = addr && app.devices.find((d) => d.host === addr.host && d.port === addr.port && d.protocol === addr.protocol && (!addr.username || d.username === addr.username));
  const connectAddress = async () => {
    if (!addr) return;
    if (exact) return (onClose(), void app.connect(exact.id));
    try {
      const saved = await api.devices.save({
        ...blankDevice(),
        name: addr.protocol === 'serial' ? `Консоль ${addr.host}` : addr.host,
        host: addr.host,
        port: addr.port,
        username: addr.username,
        protocol: addr.protocol,
        platform: 'generic-ssh',
        deviceType: 'other',
        tags: ['быстрое подключение'],
        description: 'Создано быстрым подключением. Укажите тип устройства в карточке, чтобы справочник и диагностика подбирали правильные команды.'
      });
      await app.refresh('devices');
      onClose();
      void app.connect(saved.id);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <Modal title="Подключиться" onClose={onClose}>
      <input
        className="input mono"
        autoFocus
        placeholder="Устройство или адрес: admin@10.0.0.1, 10.0.0.1:2222, telnet://10.0.0.2, COM3"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (list[0]) return (onClose(), void app.connect(list[0].id));
          if (addr) void connectAddress();
        }}
      />
      <div style={{ maxHeight: 380, overflowY: 'auto', marginTop: 10 }}>
        {addr && !list.length && (
          <div className="list-item" onClick={() => void connectAddress()}>
            <div className="title">
              <Icon name={addr.protocol === 'serial' ? 'usb' : 'plug'} size={14} />
              <span className="t">
                Подключиться: {addr.protocol === 'serial' ? addr.host : `${addr.username ? `${addr.username}@` : ''}${addr.host}:${addr.port}`}
              </span>
              <span className={`proto-badge ${addr.protocol}`}>{PROTOCOL_LABELS[addr.protocol]}</span>
            </div>
            <div className="cmd">{exact ? `уже есть устройство «${exact.name}»` : 'будет создано устройство с меткой «быстрое подключение»'}</div>
          </div>
        )}
        {!app.devices.length && !addr && <div className="muted small">Введите адрес или сначала добавьте устройство (кнопка «Устройство» вверху).</div>}
        {list.map((d) => (
          <div key={d.id} className="list-item" onClick={() => (onClose(), void app.connect(d.id))}>
            <div className="title">
              <StatusDot status={d.lastStatus} />
              <span className="t">{d.name}</span>
              {d.protocol !== 'ssh' && <span className={`proto-badge ${d.protocol}`}>{PROTOCOL_LABELS[d.protocol]}</span>}
            </div>
            <div className="cmd">
              {d.protocol === 'serial' ? `${d.host} · ${d.serialBaud} бод` : `${d.username ? `${d.username}@` : ''}${d.host}:${d.port}`} · {getPlatform(d.platform).name}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function TermSearch({ k, onClose }: { k: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(true);
  return (
    <div className="term-search">
      <input
        className={`input ${found ? '' : 'invalid'}`}
        autoFocus
        placeholder="Поиск в выводе…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setFound(terms.searchTerminal(k, e.target.value, 'next'));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setFound(terms.searchTerminal(k, q, e.shiftKey ? 'prev' : 'next'));
          if (e.key === 'Escape') onClose();
        }}
      />
      <Button size="sm" variant="ghost" iconOnly icon="chevronDown" title="Следующее (Enter)" onClick={() => setFound(terms.searchTerminal(k, q, 'next'))} />
      <Button size="sm" variant="ghost" iconOnly icon="x" title="Закрыть (Esc)" onClick={onClose} />
    </div>
  );
}

/** Проверка связи с устройством без входа: DNS → TCP-порт → приветствие SSH. Результат — в терминал. */
export async function probeConnection(app: ReturnType<typeof useApp>, s: OpenSession): Promise<void> {
  terms.writeInfo(s.key, `[проверка связи] ${s.protocol === 'serial' ? `порт ${s.host}` : s.host}…`);
  try {
    const r = await api.ssh.probe(s.deviceId);
    const lines = r.steps.map((st) => `${st.ok ? '\x1b[32m✔' : '\x1b[31m✘'}\x1b[0m ${st.text}`);
    terms.writeTerminal(s.key, `\r\n${lines.join('\r\n')}\r\n\x1b[1m${r.conclusion}\x1b[0m\r\n`);
    app.toast(r.conclusion, r.ok ? 'ok' : 'warn');
  } catch (e) {
    terms.writeInfo(s.key, `[проверка связи не выполнена] ${errMsg(e)}`);
  }
}

function SideReference({ session }: { session: OpenSession }) {
  const app = useApp();
  const isLinux = session.platform === 'linux';
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState<string>(isLinux ? 'linux' : session.platform);
  const [sel, setSel] = useState<CommandRecord | null>(null);
  const dq = useDebounced(q, 80);
  useEffect(() => {
    setPlatform(isLinux ? 'linux' : session.platform);
    setSel(null);
  }, [session.key, isLinux, session.platform]);
  const items = useMemo(() => {
    const groups = isLinux ? ['linux'] : ['switch'];
    return app.index
      .search(dq, { groups: groups as never, platform: platform === 'any' ? undefined : platform, includeSensitive: true }, 400)
      .map((h) => (h.doc.ref as { item: CommandRecord }).item);
  }, [app.index, dq, platform, isLinux]);
  const platforms = useMemo(() => [...new Set(app.commands.filter((c) => c.kind === (isLinux ? 'linux' : 'switch')).map((c) => c.platform))], [app.commands, isLinux]);
  if (sel) {
    return (
      <div style={{ overflowY: 'auto', height: '100%' }}>
        <div className="col-header">
          <Button size="sm" icon="chevronRight" style={{ transform: 'scaleX(-1)' }} onClick={() => setSel(null)} />
          <span className="small muted">Отправка в: <b>{session.deviceName}</b></span>
        </div>
        <CommandCard c={app.commands.find((c) => c.id === sel.id) ?? sel} compact sessionKey={session.key} />
      </div>
    );
  }
  return (
    <>
      <div className="col-header" style={{ flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Поиск команды…" value={q} onChange={(e) => setQ(e.target.value)} />
        {!isLinux && (
          <select className="select" style={{ width: 'auto', maxWidth: 210 }} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="any">Все производители</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {getPlatform(p).name}
              </option>
            ))}
          </select>
        )}
      </div>
      {!isLinux && platform !== session.platform && platform !== 'any' && <div className="small" style={{ padding: '6px 12px', color: 'var(--warn)' }}>Выбрана платформа, отличная от устройства — совместимость будет проверена перед выполнением.</div>}
      <div className="col-body">
        {!items.length && (
          <Empty title="Нет команд">
            {platform === session.platform ? `Для платформы «${getPlatform(platform).name}» записей нет — выберите «Все производители».` : 'Измените запрос.'}
          </Empty>
        )}
        {items.map((c) => (
          <CommandListItem key={c.id} c={c} active={false} onClick={() => setSel(c)} />
        ))}
      </div>
      <div className="small faint" style={{ padding: '6px 12px', borderTop: '1px solid var(--border)' }}>
        {items.length} записей · выберите команду, чтобы скопировать или выполнить в «{session.deviceName}»
      </div>
    </>
  );
}

function SftpDialog({ s, onClose }: { s: OpenSession; onClose: () => void }) {
  const app = useApp();
  const [path, setPath] = useState<string>('');
  const [items, setItems] = useState<SftpEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (p: string) => {
      setBusy(true);
      try {
        setItems(await api.sftp.list(s.id, p));
        setPath(p);
      } catch (e) {
        app.toast(errMsg(e), 'error');
      } finally {
        setBusy(false);
      }
    },
    [s.id, app]
  );
  useEffect(() => {
    void api.sftp.home(s.id).then(load, (e) => app.toast(errMsg(e), 'error'));
  }, [s.id, load, app]);
  const up = () => load(path.replace(/\/[^/]+\/?$/, '') || '/');
  const download = async (e: SftpEntry) => {
    const local = await api.app.selectSaveFile({ title: 'Сохранить файл', defaultPath: e.name });
    if (!local) return;
    try {
      await api.sftp.download(s.id, e.path, local);
      app.toast(`Скачано: ${local}`, 'ok');
    } catch (err) {
      app.toast(errMsg(err), 'error');
    }
  };
  const upload = async () => {
    const local = await api.app.selectFile({ title: 'Файл для загрузки на сервер' });
    if (!local) return;
    const name = local.split(/[\\/]/).pop()!;
    try {
      await api.sftp.upload(s.id, local, `${path.replace(/\/$/, '')}/${name}`);
      app.toast(`Загружено: ${name}`, 'ok');
      await load(path);
    } catch (err) {
      app.toast(errMsg(err), 'error');
    }
  };
  const mkdir = async () => {
    const name = await askText(app.openDialog, 'Новый каталог', `Имя каталога в ${path}`);
    if (!name) return;
    try {
      await api.sftp.mkdir(s.id, `${path.replace(/\/$/, '')}/${name}`);
      await load(path);
    } catch (err) {
      app.toast(errMsg(err), 'error');
    }
  };
  const rename = async (e: SftpEntry) => {
    const name = await askText(app.openDialog, 'Переименовать', 'Новое имя', e.name);
    if (!name || name === e.name) return;
    try {
      await api.sftp.rename(s.id, e.path, `${path.replace(/\/$/, '')}/${name}`);
      await load(path);
    } catch (err) {
      app.toast(errMsg(err), 'error');
    }
  };
  const remove = async (e: SftpEntry) => {
    if (!(await app.confirm({ title: 'Удалить?', text: <>Удалить {e.isDir ? 'каталог (только пустой)' : 'файл'} <code>{e.path}</code> на сервере {s.deviceName}?</>, okText: 'Удалить', danger: true }))) return;
    try {
      await api.sftp.remove(s.id, e.path, e.isDir);
      await load(path);
    } catch (err) {
      app.toast(errMsg(err), 'error');
    }
  };
  return (
    <Modal title={`SFTP: ${s.deviceName}`} width="xwide" onClose={onClose}>
      <div className="row" style={{ marginBottom: 10 }}>
        <Button size="sm" icon="chevronRight" style={{ transform: 'rotate(-90deg)' }} onClick={up} title="Вверх" />
        <input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(path)} />
        <Button size="sm" icon="refresh" onClick={() => load(path)} />
        <Button size="sm" icon="upload" onClick={upload}>
          Загрузить
        </Button>
        <Button size="sm" icon="folder" onClick={mkdir}>
          Каталог
        </Button>
      </div>
      <div style={{ maxHeight: '58vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, opacity: busy ? 0.6 : 1 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Размер</th>
              <th>Права</th>
              <th>Изменён</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.path} onDoubleClick={() => (e.isDir ? load(e.path) : download(e))} style={{ cursor: 'pointer' }}>
                <td>
                  <span className="row">
                    <Icon name={e.isDir ? 'folder' : 'file'} size={14} />
                    {e.name}
                  </span>
                </td>
                <td className="small">{e.isDir ? '' : fmtSize(e.size)}</td>
                <td className="mono small">{e.mode}</td>
                <td className="small muted">{fmtDate(new Date(e.mtime).toISOString())}</td>
                <td>
                  <span className="row" style={{ gap: 2 }}>
                    {!e.isDir && <Button size="sm" variant="ghost" iconOnly icon="download" title="Скачать" onClick={() => download(e)} />}
                    <Button size="sm" variant="ghost" iconOnly icon="edit" title="Переименовать" onClick={() => rename(e)} />
                    <Button size="sm" variant="ghost" iconOnly icon="trash" title="Удалить" onClick={() => remove(e)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function TunnelsDialog({ s, onClose }: { s: OpenSession; onClose: () => void }) {
  const app = useApp();
  const [spec, setSpec] = useState<Omit<TunnelSpec, 'sessionId'>>({ type: 'local', bindHost: '127.0.0.1', bindPort: 8080, targetHost: '', targetPort: 80 });
  const list = app.tunnels.filter((t) => t.sessionId === s.id);
  const start = async () => {
    try {
      await api.tunnels.start({ ...spec, sessionId: s.id });
      app.toast('Туннель запущен', 'ok');
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <Modal title={`SSH-туннели: ${s.deviceName}`} width="wide" onClose={onClose}>
      <div className="grid-3">
        <Field label="Тип">
          <select className="select" value={spec.type} onChange={(e) => setSpec({ ...spec, type: e.target.value as TunnelSpec['type'] })}>
            <option value="local">Local (-L): локальный порт → адрес за сервером</option>
            <option value="remote">Remote (-R): порт на сервере → локальный адрес</option>
            <option value="dynamic">Dynamic (-D): SOCKS5-прокси</option>
          </select>
        </Field>
        <Field label={spec.type === 'remote' ? 'Адрес на сервере' : 'Локальный адрес'}>
          <input className="input mono" value={spec.bindHost} onChange={(e) => setSpec({ ...spec, bindHost: e.target.value })} />
        </Field>
        <Field label="Порт">
          <input className="input mono" type="number" value={spec.bindPort} onChange={(e) => setSpec({ ...spec, bindPort: Number(e.target.value) })} />
        </Field>
      </div>
      {spec.type !== 'dynamic' && (
        <div className="grid-2">
          <Field label={spec.type === 'local' ? 'Целевой адрес (со стороны сервера)' : 'Локальный целевой адрес'}>
            <input className="input mono" value={spec.targetHost} onChange={(e) => setSpec({ ...spec, targetHost: e.target.value })} placeholder="10.10.0.20" />
          </Field>
          <Field label="Целевой порт">
            <input className="input mono" type="number" value={spec.targetPort} onChange={(e) => setSpec({ ...spec, targetPort: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      {spec.bindHost !== '127.0.0.1' && spec.bindHost !== 'localhost' && spec.type !== 'remote' && <Banner kind="warn">Порт будет доступен другим компьютерам сети. Обычно достаточно 127.0.0.1.</Banner>}
      <Button variant="primary" icon="play" onClick={start} disabled={spec.type !== 'dynamic' && !spec.targetHost}>
        Запустить туннель
      </Button>
      <div className="section-title">Активные туннели</div>
      {!list.length && <div className="muted small">Нет активных туннелей. Туннели закрываются вместе с сессией.</div>}
      {list.map((t) => (
        <div key={t.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <span className="badge accent">{t.type}</span>
          <span className="mono small grow">
            {t.bindHost}:{t.bindPort}
            {t.type !== 'dynamic' ? ` → ${t.targetHost}:${t.targetPort}` : ' (SOCKS5)'}
          </span>
          <span className="small muted">соединений: {t.connections}</span>
          <Button size="sm" icon="x" onClick={() => void api.tunnels.stop(t.id)}>
            Остановить
          </Button>
        </div>
      ))}
    </Modal>
  );
}
