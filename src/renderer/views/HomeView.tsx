// Главная: быстрый поиск, последние подключения, избранное, состояние хранилища и импорта.
import { useEffect, useState } from 'react';
import { api, MOD } from '../api';
import { useApp } from '../lib/store';
import { Icon } from '../lib/icons';
import { Banner, Button, StatusDot } from '../components/ui';
import { DeviceEditor } from '../components/DeviceEditor';
import { fmtAgo } from '../lib/format';
import { getPlatform } from '../../shared/platforms';
import type { ImportReportRecord } from '../../shared/types';

export function HomeView({ onSearch }: { onSearch: () => void }) {
  const app = useApp();
  const [reports, setReports] = useState<ImportReportRecord[]>([]);
  useEffect(() => {
    void api.io.importReports().then(setReports);
  }, []);
  const recent = [...app.devices].filter((d) => d.lastConnectedAt).sort((a, b) => (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? '')).slice(0, 8);
  const favDevices = app.devices.filter((d) => d.favorite).slice(0, 8);
  const favCmds = app.commands.filter((c) => c.favorite).slice(0, 10);
  const sw = app.commands.filter((c) => c.kind === 'switch').length;
  const lx = app.commands.filter((c) => c.kind === 'linux').length;
  const sq = app.commands.filter((c) => c.kind === 'sql').length;
  const mine = app.commands.filter((c) => c.source === 'user_txt' || c.source === 'imported').length;
  const review = app.commands.filter((c) => c.needsReview && (c.source === 'user_txt' || c.source === 'imported')).length;
  const v = app.vault;

  return (
    <div className="page">
      {v && v.mode === 'unset' && (
        <Banner kind="warn" icon="lock">
          Системное защищённое хранилище {v.osAvailable ? `недоступно (backend: ${v.osBackend})` : 'недоступно'}. Пароли устройств не будут сохраняться, пока вы не зададите мастер-пароль.{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), app.setSection('settings'))}>
            Настроить
          </a>
        </Banner>
      )}
      {v && v.mode === 'master' && !v.unlocked && (
        <Banner kind="warn" icon="lock">
          Хранилище паролей заблокировано — сохранённые пароли будут запрошены при подключении.{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), app.setSection('settings'))}>
            Разблокировать
          </a>
        </Banner>
      )}
      {app.settings.readOnlyMode && <Banner kind="warn" icon="shield">Включён режим «Только чтение»: изменяющие команды из приложения не отправляются.</Banner>}

      <button className="search-trigger" style={{ maxWidth: 'none', height: 44, fontSize: 15, marginBottom: 18 }} onClick={onSearch}>
        <Icon name="search" size={18} />
        <span>Найти команду, устройство или сценарий: vlan, мак, poe, systemctl, проверка дисков…</span>
        <kbd>{MOD}+K</kbd>
      </button>

      <div className="card-grid stat-grid">
        <div className="card stat" style={{ cursor: 'pointer' }} onClick={() => app.setSection('devices')}>
          <span className="v">{app.devices.length}</span>
          <span className="l">устройств сохранено</span>
        </div>
        <div className="card stat" style={{ cursor: 'pointer' }} onClick={() => app.setSection('switches')}>
          <span className="v">{sw}</span>
          <span className="l">записей по коммутаторам (из TXT-заметок — {mine})</span>
        </div>
        <div className="card stat" style={{ cursor: 'pointer' }} onClick={() => app.setSection('linux')}>
          <span className="v">{lx}</span>
          <span className="l">Linux-команд в справочнике</span>
        </div>
        <div className="card stat" style={{ cursor: 'pointer' }} onClick={() => app.setSection('sql')}>
          <span className="v">{sq}</span>
          <span className="l">команд SQL: MySQL, MariaDB, PostgreSQL</span>
        </div>
        <div className="card stat" style={{ cursor: 'pointer' }} onClick={() => app.setSection('scenarios')}>
          <span className="v">{app.scenarios.length}</span>
          <span className="l">сценариев</span>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div className="card">
          <h3>Последние подключения</h3>
          {!recent.length && (
            <div className="muted small">
              Подключений ещё не было.{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), app.openDialog((close) => <DeviceEditor onClose={close} />))}>
                Добавьте первое устройство
              </a>
              .
            </div>
          )}
          {recent.map((d) => (
            <div key={d.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <StatusDot status={d.lastStatus} />
              <div className="grow">
                <div className="ellipsis" style={{ fontWeight: 550 }}>
                  {d.name}
                </div>
                <div className="small muted">
                  {d.host} · {getPlatform(d.platform).name} · {fmtAgo(d.lastConnectedAt)}
                </div>
              </div>
              <Button size="sm" icon="plug" onClick={() => void app.connect(d.id)}>
                Подключить
              </Button>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Открытые сессии</h3>
          {!app.sessions.length && <div className="muted small">Нет открытых сессий.</div>}
          {app.sessions.map((s) => (
            <div key={s.key} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <StatusDot status={s.status} />
              <div className="grow ellipsis">
                {s.deviceName} <span className="muted small">{s.host}</span>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  app.setActiveSession(s.key);
                  app.setSection('sessions');
                }}
              >
                Открыть
              </Button>
            </div>
          ))}
          {favDevices.length > 0 && (
            <>
              <div className="section-title">Избранные устройства</div>
              <div className="row wrap">
                {favDevices.map((d) => (
                  <Button key={d.id} size="sm" icon="plug" onClick={() => void app.connect(d.id)}>
                    {d.name}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div className="card">
          <h3>Избранные команды</h3>
          {!favCmds.length && <div className="muted small">Отмечайте команды звёздочкой в справочнике — они появятся здесь.</div>}
          {favCmds.map((c) => (
            <div key={c.id} className="row" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => app.openCommand(c.id)}>
              <Icon name={c.kind === 'linux' ? 'linux' : c.kind === 'sql' ? 'database' : 'switch'} size={14} />
              <div className="grow">
                <div className="ellipsis">{c.title}</div>
                <div className="mono small muted ellipsis">{c.command.split('\n')[0]}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Импорт TXT-файлов</h3>
          {!reports.length && <div className="muted small">Отчётов импорта нет.</div>}
          {reports.slice(0, 4).map((r) => (
            <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 550 }}>{r.file}</div>
              <div className="small muted">
                записей: {r.report.entries} · строк команд: {r.report.commandLines} · примеров вывода: {r.report.outputLines} · нераспознанных строк: {r.report.unaccounted.length} · требуют проверки: {r.report.needsReview.length} · производитель не указан: {r.report.vendorUnknown}
              </div>
            </div>
          ))}
          {review > 0 && (
            <div className="small" style={{ marginTop: 8 }}>
              <a href="#" onClick={(e) => (e.preventDefault(), app.setSection('switches'))}>
                Записей с пометкой «Требует проверки»: {review}
              </a>
            </div>
          )}
          <div className="small" style={{ marginTop: 8 }}>
            <a href="#" onClick={(e) => (e.preventDefault(), app.setSection('settings'))}>
              Подробный отчёт — Настройки → База данных
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
