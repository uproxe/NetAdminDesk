// Настройки: внешний вид, терминал, безопасность и хранилище паролей, импорт/экспорт, база данных, шаблоны.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { NavCustomizeDialog } from '../components/Sidebar';
import { useApp, errMsg } from '../lib/store';
import { Banner, Button, Check, Field, Modal, Tabs, Toggle } from '../components/ui';
import { fmtDate, fmtSize } from '../lib/format';
import { getPlatform } from '../../shared/platforms';
import { BUILTIN_PARAMS } from '../../shared/templates';
import type { ImportReportRecord, KnownHost, TemplateParamDef, TxtParseReport } from '../../shared/types';
import type { EncryptedPreview, JsonPreview, TxtPreview } from '../../shared/ipc';
import { Logo } from '../components/Logo';

type Tab = 'appearance' | 'terminal' | 'security' | 'io' | 'database' | 'templates' | 'about';

export function SettingsView() {
  const [tab, setTab] = useState<Tab>('appearance');
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'appearance', label: 'Внешний вид' },
          { id: 'terminal', label: 'Терминал' },
          { id: 'security', label: 'Безопасность' },
          { id: 'io', label: 'Импорт и экспорт' },
          { id: 'database', label: 'База данных' },
          { id: 'templates', label: 'Параметры шаблонов' },
          { id: 'about', label: 'О программе' }
        ]}
      />
      {tab === 'appearance' && <Appearance />}
      {tab === 'terminal' && <TerminalSettings />}
      {tab === 'security' && <Security />}
      {tab === 'io' && <ImportExport />}
      {tab === 'database' && <Database />}
      {tab === 'templates' && <TemplateParams />}
      {tab === 'about' && <About />}
    </div>
  );
}

function Appearance() {
  const app = useApp();
  const s = app.settings;
  return (
    <div className="card">
      <Field label="Тема">
        <div className="btn-row">
          <Button variant={s.theme === 'dark' ? 'primary' : 'default'} icon="moon" onClick={() => app.updateSettings({ theme: 'dark' })}>
            Тёмная
          </Button>
          <Button variant={s.theme === 'light' ? 'primary' : 'default'} icon="sun" onClick={() => app.updateSettings({ theme: 'light' })}>
            Светлая
          </Button>
        </div>
      </Field>
      <Field label={`Масштаб интерфейса: ${Math.round(s.uiScale * 100)}%`} hint="Также Ctrl+= / Ctrl+- / Ctrl+0.">
        <input type="range" min={0.7} max={1.6} step={0.05} value={s.uiScale} onChange={(e) => app.updateSettings({ uiScale: Number(e.target.value) })} />
      </Field>
      <div className="grid-2">
        <Field label="Шрифт интерфейса" hint="Пусто — системный шрифт">
          <input className="input" value={s.uiFont} onChange={(e) => app.updateSettings({ uiFont: e.target.value })} placeholder="Segoe UI, Ubuntu…" />
        </Field>
        <Field label="Моноширинный шрифт (команды и терминал)" hint="Пусто — JetBrains Mono / Consolas / Menlo / DejaVu Sans Mono">
          <input className="input" value={s.monoFont} onChange={(e) => app.updateSettings({ monoFont: e.target.value })} placeholder="Cascadia Mono" />
        </Field>
      </div>
      <Toggle label="Свернуть боковую панель" checked={s.sidebarCollapsed} onChange={(v) => app.updateSettings({ sidebarCollapsed: v })} />
      <Toggle
        label="Полный режим интерфейса"
        desc="Выключено (простой режим): редкие разделы меню убраны в «Ещё», дополнительные кнопки панели сессии — в меню «⋯ Ещё», дополнительные поля карточки устройства свёрнуты. Всё по-прежнему доступно, в том числе через Ctrl+K."
        checked={s.uiMode === 'full'}
        onChange={(v) => app.updateSettings({ uiMode: v ? 'full' : 'simple' })}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <Button size="sm" icon="sliders" onClick={() => app.openDialog((close) => <NavCustomizeDialog onClose={close} />)}>
          Настроить меню…
        </Button>
      </div>
    </div>
  );
}

