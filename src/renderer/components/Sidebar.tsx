// Боковое меню: основные разделы на виду, редкие — в «Ещё» внутри своей группы,
// группы сворачиваются, режим «Простой / Полный», настройка пунктов правой кнопкой мыши.
import { useState, type MouseEvent } from 'react';
import { useApp } from '../lib/store';
import { Icon } from '../lib/icons';
import { useMonitor } from '../lib/monitor';
import { MOD } from '../api';
import { Button, Modal, PopupMenu, type MenuEntry } from './ui';
import { NAV, NAV_GROUPS, hiddenNavCount, isNavShown, type NavItem } from '../lib/navigation';
import { Logo } from './Logo';

export function Sidebar({ onToggleCollapse }: { onToggleCollapse: () => void }) {
  const app = useApp();
  const s = app.settings;
  const rail = s.sidebarCollapsed;
  const mon = useMonitor();
  const locked = app.vault?.mode === 'master' && !app.vault.unlocked;
  const toggleMode = () => void app.updateSettings({ uiMode: s.uiMode === 'simple' ? 'full' : 'simple' });
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const hidden = hiddenNavCount(s);
  const modeTitle = s.uiMode === 'simple' ? `Показать все разделы и все кнопки (полный режим)${hidden > 0 ? ` — сейчас скрыто разделов: ${hidden}` : ''}` : 'Оставить только основное (простой режим)';

  const setOverride = (id: string, v: 'show' | 'more' | null) => {
    const next = { ...s.navOverrides };
    if (v === null) delete next[id];
    else next[id] = v;
    void app.updateSettings({ navOverrides: next });
  };
  const toggleGroup = (g: string) => void app.updateSettings({ navCollapsed: s.navCollapsed.includes(g) ? s.navCollapsed.filter((x) => x !== g) : [...s.navCollapsed, g] });
  const customize = () => app.openDialog((close) => <NavCustomizeDialog onClose={close} />);

  const itemMenu = (e: MouseEvent, n: NavItem) => {
    e.preventDefault();
    const canHide = n.group === 'ref' || n.group === 'tools';
    const shown = isNavShown(n, s);
    const items: MenuEntry[] = [];
    if (canHide) {
      items.push(shown ? { label: 'Убрать в «Ещё»', icon: 'eye', onClick: () => setOverride(n.id, 'more') } : { label: 'Всегда показывать', icon: 'eye', onClick: () => setOverride(n.id, 'show') });
      if (s.navOverrides[n.id]) items.push({ label: 'Как по умолчанию', icon: 'refresh', onClick: () => setOverride(n.id, null) });
      items.push({ sep: true });
    }
    items.push({ label: 'Настроить меню…', icon: 'sliders', onClick: customize });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const renderItem = (n: NavItem, extra = false) => (
    <button
      key={n.id}
      className={`nav-item ${app.section === n.id || (n.id === 'switches' && app.section === 'reference') ? 'active' : ''} ${extra ? 'extra' : ''}`}
      onClick={() => app.setSection(n.id)}
      onContextMenu={(e) => itemMenu(e, n)}
      title={rail ? `${n.label} — ${n.hint}` : n.hint}
    >
      <Icon name={n.icon} size={17} />
      <span>{n.label}</span>
      {n.id === 'sessions' && app.sessions.length > 0 && <span className="count">{app.sessions.length}</span>}
      {n.id === 'devices' && <span className="count">{app.devices.length}</span>}
      {n.id === 'monitor' && (mon.status?.counts.down ?? 0) > 0 && (
        <span className="count danger" title="Не в сети">
          {mon.status!.counts.down}
        </span>
      )}
    </button>
  );

  const isActive = (n: NavItem) => app.section === n.id || (n.id === 'switches' && app.section === 'reference');

  // В узком режиме («рельс») спрятанные пункты открываются всплывающим меню.
  const railMore = (e: MouseEvent) => {
    const list = NAV.filter((n) => !isNavShown(n, s) && !isActive(n));
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.right + 6,
      y: r.top,
      items: [
        ...NAV_GROUPS.flatMap((g) => {
          const items = list.filter((n) => n.group === g.id);
          return items.length ? [{ header: g.label }, ...items.map((n) => ({ label: n.label, icon: n.icon, onClick: () => app.setSection(n.id) }))] : [];
        }),
        { sep: true },
        { label: 'Настроить меню…', icon: 'sliders', onClick: customize }
      ]
    });
  };

  const main = NAV.filter((n) => n.group === 'main');
  const bottom = NAV.filter((n) => n.group === 'bottom');

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={26} className="brand-mark" />
        <span>NetAdmin Desk</span>
      </div>
      <nav className="nav">
        {main.map((n) => renderItem(n))}
        {NAV_GROUPS.map((g) => {
          const items = NAV.filter((n) => n.group === g.id);
          const shown = items.filter((n) => isNavShown(n, s) || isActive(n));
          const more = items.filter((n) => !isNavShown(n, s) && !isActive(n));
          const collapsed = s.navCollapsed.includes(g.id) && !rail;
          return (
            <div key={g.id}>
              <div className="nav-sep" />
              {!rail && (
                <button
                  className={`nav-group-header ${collapsed ? 'collapsed' : ''}`}
                  onClick={() => toggleGroup(g.id)}
                  onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, items: [{ label: collapsed ? 'Развернуть группу' : 'Свернуть группу', icon: 'chevronDown', onClick: () => toggleGroup(g.id) }, { label: 'Настроить меню…', icon: 'sliders', onClick: customize }] }))}
                  title={collapsed ? `Развернуть «${g.label}»` : `Свернуть «${g.label}»`}
                  aria-expanded={!collapsed}
                >
                  <Icon name="chevronDown" size={12} />
                  {g.label}
                  {collapsed && <span className="count">{items.length}</span>}
                </button>
              )}
              {collapsed
                ? // Свёрнутая группа всё равно показывает открытый раздел, чтобы было видно, где вы находитесь.
                  items.filter(isActive).map((n) => renderItem(n))
                : shown.map((n) => renderItem(n))}
              {!collapsed && !rail && more.length > 0 && (
                <>
                  {moreOpen[g.id] && more.map((n) => renderItem(n, true))}
                  <button className="nav-item nav-more" onClick={() => setMoreOpen({ ...moreOpen, [g.id]: !moreOpen[g.id] })} title={moreOpen[g.id] ? 'Скрыть редкие разделы' : `Ещё: ${more.map((n) => n.label).join(', ')}`}>
                    <Icon name={moreOpen[g.id] ? 'chevronDown' : 'more'} size={17} style={moreOpen[g.id] ? { transform: 'rotate(180deg)' } : undefined} />
                    <span>{moreOpen[g.id] ? 'Меньше' : `Ещё ${more.length}`}</span>
                  </button>
                </>
              )}
            </div>
          );
        })}
        {rail && hidden > 0 && (
          <button className="nav-item" onClick={railMore} title={`Ещё разделы (${hidden})`}>
            <Icon name="more" size={17} />
          </button>
        )}
        <div className="nav-sep" />
        {bottom.map((n) => renderItem(n))}
      </nav>
      <div className="sidebar-footer">
        {!rail && app.settings.readOnlyMode && (
          <button className="nav-item" style={{ color: 'var(--warn)' }} onClick={() => app.setSection('settings')} title="Режим «Только чтение» включён">
            <Icon name="shield" size={17} />
            <span>Только чтение</span>
          </button>
        )}
        {!rail && locked && (
          <button className="nav-item" style={{ color: 'var(--warn)' }} onClick={() => app.setSection('settings')} title="Хранилище паролей заблокировано">
            <Icon name="lock" size={17} />
            <span>Пароли заблокированы</span>
          </button>
        )}
        {!rail && (
          <button className="nav-item nav-mode" onClick={toggleMode} title={modeTitle}>
            <Icon name={s.uiMode === 'simple' ? 'maximize' : 'minimize'} size={17} />
            <span>{s.uiMode === 'simple' ? 'Показать всё' : 'Компактный вид'}</span>
            {s.uiMode === 'simple' && hidden > 0 && <span className="count">+{hidden}</span>}
          </button>
        )}
        <div className="sidebar-tools">
          {/* В свёрнутой панели все кнопки внизу — одного размера и выровнены по центру */}
          {rail && app.settings.readOnlyMode && <Button size="sm" variant="ghost" iconOnly icon="shield" className="warn-icon" title="Режим «Только чтение» включён — открыть настройки" onClick={() => app.setSection('settings')} />}
          {rail && locked && <Button size="sm" variant="ghost" iconOnly icon="lock" className="warn-icon" title="Хранилище паролей заблокировано — открыть настройки" onClick={() => app.setSection('settings')} />}
          {rail && (
            <span className="rail-badge-wrap">
              <Button size="sm" variant="ghost" iconOnly icon={s.uiMode === 'simple' ? 'maximize' : 'minimize'} title={modeTitle} onClick={toggleMode} />
              {s.uiMode === 'simple' && hidden > 0 && <span className="rail-badge" />}
            </span>
          )}
          <Button size="sm" variant="ghost" iconOnly icon={s.theme === 'dark' ? 'sun' : 'moon'} title={s.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={() => void app.updateSettings({ theme: s.theme === 'dark' ? 'light' : 'dark' })} />
          <Button size="sm" variant="ghost" iconOnly icon="sliders" title="Настроить меню" onClick={customize} />
          <Button size="sm" variant="ghost" iconOnly icon="sidebar" title={rail ? `Развернуть панель (${MOD}+B)` : `Свернуть панель до значков (${MOD}+B)`} onClick={onToggleCollapse} />
        </div>
      </div>
      {menu && <PopupMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}

/** Настройка меню: режим интерфейса и видимость каждого раздела. */
export function NavCustomizeDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const s = app.settings;
  const set = (id: string, v: 'show' | 'more') => {
    const next = { ...s.navOverrides };
    const def = s.uiMode === 'full' || NAV.find((n) => n.id === id)?.tier === 'core' ? 'show' : 'more';
    if (v === def) delete next[id];
    else next[id] = v;
    void app.updateSettings({ navOverrides: next });
  };
  return (
    <Modal
      title="Настройка меню"
      width="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => void app.updateSettings({ navOverrides: {}, navCollapsed: [] })}>Сбросить</Button>
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        </>
      }
    >
      <div className="mode-cards">
        <button className={`mode-card ${s.uiMode === 'simple' ? 'on' : ''}`} onClick={() => void app.updateSettings({ uiMode: 'simple' })}>
          <b>Простой</b>
          <span className="small muted">Только основные разделы и кнопки. Редкое — в «Ещё» и в меню «⋯». Подходит для обучения и ежедневной работы.</span>
        </button>
        <button className={`mode-card ${s.uiMode === 'full' ? 'on' : ''}`} onClick={() => void app.updateSettings({ uiMode: 'full' })}>
          <b>Полный</b>
          <span className="small muted">Все разделы меню и все кнопки панели сессии на виду. Для тех, кто уже знает программу.</span>
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Каждый раздел можно закрепить или убрать в «Ещё» — независимо от режима. Это же делается правой кнопкой мыши по пункту меню. Любой раздел всегда находится через {MOD}+K.
      </p>
      {NAV_GROUPS.map((g) => (
        <div key={g.id} style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ marginTop: 6 }}>
            {g.label}
          </div>
          {NAV.filter((n) => n.group === g.id).map((n) => {
            const shown = isNavShown(n, s);
            return (
              <div key={n.id} className="nav-custom-row">
                <Icon name={n.icon} size={16} />
                <div className="grow">
                  <div>{n.label}</div>
                  <div className="small faint">{n.hint}</div>
                </div>
                <div className="seg">
                  <button className={shown ? 'on' : ''} onClick={() => set(n.id, 'show')}>
                    На виду
                  </button>
                  <button className={!shown ? 'on' : ''} onClick={() => set(n.id, 'more')}>
                    В «Ещё»
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </Modal>
  );
}
