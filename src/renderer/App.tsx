// Каркас приложения: боковая панель, верхняя панель, разделы, горячие клавиши, диалоги.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, isMac, MOD } from './api';
import { useApp } from './lib/store';
import { NAV, NAV_TITLES } from './lib/navigation';
import { installSerialRuntime } from './lib/serial';
import { NavCustomizeDialog, Sidebar } from './components/Sidebar';
import { NetToolsView, openNetTool } from './views/NetToolsView';
import { Icon } from './lib/icons';
import { Button, Modal } from './components/ui';
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { ExecuteDialog } from './components/ExecuteDialog';
import { PromptHost } from './components/Prompts';
import { DeviceEditor } from './components/DeviceEditor';
import { HomeView } from './views/HomeView';
import { DevicesView, ExportDevicesDialog, ImportDevicesDialog } from './views/DevicesView';
import { QuickConnect, SessionsView, sessionsAction } from './views/SessionsView';
import { NotesPanel, ReferenceView } from './views/ReferenceView';
import { LearnView } from './views/LearnView';
import { FavoritesView } from './views/FavoritesView';
import { ScenariosView } from './views/ScenariosView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { HistoryView } from './views/HistoryView';
import { BackupsView } from './views/BackupsView';
import { SettingsView } from './views/SettingsView';