function TerminalSettings() {
  const app = useApp();
  const s = app.settings;
  return (
    <div className="card">
      <div className="grid-3">
        <Field label="Размер шрифта">
          <input className="input" type="number" min={9} max={28} value={s.terminalFontSize} onChange={(e) => app.updateSettings({ terminalFontSize: Number(e.target.value) || 14 })} />
        </Field>
        <Field label="Строк истории (scrollback)">
          <input className="input" type="number" min={500} max={200000} step={500} value={s.terminalScrollback} onChange={(e) => app.updateSettings({ terminalScrollback: Number(e.target.value) || 10000 })} />
        </Field>
        <Field label="Keepalive по умолчанию, с">
          <input className="input" type="number" min={0} value={s.defaultKeepaliveSec} onChange={(e) => app.updateSettings({ defaultKeepaliveSec: Number(e.target.value) })} />
        </Field>
      </div>
      <Toggle label="Мигающий курсор" checked={s.terminalCursorBlink} onChange={(v) => app.updateSettings({ terminalCursorBlink: v })} />
      <Toggle
        label="Подсветка вывода"
        desc="Цветом выделяются состояния (up — зелёным, down и ошибки — красным, notconnect и disabled — жёлтым), ненулевые счётчики ошибок, IP- и MAC-адреса, имена интерфейсов. Текст вывода не меняется: копирование и журналы получают исходный текст."
        checked={s.terminalHighlight}
        onChange={(v) => app.updateSettings({ terminalHighlight: v })}
      />
      <Toggle label="Панель быстрых команд" desc="Над терминалом — кнопки с избранными командами для платформы текущего устройства." checked={s.quickCommandsBar} onChange={(v) => app.updateSettings({ quickCommandsBar: v })} />
      <Toggle label="Копировать при выделении" desc="Выделенный текст сразу попадает в буфер обмена." checked={s.copyOnSelect} onChange={(v) => app.updateSettings({ copyOnSelect: v })} />
      <Toggle
        label="Передавать Ctrl+K в терминал"
        desc="Если включено, в терминале Ctrl+K работает как в CLI (удаление до конца строки), а быстрый поиск открывается по Ctrl+Shift+K."
        checked={s.ctrlKInTerminal}
        onChange={(v) => app.updateSettings({ ctrlKInTerminal: v })}
      />
      <Toggle label="Сохранять журналы сессий" desc="Вывод терминала (без ANSI-кодов) записывается в каталог данных → session-logs. Внимание: в журнал попадает всё, что показывает устройство." checked={s.saveSessionLogs} onChange={(v) => app.updateSettings({ saveSessionLogs: v })} />
    </div>
  );
}

