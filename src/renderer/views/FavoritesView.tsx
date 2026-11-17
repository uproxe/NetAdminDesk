// Избранное: команды, устройства и сценарии в одном месте.
import { useState } from 'react';
import { useApp } from '../lib/store';
import { Button, Empty, StatusDot } from '../components/ui';
import { CommandCard } from '../components/Commands';
import { CommandListItem } from './ReferenceView';
import { getPlatform } from '../../shared/platforms';
import { plural } from '../lib/format';

export function FavoritesView() {
  const app = useApp();
  const cmds = app.commands.filter((c) => c.favorite);
  const devices = app.devices.filter((d) => d.favorite);
  const scenarios = app.scenarios.filter((s) => s.favorite);
  const [sel, setSel] = useState<number | null>(cmds[0]?.id ?? null);
  const c = app.commands.find((x) => x.id === sel);
  return (
    <div className="columns">
      <div className="col col-list">
        <div className="col-body">
          <div className="section-title" style={{ padding: '0 14px' }}>
            Устройства ({devices.length})
          </div>
          {!devices.length && <div className="small faint" style={{ padding: '0 14px 8px' }}>Отметьте устройство звёздочкой в разделе «Устройства».</div>}
          {devices.map((d) => (
            <div key={d.id} className="list-item" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <StatusDot status={d.lastStatus} />
              <div className="grow">
                <div style={{ fontWeight: 550 }}>{d.name}</div>
                <div className="cmd">
                  {d.host} · {getPlatform(d.platform).name}
                </div>
              </div>
              <Button size="sm" variant="primary" icon="plug" onClick={() => void app.connect(d.id)}>
                Подключить
              </Button>
            </div>
          ))}
          <div className="section-title" style={{ padding: '0 14px' }}>
            Сценарии ({scenarios.length})
          </div>
          {scenarios.map((s) => (
            <div key={s.id} className="list-item" onClick={() => app.setSection('scenarios')}>
              <div className="title">
                <span className="t">{s.name}</span>
              </div>
              <div className="small muted">{s.steps.length} {plural(s.steps.length, 'шаг', 'шага', 'шагов')}</div>
            </div>
          ))}
          <div className="section-title" style={{ padding: '0 14px' }}>
            Команды ({cmds.length})
          </div>
          {!cmds.length && <div className="small faint" style={{ padding: '0 14px 8px' }}>Нажмите «В избранное» в карточке команды.</div>}
          {cmds.map((x) => (
            <CommandListItem key={x.id} c={x} active={x.id === sel} onClick={() => setSel(x.id)} />
          ))}
        </div>
      </div>
      <div className="col col-detail">{c ? <CommandCard c={c} /> : <Empty icon="star" title="Избранное пусто" />}</div>
    </div>
  );
}