export function App() {
  const app = useApp();
  const [palette, setPalette] = useState(false);
  const [openScenarioId, setOpenScenarioId] = useState<number | null>(null);
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const collapsed = app.settings.sidebarCollapsed;

  // Обработчик выполнения команд (используется из любого раздела)
  useEffect(() => {
    app.execHandler.current = (spec) => app.openDialog((close) => <ExecuteDialog spec={spec} onClose={close} />);
  }, [app]);

  const toggleSidebar = useCallback(() => void app.updateSettings({ sidebarCollapsed: !app.settings.sidebarCollapsed }), [app]);

  const showHotkeys = useCallback(
    () =>
      app.openDialog((close) => (
        <Modal title="Горячие клавиши" onClose={close} footer={<Button onClick={close}>Закрыть</Button>}>
          <table className="table">
            <tbody>
              {[
                [`${MOD}+K`, 'Быстрый поиск по всей базе (из любого раздела)'],
                [`${MOD}+Shift+K`, 'Быстрый поиск, если Ctrl+K передаётся в терминал'],
                [`${MOD}+N`, 'Новое устройство'],
                [`${MOD}+B`, 'Свернуть / развернуть боковую панель'],
                [`${MOD}+\\`, 'Терминал + справочник в двух панелях'],
                ['Ctrl+Tab / Ctrl+Shift+Tab', 'Следующая / предыдущая вкладка сессии'],
                ['Alt+1…9', 'Перейти к вкладке сессии по номеру'],
                [`${MOD}+Shift+W`, 'Закрыть текущую сессию'],
                [`${MOD}+Shift+F`, 'Поиск в выводе терминала'],
                [isMac ? '⌘C / ⌘V' : 'Ctrl+Shift+C / Ctrl+Shift+V', 'Копировать / вставить в терминале'],
                [`${MOD}+= / ${MOD}+- / ${MOD}+0`, 'Масштаб интерфейса'],
                [`${MOD} + колесо мыши над терминалом`, 'Размер шрифта терминала'],
                ['Правая кнопка по вкладке', 'Закрыть слева / справа / другие, показать рядом (разделить экран)'],
                ['Правая кнопка по пункту меню', 'Закрепить раздел или убрать в «Ещё»'],
                ['F1', 'Эта справка']
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ width: 230 }}>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            В терминале {MOD}+K по умолчанию открывает поиск приложения. Если нужно передавать это сочетание в CLI (удаление до конца строки), включите опцию в «Настройки → Терминал».
          </p>
        </Modal>
      )),
    [app]
  );

  const showAbout = useCallback(
    () =>
      app.openDialog((close) => (
        <Modal title="О программе" onClose={close} footer={<Button onClick={close}>Закрыть</Button>}>
          <h2 style={{ margin: '0 0 6px' }}>NetAdmin Desk {app.info?.version}</h2>
          <p className="muted">Рабочее место системного администратора: SSH-клиент для коммутаторов и Linux-серверов, справочник команд, диагностика и сценарии.</p>
          <dl className="kv">
            <dt>Electron / Chromium / Node</dt>
            <dd>
              {app.info?.electron} / {app.info?.chrome} / {app.info?.node}
            </dd>
            <dt>Платформа</dt>
            <dd>
              {app.info?.platform} {app.info?.arch}
            </dd>
            <dt>База данных</dt>
            <dd className="mono small">{app.info?.dbPath}</dd>
            <dt>Схема БД / драйвер</dt>
            <dd>
              v{app.info?.schemaVersion} / {app.info?.dbDriver}
            </dd>
          </dl>
          <p className="small muted">Работает полностью офлайн. Телеметрия не собирается, данные не передаются на сторонние серверы.</p>
        </Modal>
      )),
    [app]
  );

  // COM-порт: окно программы открывает порт по команде main-процесса
  useEffect(() => installSerialRuntime(), []);

  // Меню приложения
  useEffect(
    () =>
      api.on((e) => {
        if (e.type !== 'menu') return;
        if (e.action === 'search') setPalette(true);
        else if (e.action === 'new-device') app.openDialog((close) => <DeviceEditor onClose={close} />);
        else if (e.action === 'toggle-sidebar') toggleSidebar();
        else if (e.action === 'toggle-split') {
          app.setSplitOpen(!app.splitOpen);
          app.setSection('sessions');
        } else if (e.action === 'hotkeys') showHotkeys();
        else if (e.action === 'about') showAbout();
        else if (e.action === 'import-txt' || e.action === 'import-export') app.setSection('settings');
      }),
    [app, toggleSidebar, showHotkeys, showAbout]
  );

  // Горячие клавиши
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
        // В терминале Ctrl+K может передаваться в CLI (настройка); тогда поиск — по Ctrl+Shift+K.
        const inTerminal = !!(e.target as HTMLElement | null)?.closest?.('.xterm, .xterm-stub');
        if (inTerminal && !e.shiftKey && app.settings.ctrlKInTerminal) return;
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        showHotkeys();
        return;
      }
      if (mod && !e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        app.openDialog((close) => <DeviceEditor onClose={close} />);
        return;
      }
      if (mod && !e.shiftKey && e.code === 'KeyB') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && e.code === 'Backslash') {
        e.preventDefault();
        app.setSplitOpen(!app.splitOpen);
        app.setSection('sessions');
        return;
      }
      const list = app.sessions;
      if (e.ctrlKey && e.code === 'Tab' && list.length) {
        e.preventDefault();
        const i = list.findIndex((s) => s.key === app.activeSession);
        const next = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
        app.setActiveSession(next.key);
        app.setSection('sessions');
        return;
      }
      if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const s = list[Number(e.code.slice(5)) - 1];
        if (s) {
          e.preventDefault();
          app.setActiveSession(s.key);
          app.setSection('sessions');
        }
        return;
      }
      if (mod && e.shiftKey && e.code === 'KeyW' && app.activeSession) {
        e.preventDefault();
        const s = app.sessionByKey(app.activeSession);
        if (s) void app.confirm({ title: 'Закрыть сессию?', text: `Отключиться от «${s.deviceName}»?`, okText: 'Закрыть' }).then((ok) => {
            if (ok) void app.closeSession(s.key);
          });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [app, toggleSidebar, showHotkeys]);

  // Всё, что в простом режиме спрятано, доступно из Ctrl+K: разделы и действия.
  const actions = useMemo<PaletteAction[]>(() => {
    const s = app.settings;
    return [
      { id: 'quick-connect', title: 'Подключиться…', hint: 'К сохранённому устройству или по адресу user@host:port', icon: 'plug', keywords: 'новое подключение ssh telnet консоль com', suggest: true, run: () => app.openDialog((close) => <QuickConnect onClose={close} />) },
      { id: 'new-device', title: 'Добавить устройство', hint: `${MOD}+N — коммутатор, сервер, Telnet или COM-порт`, icon: 'plus', keywords: 'новое устройство хост', suggest: true, run: () => app.openDialog((close) => <DeviceEditor onClose={close} />) },
      { id: 'export-devices', title: 'Экспорт устройств (перенос на другой компьютер)', hint: 'Файл со списком устройств, группами и ключами хостов; пароли — по желанию, в зашифрованном виде', icon: 'download', keywords: 'перенести устройства выгрузить сохранить список csv excel другой компьютер передать', run: () => app.openDialog((close) => <ExportDevicesDialog onClose={close} groupId={null} visibleIds={app.devices.map((d) => d.id)} filtered={false} selected={null} />) },
      { id: 'import-devices', title: 'Импорт устройств', hint: 'С другого компьютера (файл NetAdmin Desk), из таблицы CSV или ~/.ssh/config', icon: 'upload', keywords: 'загрузить устройства перенести с другого компьютера csv ssh config', run: () => app.openDialog((close) => <ImportDevicesDialog onClose={close} />) },
      { id: 'learn-start', title: 'Обучение: с чего начать', hint: 'Пятиминутное знакомство с программой', icon: 'book', keywords: 'помощь как пользоваться новичок', suggest: true, run: () => app.openGuide('start-app') },
      { id: 'calc', title: 'Калькулятор подсетей IPv4', hint: 'Маска, префикс, wildcard, диапазон адресов, деление сети', icon: 'calculator', keywords: 'подсеть маска cidr wildcard broadcast сеть ip', suggest: true, run: () => openNetTool(app, 'calc') },
      { id: 'mac', title: 'Конвертер MAC-адресов', hint: 'aabb.ccdd.eeff ↔ aa:bb:cc:dd:ee:ff ↔ AA-BB-…, формат для поиска на коммутаторе', icon: 'tag', keywords: 'мак адрес формат', run: () => openNetTool(app, 'mac') },
      { id: 'ping', title: 'Ping, трассировка, проверка порта', hint: 'С этого компьютера: доступен ли адрес и открыт ли порт', icon: 'activity', keywords: 'пинг traceroute tracert порт доступность', run: () => openNetTool(app, 'ping') },
      { id: 'keys', title: 'Создать SSH-ключ', hint: 'Ключ ed25519 вместо пароля и установка на сервер', icon: 'key', keywords: 'ключ ssh-keygen authorized_keys вход без пароля', run: () => openNetTool(app, 'keys') },
      { id: 'split', title: 'Разделить экран', hint: 'Несколько сессий рядом, ввод сразу во все', icon: 'grid', keywords: 'сплит панели рядом одновременно broadcast', run: () => sessionsAction(app, 'split') },
      { id: 'compose', title: 'Окно команд', hint: 'Подготовить несколько строк и отправить в одну или все сессии', icon: 'command', keywords: 'отправить блок команд конфигурация', run: () => sessionsAction(app, 'compose') },
      { id: 'mode', title: s.uiMode === 'simple' ? 'Показать всё (полный режим)' : 'Компактный вид (простой режим)', hint: s.uiMode === 'simple' ? 'Все разделы меню и все кнопки на виду' : 'Только основное, остальное в «Ещё»', icon: s.uiMode === 'simple' ? 'maximize' : 'minimize', keywords: 'режим интерфейс меню минимализм', run: () => void app.updateSettings({ uiMode: s.uiMode === 'simple' ? 'full' : 'simple' }) },
      { id: 'customize-nav', title: 'Настроить меню', hint: 'Какие разделы на виду, какие в «Ещё»', icon: 'sliders', keywords: 'скрыть показать пункты', run: () => app.openDialog((close) => <NavCustomizeDialog onClose={close} />) },
      { id: 'readonly', title: s.readOnlyMode ? 'Выключить «Только чтение»' : 'Включить «Только чтение»', hint: 'Запрет изменяющих команд во всех сессиях', icon: 'shield', keywords: 'безопасный режим запрет', run: () => void app.updateSettings({ readOnlyMode: !s.readOnlyMode }) },
      { id: 'theme', title: s.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема', hint: 'Оформление', icon: s.theme === 'dark' ? 'sun' : 'moon', keywords: 'тема цвет', run: () => void app.updateSettings({ theme: s.theme === 'dark' ? 'light' : 'dark' }) },
      { id: 'sidebar', title: s.sidebarCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель', hint: `${MOD}+B`, icon: 'sidebar', keywords: 'меню панель', run: toggleSidebar },
      { id: 'hotkeys', title: 'Горячие клавиши', hint: 'F1', icon: 'info', keywords: 'сочетания клавиши справка', run: showHotkeys },
      ...NAV.map((n) => ({ id: `nav:${n.id}`, title: n.label, hint: n.hint, icon: n.icon, keywords: `раздел открыть ${n.keywords ?? ''}`, run: () => app.setSection(n.id) }))
    ];
  }, [app, toggleSidebar, showHotkeys]);

  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar onToggleCollapse={toggleSidebar} />
      <main className="main">
        <header className="topbar">
          <h1>{NAV_TITLES[app.section] ?? ''}</h1>
          <button className="search-trigger" onClick={() => setPalette(true)}>
            <Icon name="search" size={15} />
            <span>Поиск по командам, устройствам, сценариям…</span>
            <kbd>{MOD}+K</kbd>
          </button>
          <div className="spacer" />
          <Button size="sm" icon="plus" onClick={() => app.openDialog((close) => <DeviceEditor onClose={close} />)}>
            Устройство
          </Button>
          <Button size="sm" variant="ghost" iconOnly icon="info" title="Горячие клавиши (F1)" onClick={showHotkeys} />
        </header>
        <div className={`content ${['sessions', 'reference', 'switches', 'linux', 'learn', 'notes', 'devices', 'scenarios', 'backups', 'favorites'].includes(app.section) ? 'no-scroll' : ''}`}>
          <div style={{ display: app.section === 'sessions' ? 'block' : 'none', height: '100%' }}>
            <SessionsView visible={app.section === 'sessions'} />
          </div>
          {app.section === 'home' && <HomeView onSearch={() => setPalette(true)} />}
          {app.section === 'devices' && <DevicesView />}
          {(app.section === 'switches' || app.section === 'reference') && <ReferenceView preset="switch" />}
          {app.section === 'linux' && <ReferenceView preset="linux" />}
          {app.section === 'sql' && <ReferenceView preset="sql" />}
          {app.section === 'learn' && <LearnView />}
          {app.section === 'notes' && (
            <div className="columns" style={{ flexDirection: 'column' }}>
              <NotesPanel openId={openNoteId} onOpened={() => setOpenNoteId(null)} />
            </div>
          )}
          {app.section === 'favorites' && <FavoritesView />}
          {app.section === 'scenarios' && <ScenariosView openId={openScenarioId} onOpened={() => setOpenScenarioId(null)} />}
          {app.section === 'diagnostics' && <DiagnosticsView />}
          {app.section === 'history' && <HistoryView />}
          {app.section === 'backups' && <BackupsView />}
          {app.section === 'nettools' && <NetToolsView />}
          {app.section === 'settings' && <SettingsView />}
        </div>
      </main>
      {palette && (
        <CommandPalette
          actions={actions}
          onClose={() => setPalette(false)}
          onOpenScenario={(id) => {
            setOpenScenarioId(id);
            app.setSection('scenarios');
          }}
          onOpenNote={(id) => {
            setOpenNoteId(id);
            app.setSection('notes');
          }}
        />
      )}
      {app.dialogs.map((d) => (
        <Fragment key={d.id}>{d.render()}</Fragment>
      ))}
      <PromptHost />
      <div className="toasts">
        {app.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
