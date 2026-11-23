// История выполненных действий (без паролей и секретов).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../lib/store';
import { Button, Empty, RiskBadge } from '../components/ui';
import { fmtDate } from '../lib/format';
import type { HistoryEntry } from '../../shared/types';
import { classifyCommand } from '../../shared/risk';

const SOURCE: Record<string, string> = {
  reference: 'Справочник',
  scenario: 'Сценарий',
  diagnostic: 'Диагностика',
  typed: 'Введено вручную',
  backup: 'Резервная копия',
  'mac-search': 'Поиск MAC',
  template: 'Шаблон',
  compose: 'Окно команд'
};

const RESULT: Record<string, string> = { sent: 'отправлено', cancelled: 'отменено', blocked: 'заблокировано', error: 'ошибка', done: 'выполнено' };

export function HistoryView() {
  const app = useApp();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [q, setQ] = useState('');
  const [device, setDevice] = useState<number | ''>('');
  const [source, setSource] = useState('');
  const load = useCallback(async () => {
    setItems(await api.history.list({ search: q || undefined, deviceId: device || undefined, source: source || undefined, limit: 2000 }));
  }, [q, device, source]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load]);
  const clear = async () => {
    if (!(await app.confirm({ title: 'Очистить историю?', text: 'Все записи истории будут удалены.', okText: 'Очистить', danger: true }))) return;
    await api.history.clear();
    await load();
  };
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 360 }} placeholder="Поиск по командам и устройствам" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 220 }} value={device} onChange={(e) => setDevice(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Все устройства</option>
          {app.devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 190 }} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Все источники</option>
          {Object.entries(SOURCE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <div className="grow" />
        <Button icon="refresh" onClick={load}>
          Обновить
        </Button>
        <Button variant="ghost" icon="trash" onClick={clear}>
          Очистить
        </Button>
      </div>
      <div className="small muted" style={{ marginBottom: 8 }}>
        Пароли и секреты в истории маскируются. Строки, введённые вручную, записываются приблизительно (автодополнение и история CLI не учитываются); запись можно отключить в настройках.
      </div>
      {!items.length ? (
        <Empty icon="history" title="История пуста" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Время</th>
              <th style={{ width: 170 }}>Устройство</th>
              <th>Команда</th>
              <th style={{ width: 130 }}>Источник</th>
              <th style={{ width: 100 }}>Риск</th>
              <th style={{ width: 110 }}>Результат</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id}>
                <td className="small muted">{fmtDate(h.ts, true)}</td>
                <td>{h.deviceName}</td>
                <td>
                  <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {h.command}
                  </pre>
                  {h.note && <div className="small faint">{h.note}</div>}
                </td>
                <td className="small">{SOURCE[h.source] ?? h.source}</td>
                <td>
                  <RiskBadge risk={h.risk} />
                </td>
                <td className="small" style={{ color: h.result === 'blocked' || h.result === 'error' ? 'var(--crit)' : undefined }}>
                  {RESULT[h.result] ?? h.result}
                </td>
                <td>
                  {!h.command.startsWith('[') && (
                    <span className="row" style={{ gap: 2 }}>
                      <Button size="sm" variant="ghost" iconOnly icon="copy" title="Копировать" onClick={() => app.copy(h.command)} />
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon="play"
                        title="Повторить (с подтверждением)"
                        disabled={h.command.includes('********')}
                        onClick={() => {
                          const d = app.devices.find((x) => x.id === h.deviceId);
                          const kind = d?.platform === 'linux' ? 'linux' : 'switch';
                          app.execute({ title: 'Повтор из истории', command: h.command, kind, platform: d?.platform ?? 'generic-ssh', risk: classifyCommand(h.command, kind, d?.platform).level, source: 'reference' });
                        }}
                      />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