function Security() {
  const app = useApp();
  const s = app.settings;
  const v = app.vault;
  const [known, setKnown] = useState<KnownHost[]>([]);
  useEffect(() => {
    void api.devices.knownHosts().then(setKnown);
  }, []);
  const masterDialog = (mode: 'setup' | 'unlock' | 'change') => app.openDialog((close) => <MasterDialog mode={mode} onClose={close} />);
  return (
    <>
      <div className="card">
        <h3>Защита от ошибок</h3>
        <Toggle label="Режим «Только чтение»" desc="Изменяющие команды из справочника, сценариев и диагностики не отправляются ни на одно устройство. Ручной ввод в терминале не фильтруется." checked={s.readOnlyMode} onChange={(x) => app.updateSettings({ readOnlyMode: x })} />
        <Toggle label="Подтверждать изменяющие команды" desc="Опасные и критичные команды подтверждаются всегда." checked={s.confirmChangeCommands} onChange={(x) => app.updateSettings({ confirmChangeCommands: x })} />
        <Toggle label="Разрешить массовое выполнение изменяющих сценариев" desc="По умолчанию сценарии с изменяющими шагами можно запускать только на одном устройстве." checked={s.allowMassConfig} onChange={(x) => app.updateSettings({ allowMassConfig: x })} />
        <Toggle label="Записывать в историю команды, введённые вручную" desc="Строки, введённые после запроса пароля, не записываются. Пароли в командах маскируются." checked={s.logTypedCommands} onChange={(x) => app.updateSettings({ logTypedCommands: x })} />
        <Toggle label="Показывать записи с учётными данными" desc="Записи, помеченные как чувствительные (например, пароли по умолчанию из TXT), по умолчанию скрыты из поиска и карточек." checked={s.showSensitive} onChange={(x) => app.updateSettings({ showSensitive: x })} />
      </div>
      <div className="card">
        <h3>Хранение паролей</h3>
        {v && (
          <>
            <dl className="kv" style={{ marginBottom: 12 }}>
              <dt>Режим</dt>
              <dd>{{ os: 'системное защищённое хранилище', master: 'мастер-пароль (AES-256-GCM)', prompt: 'не сохранять, запрашивать при подключении', unset: 'не выбран' }[v.mode]}</dd>
              <dt>Системное хранилище</dt>
              <dd>
                {v.osAvailable ? (v.osSecure ? <span className="badge ok">доступно ({v.osBackend})</span> : <span className="badge warn">небезопасно ({v.osBackend})</span>) : <span className="badge warn">недоступно</span>}
              </dd>
              {v.mode === 'master' && (
                <>
                  <dt>Состояние</dt>
                  <dd>{v.unlocked ? <span className="badge ok">разблокировано</span> : <span className="badge warn">заблокировано</span>}</dd>
                </>
              )}
            </dl>
            {v.osAvailable && !v.osSecure && (
              <Banner kind="warn">
                Backend «{v.osBackend}» означает, что на этом Linux нет работающего хранилища ключей (GNOME Keyring / KWallet). Пароли в таком режиме не сохраняются — используйте мастер-пароль.
              </Banner>
            )}
            <div className="btn-row">
              {v.osSecure && v.mode !== 'os' && (
                <Button
                  onClick={async () => {
                    try {
                      await api.vault.switchMode('os');
                      await app.refresh('vault');
                    } catch (e) {
                      app.toast(errMsg(e), 'error');
                    }
                  }}
                >
                  Использовать системное хранилище
                </Button>
              )}
              {v.mode !== 'master' && <Button onClick={() => masterDialog('setup')}>Задать мастер-пароль</Button>}
              {v.mode === 'master' && !v.unlocked && (
                <Button variant="primary" icon="unlock" onClick={() => masterDialog('unlock')}>
                  Разблокировать
                </Button>
              )}
              {v.mode === 'master' && v.unlocked && (
                <Button
                  icon="lock"
                  onClick={async () => {
                    await api.vault.lock();
                    await app.refresh('vault');
                  }}
                >
                  Заблокировать
                </Button>
              )}
              {v.mode === 'master' && <Button onClick={() => masterDialog('change')}>Сменить мастер-пароль</Button>}
              {v.mode !== 'prompt' && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!(await app.confirm({ title: 'Не хранить пароли?', text: 'Все сохранённые пароли будут удалены. Пароль будет запрашиваться при каждом подключении.', okText: 'Удалить пароли', danger: true }))) return;
                    await api.vault.switchMode('prompt');
                    await app.refresh('vault');
                  }}
                >
                  Не хранить пароли
                </Button>
              )}
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>
              Пароли никогда не записываются в открытом виде: в базе хранятся только зашифрованные значения. Для переноса на другой компьютер используйте зашифрованный экспорт.
            </div>
          </>
        )}
      </div>
      <div className="card">
        <h3>Известные ключи хостов SSH ({known.length})</h3>
        {!known.length && <div className="small muted">Ключи сохраняются после подтверждения при первом подключении.</div>}
        {known.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Хост</th>
                <th>Ключ</th>
                <th>Принят</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {known.map((k) => (
                <tr key={k.id}>
                  <td className="mono small">
                    {k.host}:{k.port}
                  </td>
                  <td className="mono small">
                    {k.keyType} {k.fingerprint}
                  </td>
                  <td className="small muted">{fmtDate(k.firstSeen)}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!(await app.confirm({ title: 'Забыть ключ?', text: `${k.host}:${k.port} — при следующем подключении отпечаток будет запрошен заново.`, okText: 'Забыть', danger: true }))) return;
                        await api.devices.forgetHostKey(k.host, k.port);
                        setKnown(await api.devices.knownHosts());
                      }}
                    >
                      Забыть
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function MasterDialog({ mode, onClose }: { mode: 'setup' | 'unlock' | 'change'; onClose: () => void }) {
  const app = useApp();
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const submit = async () => {
    try {
      if (mode === 'unlock') {
        if (!(await api.vault.unlock(pw))) return app.toast('Неверный мастер-пароль', 'error');
      } else if (mode === 'setup') await api.vault.setupMaster(pw);
      else await api.vault.changeMaster(old, pw);
      await app.refresh('vault');
      app.toast(mode === 'unlock' ? 'Хранилище разблокировано' : 'Мастер-пароль установлен', 'ok');
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const valid = mode === 'unlock' ? !!pw : pw.length >= 8 && pw === pw2 && (mode !== 'change' || !!old);
  return (
    <Modal
      title={{ setup: 'Мастер-пароль', unlock: 'Разблокировать хранилище', change: 'Смена мастер-пароля' }[mode]}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {mode === 'unlock' ? 'Разблокировать' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), valid && submit())}>
        {mode === 'setup' && <Banner>Пароли устройств будут зашифрованы AES-256-GCM ключом из мастер-пароля (scrypt). Мастер-пароль не сохраняется — если забыть его, сохранённые пароли восстановить невозможно.</Banner>}
        {mode === 'change' && (
          <Field label="Текущий мастер-пароль">
            <input className="input" type="password" autoFocus value={old} onChange={(e) => setOld(e.target.value)} />
          </Field>
        )}
        <Field label={mode === 'unlock' ? 'Мастер-пароль' : 'Новый мастер-пароль (не короче 8 символов)'}>
          <input className="input" type="password" autoFocus={mode !== 'change'} value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {mode !== 'unlock' && (
          <Field label="Повтор" error={pw2 && pw !== pw2 ? 'Пароли не совпадают' : null}>
            <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function ImportExport() {
  const app = useApp();
  const pickTxt = async () => {
    const p = await api.app.selectFile({ title: 'TXT-файл с командами', filters: [{ name: 'Текст', extensions: ['txt', 'conf', 'cfg', 'log', '*'] }] });
    if (p) app.openDialog((close) => <TxtImportDialog path={p} onClose={close} />);
  };
  const exportTxt = async () => {
    const p = await api.app.selectSaveFile({ title: 'Экспорт в TXT', defaultPath: 'netadmin-commands.txt', filters: [{ name: 'Текст', extensions: ['txt'] }] });
    if (!p) return;
    const n = await api.io.exportTxt(p, { kinds: ['switch', 'linux', 'sql'], sources: ['user_txt', 'user', 'imported'] });
    app.toast(`Экспортировано записей: ${n}`, 'ok');
  };
  const exportJson = async () => {
    const p = await api.app.selectSaveFile({ title: 'Экспорт в JSON', defaultPath: `netadmin-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    const n = await api.io.exportJson(p);
    app.toast(`Экспортировано объектов: ${n} (без паролей)`, 'ok');
  };
  const importJson = async () => {
    const p = await api.app.selectFile({ title: 'Импорт JSON', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (p) app.openDialog((close) => <JsonImportDialog path={p} onClose={close} />);
  };
  return (
    <>
      <div className="card">
        <h3>Устройства: перенос на другой компьютер</h3>
        <div className="small muted">
          Только список устройств (с группами, ключами хостов и, по желанию, паролями в зашифрованном виде): «Устройства» → <b>«Экспорт»</b> на этом компьютере и «Устройства» → «Импорт» → «С другого компьютера» на другом. Там же — таблица CSV для Excel и импорт из ~/.ssh/config.
        </div>
        <Button style={{ marginTop: 8 }} icon="server" onClick={() => app.setSection('devices')}>
          Перейти к устройствам
        </Button>
      </div>
      <div className="card">
        <h3>Команды</h3>
        <div className="btn-row">
          <Button icon="upload" onClick={pickTxt}>
            Импорт TXT…
          </Button>
          <Button icon="download" onClick={exportTxt}>
            Экспорт TXT (ваши записи)
          </Button>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Импорт TXT показывает предварительный просмотр и отчёт: количество записей, нераспознанные строки, пометки «Требует проверки». Существующие записи не удаляются. Поддерживаются кодировки UTF-8 и Windows-1251.
        </div>
      </div>
      <div className="card">
        <h3>Данные приложения (JSON)</h3>
        <div className="btn-row">
          <Button icon="download" onClick={exportJson}>
            Экспорт JSON
          </Button>
          <Button icon="upload" onClick={importJson}>
            Импорт JSON…
          </Button>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Ваши команды, сценарии, заметки, группы и карточки устройств — без паролей. При объединении дубликаты не перезаписываются без вашего выбора.
        </div>
      </div>
      <div className="card">
        <h3>Зашифрованный перенос (Windows ↔ macOS ↔ Linux)</h3>
        <div className="btn-row">
          <Button icon="lock" onClick={() => app.openDialog((close) => <EncryptedDialog mode="export" onClose={close} />)}>
            Зашифрованный экспорт всех данных…
          </Button>
          <Button icon="unlock" onClick={() => app.openDialog((close) => <EncryptedDialog mode="import" onClose={close} />)}>
            Импорт зашифрованной копии…
          </Button>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Файл .nadx (AES-256-GCM, ключ из пароля через scrypt) содержит устройства с паролями, команды, сценарии, заметки, ключи хостов и настройки. Пароли хранилища ОС на другом компьютере не расшифровываются — поэтому для переноса используется этот формат.
        </div>
      </div>

    </>
  );
}

export function ReportBox({ report }: { report: TxtParseReport }) {
  return (
    <div>
      <dl className="kv">
        <dt>Файл</dt>
        <dd>{report.file}</dd>
        <dt>Кодировка</dt>
        <dd>{report.encoding}</dd>
        <dt>Строк всего / непустых</dt>
        <dd>
          {report.totalLines} / {report.nonEmptyLines}
        </dd>
        <dt>Записей</dt>
        <dd>
          {report.entries} (команд: {report.byType.command}, последовательностей: {report.byType.sequence}, заметок: {report.byType.note})
        </dd>
        <dt>Строк команд / вывода / заголовков / заметок</dt>
        <dd>
          {report.commandLines} / {report.outputLines} / {report.headingLines} / {report.noteLines}
        </dd>
        <dt>Разделы производителей</dt>
        <dd>{report.headers.map((h) => `${h.text} → ${h.vendorLabel}`).join('; ') || '—'}</dd>
        <dt>По производителям</dt>
        <dd>
          {Object.entries(report.byPlatform)
            .map(([k, n]) => `${k}: ${n}`)
            .join('; ')}
        </dd>
        <dt>Производитель не указан</dt>
        <dd>{report.vendorUnknown}</dd>
        <dt>Без описания</dt>
        <dd>{report.noDescription}</dd>
        {report.imported !== undefined && (
          <>
            <dt>Добавлено / обновлено / без изменений</dt>
            <dd>
              {report.imported} / {report.updated} / {report.unchanged}
            </dd>
          </>
        )}
        <dt>Нераспознанные строки</dt>
        <dd style={{ color: report.unaccounted.length ? 'var(--crit)' : 'var(--ok)' }}>{report.unaccounted.length ? report.unaccounted.join(', ') : 'нет — все строки учтены'}</dd>
        <dt>Ошибки разбора</dt>
        <dd>{report.errors.length || 'нет'}</dd>
      </dl>
      {report.needsReview.length > 0 && <IssueList title={`Требует проверки (${report.needsReview.length})`} items={report.needsReview} />}
      {report.sensitive.length > 0 && <IssueList title={`Чувствительные данные (${report.sensitive.length})`} items={report.sensitive} hideText />}
      {report.skipped.length > 0 && <IssueList title={`Пропущено (${report.skipped.length})`} items={report.skipped} />}
    </div>
  );
}

function IssueList({ title, items, hideText }: { title: string; items: { line: number; text: string; reason: string }[]; hideText?: boolean }) {
  return (
    <details open={items.length < 12}>
      <summary>{title}</summary>
      <table className="table">
        <tbody>
          {items.map((i, k) => (
            <tr key={k}>
              <td style={{ width: 60 }} className="small muted">
                стр. {i.line}
              </td>
              <td className="mono small">{hideText ? '(скрыто)' : i.text}</td>
              <td className="small">{i.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function TxtImportDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const app = useApp();
  const [pv, setPv] = useState<TxtPreview | null>(null);
  const [skip, setSkip] = useState(true);
  const [result, setResult] = useState<TxtParseReport | null>(null);
  useEffect(() => {
    api.io.previewTxt(path).then(setPv, (e) => app.toast(errMsg(e), 'error'));
  }, [path, app]);
  const run = async () => {
    try {
      const r = await api.io.importTxt(path, { skipDuplicates: skip });
      setResult(r);
      await app.refresh('commands');
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const dups = pv?.items.filter((i) => i.duplicateOf).length ?? 0;
  return (
    <Modal
      title="Импорт команд из TXT"
      width="xwide"
      onClose={onClose}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Отмена</Button>
            <Button variant="primary" disabled={!pv} onClick={run}>
              Импортировать {pv?.items.length ?? ''} записей
            </Button>
          </>
        )
      }
    >
      {result ? (
        <>
          <Banner kind="ok">Импорт завершён.</Banner>
          <ReportBox report={result} />
        </>
      ) : !pv ? (
        <div className="muted">Разбор файла…</div>
      ) : (
        <>
          <ReportBox report={pv.report} />
          {dups > 0 && <Check checked={skip} onChange={setSkip} label={`Пропустить дубликаты существующих записей (${dups})`} />}
          <div className="section-title">Предварительный просмотр</div>
          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Стр.</th>
                  <th>Запись</th>
                  <th>Команда</th>
                  <th>Производитель</th>
                  <th>Пометки</th>
                </tr>
              </thead>
              <tbody>
                {pv.items.map((i, k) => (
                  <tr key={k}>
                    <td className="small muted">{i.startLine}</td>
                    <td className="small">{i.title}</td>
                    <td className="mono small" style={{ whiteSpace: 'pre-wrap' }}>
                      {i.command}
                    </td>
                    <td className="small">{i.vendorLabel}</td>
                    <td className="small">
                      {i.flags.join(', ')} {i.duplicateOf && <span className="badge warn">дубликат: {i.duplicateOf}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

function JsonImportDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const app = useApp();
  const [pv, setPv] = useState<JsonPreview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  useEffect(() => {
    api.io.previewJson(path).then(setPv, (e) => app.toast(errMsg(e), 'error'));
  }, [path, app]);
  const run = async () => {
    try {
      await api.io.importJson(path, { overwriteConflicts: overwrite });
      await app.refresh('all');
      app.toast('Импорт выполнен', 'ok');
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <Modal
      title="Импорт JSON"
      onClose={onClose}
      width="wide"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!pv} onClick={run}>
            Импортировать
          </Button>
        </>
      }
    >
      {pv && (
        <>
          <dl className="kv">
            <dt>Команды</dt>
            <dd>
              всего {pv.commands.total}, новых {pv.commands.new}, совпадают {pv.commands.same}, отличаются {pv.commands.conflicts.length}
            </dd>
            <dt>Сценарии</dt>
            <dd>
              всего {pv.scenarios.total}, новых {pv.scenarios.new}, отличаются {pv.scenarios.conflicts}
            </dd>
            <dt>Устройства</dt>
            <dd>
              всего {pv.devices.total}, новых {pv.devices.new}, уже есть {pv.devices.existing}
            </dd>
            <dt>Заметки</dt>
            <dd>{pv.notes}</dd>
          </dl>
          {pv.commands.conflicts.length > 0 && (
            <details>
              <summary>Отличающиеся записи ({pv.commands.conflicts.length})</summary>
              <ul className="small">
                {pv.commands.conflicts.slice(0, 100).map((c) => (
                  <li key={c.uid}>{c.title}</li>
                ))}
              </ul>
            </details>
          )}
          <Check checked={overwrite} onChange={setOverwrite} label="Заменить отличающиеся записи версией из файла (иначе — оставить текущие)" />
        </>
      )}
    </Modal>
  );
}

function EncryptedDialog({ mode, onClose }: { mode: 'export' | 'import'; onClose: () => void }) {
  const app = useApp();
  const [path, setPath] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [history, setHistory] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [settings, setSettings] = useState(false);
  const [preview, setPreview] = useState<EncryptedPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    const p =
      mode === 'export'
        ? await api.app.selectSaveFile({ title: 'Зашифрованная копия', defaultPath: `netadmin-${new Date().toISOString().slice(0, 10)}.nadx`, filters: [{ name: 'NetAdmin Desk', extensions: ['nadx'] }] })
        : await api.app.selectFile({ title: 'Зашифрованная копия', filters: [{ name: 'NetAdmin Desk', extensions: ['nadx', 'json'] }] });
    if (p) setPath(p);
  };
  const go = async () => {
    if (!path) return;
    setBusy(true);
    try {
      if (mode === 'export') {
        const c = await api.io.exportEncrypted(path, pw, { includeHistory: history });
        app.toast(`Экспортировано: устройств ${c.devices}, паролей ${c.secrets}, команд ${c.commands}`, 'ok');
        onClose();
      } else if (!preview) {
        setPreview(await api.io.previewEncrypted(path, pw));
      } else {
        const c = await api.io.importEncrypted(path, pw, { overwriteConflicts: overwrite, importSettings: settings });
        await app.refresh('all');
        app.toast(`Импортировано: устройств ${c.devices}, паролей ${c.secrets}${c.secretsSkipped ? ` (не сохранено ${c.secretsSkipped} — настройте хранилище паролей)` : ''}, команд ${c.commands}`, 'ok');
        onClose();
      }
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const valid = !!path && (mode === 'export' ? pw.length >= 8 && pw === pw2 : !!pw);
  return (
    <Modal
      title={mode === 'export' ? 'Зашифрованный экспорт' : 'Импорт зашифрованной копии'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={go}>
            {mode === 'export' ? 'Экспортировать' : preview ? 'Импортировать' : 'Проверить файл'}
          </Button>
        </>
      }
    >
      <Field label="Файл">
        <div className="row">
          <input className="input mono" readOnly value={path ?? ''} placeholder="не выбран" />
          <Button onClick={pick}>Выбрать…</Button>
        </div>
      </Field>
      <Field label={mode === 'export' ? 'Пароль для файла (не короче 8 символов)' : 'Пароль файла'}>
        <input className="input" type="password" value={pw} onChange={(e) => (setPw(e.target.value), setPreview(null))} />
      </Field>
      {mode === 'export' && (
        <>
          <Field label="Повтор пароля" error={pw2 && pw !== pw2 ? 'Пароли не совпадают' : null}>
            <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <Check checked={history} onChange={setHistory} label="Включить историю команд" />
          <Banner kind="warn">Файл содержит пароли устройств. Храните его и пароль раздельно.</Banner>
        </>
      )}
      {preview && (
        <>
          <Banner kind="ok">
            Копия от {fmtDate(preview.createdAt)}, версия {preview.appVersion}, схема БД v{preview.schemaVersion}
          </Banner>
          <div className="small">
            {Object.entries(preview.counts)
              .map(([k, n]) => `${{ commands: 'команд', devices: 'устройств', secrets: 'паролей', scenarios: 'сценариев', notes: 'заметок', knownHosts: 'ключей хостов', history: 'записей истории' }[k] ?? k}: ${n}`)
              .join(' · ')}
          </div>
          <Check checked={overwrite} onChange={setOverwrite} label="Заменять совпадающие записи и пароли данными из копии" />
          <Check checked={settings} onChange={setSettings} label="Импортировать настройки интерфейса и безопасности" />
          <div className="small muted">Существующие записи не удаляются. Ключи хостов, отличающиеся от сохранённых, не заменяются.</div>
        </>
      )}
    </Modal>
  );
}

function Database() {
  const app = useApp();
  const [integrity, setIntegrity] = useState<string | null>(null);
  const [autos, setAutos] = useState<{ name: string; size: number; mtime: string }[]>([]);
  const [reports, setReports] = useState<ImportReportRecord[]>([]);
  useEffect(() => {
    void api.db.autoBackups().then(setAutos);
    void api.io.importReports().then(setReports);
  }, []);
  const backup = async () => {
    const p = await api.app.selectSaveFile({ title: 'Резервная копия базы', defaultPath: `netadmin-${new Date().toISOString().slice(0, 10)}.db`, filters: [{ name: 'SQLite', extensions: ['db'] }] });
    if (!p) return;
    await api.io.backupDatabase(p);
    app.toast('Копия базы сохранена', 'ok');
  };
  const restore = async () => {
    const p = await api.app.selectFile({ title: 'Восстановить базу из файла', filters: [{ name: 'SQLite', extensions: ['db'] }] });
    if (!p) return;
    if (!(await app.confirm({ title: 'Восстановить базу?', text: 'Текущая база будет сохранена рядом с суффиксом .before-restore, затем заменена выбранной. Приложение перезапустится.', okText: 'Восстановить', danger: true }))) return;
    try {
      await api.io.restoreDatabase(p);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <>
      <div className="card">
        <h3>Расположение данных</h3>
        <dl className="kv">
          <dt>Каталог данных</dt>
          <dd className="mono small">{app.info?.dataDir}</dd>
          <dt>База данных</dt>
          <dd className="mono small">{app.info?.dbPath}</dd>
          <dt>Переносимый режим</dt>
          <dd>{app.info?.portable ? 'да (папка netadmin-data рядом с программой)' : 'нет'}</dd>
        </dl>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <Button icon="folder" onClick={() => app.info && void api.app.openPath(app.info.dataDir)}>
            Открыть каталог
          </Button>
          <Button
            icon="check"
            onClick={async () => {
              setIntegrity('проверка…');
              setIntegrity(await api.db.integrity());
            }}
          >
            Проверить целостность
          </Button>
          {integrity && <span className={integrity === 'ok' ? 'badge ok' : 'badge crit'}>{integrity === 'ok' ? 'база в порядке' : integrity}</span>}
        </div>
      </div>
      <div className="card">
        <h3>Резервные копии базы</h3>
        <div className="btn-row">
          <Button icon="download" onClick={backup}>
            Сохранить копию базы…
          </Button>
          <Button icon="upload" onClick={restore}>
            Восстановить из файла…
          </Button>
          <Button
            icon="refresh"
            onClick={async () => {
              const n = await api.commands.restoreDeleted();
              app.toast(`Восстановлено удалённых записей справочника: ${n}`, 'ok');
            }}
          >
            Восстановить удалённые записи справочника
          </Button>
        </div>
        <div className="section-title">Автоматические копии (раз в сутки при запуске, хранятся 14)</div>
        {!autos.length && <div className="small muted">Пока нет.</div>}
        {autos.map((a) => (
          <div key={a.name} className="row" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="mono small grow">{a.name}</span>
            <span className="small muted">{fmtSize(a.size)}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!(await app.confirm({ title: 'Восстановить автокопию?', text: `База будет заменена копией ${a.name}. Приложение перезапустится.`, okText: 'Восстановить', danger: true }))) return;
                try {
                  await api.db.restoreAutoBackup(a.name);
                } catch (e) {
                  app.toast(errMsg(e), 'error');
                }
              }}
            >
              Восстановить
            </Button>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Отчёты импорта TXT</h3>
        {!reports.length && <div className="small muted">Нет отчётов.</div>}
        {reports.map((r) => (
          <details key={r.id}>
            <summary>
              {r.file} — {fmtDate(r.ts)} — записей {r.report.entries}, нераспознанных строк {r.report.unaccounted.length}
            </summary>
            <ReportBox report={r.report} />
          </details>
        ))}
      </div>
    </>
  );
}

function TemplateParams() {
  const app = useApp();
  const [p, setP] = useState<TemplateParamDef>({ name: '', label: '', type: 'text', builtin: false });
  const save = async () => {
    try {
      await api.templates.saveParam({ ...p, name: p.name.toUpperCase() });
      await app.refresh('profiles');
      setP({ name: '', label: '', type: 'text', builtin: false });
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <>
      <div className="card">
        <h3>Стандартные параметры</h3>
        <div className="row wrap" style={{ gap: 6 }}>
          {BUILTIN_PARAMS.map((b) => (
            <span key={b.name} className="badge outline" title={b.description}>
              {`{{${b.name}}}`} — {b.label}
            </span>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          В шаблоне можно указать значение по умолчанию: {'{{VLAN:1}}'}. Повтор одного параметра подставляет одно значение. Значения MAC приводятся к формату платформы устройства (например, {getPlatform('alliedware').name}: xx-xx-xx-xx-xx-xx).
        </div>
      </div>
      <div className="card">
        <h3>Свои параметры</h3>
        {!app.templateParams.some((t) => !t.builtin) && <div className="small muted">Пока нет. Добавьте параметр ниже — он станет доступен в шаблонах и подсказках заполнения.</div>}
        {app.templateParams.filter((t) => !t.builtin).map((t) => (
          <div key={t.name} className="row" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <code className="grow">{`{{${t.name}}}`}</code>
            <span className="small">{t.label}</span>
            <span className="small muted">{t.type}{t.regex ? ` /${t.regex}/` : ''}</span>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="trash"
              title="Удалить параметр"
              onClick={async () => {
                await api.templates.removeParam(t.name);
                await app.refresh('profiles');
              }}
            />
          </div>
        ))}
        <div className="grid-3" style={{ marginTop: 12 }}>
          <Field label="Имя (латиница)">
            <input className="input mono" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase() })} placeholder="TFTP_SERVER" />
          </Field>
          <Field label="Подпись">
            <input className="input" value={p.label} onChange={(e) => setP({ ...p, label: e.target.value })} placeholder="TFTP-сервер" />
          </Field>
          <Field label="Тип">
            <select className="select" value={p.type} onChange={(e) => setP({ ...p, type: e.target.value as TemplateParamDef['type'] })}>
              <option value="text">Текст</option>
              <option value="ip">IP-адрес</option>
              <option value="mac">MAC-адрес</option>
              <option value="vlan">VLAN</option>
              <option value="number">Число</option>
              <option value="interface">Интерфейс</option>
              <option value="path">Путь</option>
              <option value="regex">По регулярному выражению</option>
            </select>
          </Field>
        </div>
        {p.type === 'regex' && (
          <Field label="Регулярное выражение">
            <input className="input mono" value={p.regex ?? ''} onChange={(e) => setP({ ...p, regex: e.target.value })} />
          </Field>
        )}
        <Button variant="primary" disabled={!p.name || !p.label} onClick={save}>
          Добавить параметр
        </Button>
      </div>
    </>
  );
}

function About() {
  const app = useApp();
  const i = app.info;
  const row = (k: string, v: ReactNode) => (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
  return (
    <div className="card">
      <div className="about-head">
        <Logo size={56} />
        <h3>NetAdmin Desk {i?.version}</h3>
      </div>
      <dl className="kv">
        {row('Платформа', `${i?.platform} ${i?.arch}`)}
        {row('Electron', i?.electron)}
        {row('Chromium', i?.chrome)}
        {row('Node.js', i?.node)}
        {row('Драйвер SQLite', i?.dbDriver)}
        {row('Схема БД', `v${i?.schemaVersion}`)}
        {row('Записей справочника', app.commands.length)}
        {row('Телеметрия', 'не собирается')}
      </dl>
      <p className="small muted">
        Все данные хранятся локально. Приложение работает без интернета, кроме SSH-подключений к вашим устройствам. Ссылки на документацию man-страниц открываются во внешнем браузере только по вашему нажатию.
      </p>
    </div>
  );
}
