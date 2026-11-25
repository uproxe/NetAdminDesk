// Мониторинг: добавление и правка узлов, массовое добавление, подробности узла, настройки.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp, errMsg } from '../lib/store';
import { Icon } from '../lib/icons';
import { Banner, Button, Check, Empty, Field, Modal } from '../components/ui';
import { reloadMonitor, useMonitor } from '../lib/monitor';
import { MONITOR_KINDS, MONITOR_METHODS, STATUS_LABELS, parseBulkNodes, withMonitorDefaults, type MonitorEvent, type MonitorKind, type MonitorMethod, type MonitorNode, type MonitorNodeInput, type MonitorSettings } from '../../shared/monitor';
import { STATUS_COLORS, kindIcon, sinceText } from './MonitorView';

const VENDORS: { id: string; label: string }[] = [
  { id: '', label: 'Не указан' },
  { id: 'cisco', label: 'Cisco' },
  { id: 'osnovo', label: 'OSNOVO' },
  { id: 'usergate', label: 'UserGate' },
  { id: 'linux', label: 'Linux' },
  { id: 'windows', label: 'Windows' },
  { id: 'other', label: 'Другой' }
];

const blank = (): MonitorNodeInput => ({ name: '', host: '', kind: 'switch', vendor: '', method: 'ping', snmpVersion: 2, snmpPort: 161, tcpPort: 0, intervalSec: 0, enabled: true, deviceId: null, notes: '' });

export function NodeEditor({ node, onClose }: { node?: MonitorNode; onClose: () => void }) {
  const app = useApp();
  const mon = useMonitor();
  const [n, setN] = useState<MonitorNodeInput>(() => (node ? { ...node } : blank()));
  const [community, setCommunity] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<MonitorNodeInput>) => setN((x) => ({ ...x, ...p }));
  const canStore = mon.status?.canStoreSecrets ?? true;
  const dup = mon.nodes.find((x) => x.host.trim() === n.host.trim() && x.id !== node?.id && n.host.trim());
  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.monitor.saveNode({ ...n, id: node?.id, community: n.method === 'snmp' ? community : undefined });
      await reloadMonitor();
      app.toast(node ? 'Узел сохранён' : `Узел «${saved.name}» добавлен — проверка запущена`, 'ok');
      onClose();
      void api.monitor.checkNow(saved.id).catch(() => undefined);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const linked = n.deviceId ? app.devices.find((d) => d.id === n.deviceId) : undefined;
  return (
    <Modal
      title={node ? `Узел: ${node.name}` : 'Новый узел мониторинга'}
      width="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={busy || !n.name.trim() || !n.host.trim() || (n.method === 'tcp' && !n.tcpPort)} onClick={save}>
            {node ? 'Сохранить' : 'Добавить'}
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Название" hint="Как узел будет подписан на карте">
          <input className="input" autoFocus value={n.name} placeholder="SW-ACCESS-1, Видеосервер 1…" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="IP-адрес или имя" error={dup ? `Этот адрес уже есть: «${dup.name}»` : undefined}>
          <input className="input mono" value={n.host} placeholder="192.168.1.10" onChange={(e) => set({ host: e.target.value.trim() })} />
        </Field>
        <Field label="Тип">
          <select className="select" value={n.kind} onChange={(e) => set({ kind: e.target.value as MonitorKind })}>
            {MONITOR_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Производитель / ОС" hint="Для подсказок по настройке SNMP">
          <select className="select" value={n.vendor} onChange={(e) => set({ vendor: e.target.value })}>
            {VENDORS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="section-title">Как проверять</div>
      <div className="method-cards">
        {MONITOR_METHODS.map((m) => (
          <label key={m.id} className={`method-card ${n.method === m.id ? 'active' : ''}`}>
            <input type="radio" name="method" checked={n.method === m.id} onChange={() => set({ method: m.id as MonitorMethod, tcpPort: m.id === 'tcp' && !n.tcpPort ? (n.kind === 'camera' || n.kind === 'vms' ? 554 : 80) : n.tcpPort })} />
            <b>{m.label}</b>
            <span className="small muted">{m.hint}</span>
          </label>
        ))}
      </div>
      {n.method === 'snmp' && (
        <div className="grid-3" style={{ marginTop: 10 }}>
          <Field label="Версия SNMP">
            <select className="select" value={n.snmpVersion} onChange={(e) => set({ snmpVersion: Number(e.target.value) === 1 ? 1 : 2 })}>
              <option value={2}>v2c (рекомендуется)</option>
              <option value={1}>v1 (старые устройства)</option>
            </select>
          </Field>
          <Field
            label="Community"
            hint={
              node?.hasCommunity && community === undefined
                ? 'Сохранена. Введите новую, чтобы заменить.'
                : !node?.hasCommunity && !community
                  ? 'Обязательна для SNMP — без неё узел проверяется только ping. Если на устройстве её не меняли, чаще всего это public.'
                  : 'Хранится в защищённом хранилище'
            }
          >
            {/* Подсказка-заглушка не похожа на значение: раньше серое «public» принимали за введённую community */}
            <input className="input" type="password" autoComplete="off" disabled={!canStore} placeholder={node?.hasCommunity ? '•••••••• (сохранена)' : 'не задана'} value={community ?? ''} onChange={(e) => setCommunity(e.target.value)} />
          </Field>
          <Field label="UDP-порт">
            <input className="input" type="number" min={1} max={65535} value={n.snmpPort} onChange={(e) => set({ snmpPort: Number(e.target.value) || 161 })} />
          </Field>
        </div>
      )}
      {n.method === 'snmp' && !canStore && <Banner kind="warn">Хранилище паролей не настроено или заблокировано — community сохранить нельзя. Без неё узел проверяется только ping.</Banner>}
      {n.method === 'tcp' && (
        <div className="grid-3" style={{ marginTop: 10 }}>
          <Field label="TCP-порт" hint="80 — веб, 443 — HTTPS, 22 — SSH, 554 — RTSP, 3389 — RDP">
            <input className="input" type="number" min={1} max={65535} value={n.tcpPort || ''} onChange={(e) => set({ tcpPort: Number(e.target.value) || 0 })} />
          </Field>
        </div>
      )}
      <div className="section-title">Дополнительно</div>
      <div className="grid-3">
        <Field label="Интервал проверки, с" hint={`0 — как в настройках (${app.settings.monitor.defaultIntervalSec} с)`}>
          <input className="input" type="number" min={0} max={3600} value={n.intervalSec} onChange={(e) => set({ intervalSec: Math.max(0, Number(e.target.value) || 0) })} />
        </Field>
        <Field label="Связанное устройство" hint="Чтобы открыть SSH прямо с карты">
          <select className="select" value={n.deviceId ?? ''} onChange={(e) => set({ deviceId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Нет</option>
            {app.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.host})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Проверка">
          <Check checked={n.enabled} onChange={(v) => set({ enabled: v })} label="Включена" />
        </Field>
      </div>
      {linked && linked.host !== n.host && n.host && <div className="small muted">Адрес связанного устройства ({linked.host}) отличается от адреса узла — так бывает, если управление идёт по другому IP.</div>}
      <Field label="Заметка">
        <input className="input" value={n.notes} placeholder="Шкаф 2, этаж 3…" onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

export function BulkAddDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const mon = useMonitor();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MonitorKind>('server');
  const [method, setMethod] = useState<MonitorMethod>('ping');
  const [community, setCommunity] = useState('');
  const [tcpPort, setTcpPort] = useState(80);
  const [busy, setBusy] = useState(false);
  const parsed = parseBulkNodes(text, { kind });
  const existing = new Set(mon.nodes.map((n) => n.host));
  const fresh = parsed.nodes.filter((n) => !existing.has(n.host));
  const add = async () => {
    setBusy(true);
    try {
      const n = await api.monitor.bulkAdd(fresh.map((x) => ({ ...blank(), ...x, method, tcpPort: method === 'tcp' ? tcpPort : 0, community: method === 'snmp' && community ? community : undefined })));
      await reloadMonitor();
      app.toast(`Добавлено узлов: ${n}`, 'ok');
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Добавить узлы списком"
      width="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={busy || !fresh.length} onClick={add}>
            Добавить {fresh.length || ''}
          </Button>
        </>
      }
    >
      <div className="small muted" style={{ marginBottom: 6 }}>
        По одному узлу в строке: <code>название; IP-адрес; тип</code> (тип можно не писать — определится по словам «коммутатор», «сервер», «камера»…) или просто IP-адрес. Диапазон <code>10.10.5.1-20</code> добавит 20 адресов. Можно вставить столбцы из Excel.
      </div>
      <textarea className="input mono" rows={9} value={text} placeholder={'SW-ACCESS-1; 192.168.1.11; коммутатор\nВидеосервер 1; 192.168.1.50; видео\nКамеры; 192.168.2.1-30'} onChange={(e) => setText(e.target.value)} />
      <div className="grid-3" style={{ marginTop: 10 }}>
        <Field label="Тип по умолчанию">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as MonitorKind)}>
            {MONITOR_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Проверка">
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value as MonitorMethod)}>
            {MONITOR_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        {method === 'snmp' && (
          <Field label="Community для всех">
            <input className="input" type="password" value={community} onChange={(e) => setCommunity(e.target.value)} />
          </Field>
        )}
        {method === 'tcp' && (
          <Field label="TCP-порт">
            <input className="input" type="number" value={tcpPort} onChange={(e) => setTcpPort(Number(e.target.value) || 0)} />
          </Field>
        )}
      </div>
      {parsed.errors.map((e, i) => (
        <Banner key={i} kind="warn">
          {e}
        </Banner>
      ))}
      {parsed.nodes.length > 0 && (
        <div className="small" style={{ marginTop: 8 }}>
          Распознано: {parsed.nodes.length}
          {parsed.nodes.length !== fresh.length && `, уже есть в мониторинге: ${parsed.nodes.length - fresh.length} (будут пропущены)`}.{' '}
          <span className="muted">{fresh.slice(0, 6).map((n) => `${n.name} (${n.host})`).join(', ')}{fresh.length > 6 ? '…' : ''}</span>
        </div>
      )}
    </Modal>
  );
}

const DEVICE_KIND: Record<string, MonitorKind> = { linux: 'server', other: 'other' };

export function FromDevicesDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const mon = useMonitor();
  const existing = new Set(mon.nodes.map((n) => n.host));
  const list = app.devices.filter((d) => d.protocol !== 'serial' && !existing.has(d.host));
  const [sel, setSel] = useState<Set<number>>(() => new Set(list.map((d) => d.id)));
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const nodes = list
        .filter((d) => sel.has(d.id))
        .map((d) => ({ ...blank(), name: d.name, host: d.host, kind: DEVICE_KIND[d.deviceType] ?? 'switch', vendor: d.deviceType.startsWith('cisco') ? 'cisco' : d.deviceType === 'osnovo' ? 'osnovo' : d.deviceType === 'linux' ? 'linux' : '', deviceId: d.id, notes: d.location }));
      const n = await api.monitor.bulkAdd(nodes);
      await reloadMonitor();
      app.toast(`Добавлено узлов: ${n}. Проверка — ping; для SNMP откройте узел и укажите community.`, 'ok');
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Добавить из раздела «Устройства»"
      width="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={busy || !sel.size} onClick={add}>
            Добавить {sel.size || ''}
          </Button>
        </>
      }
    >
      {!list.length ? (
        <Empty title="Все устройства уже в мониторинге" />
      ) : (
        <>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Узлы будут проверяться ping и связаны с устройствами — с карты можно сразу открыть SSH.
          </div>
          <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input type="checkbox" checked={sel.size === list.length} onChange={(e) => setSel(e.target.checked ? new Set(list.map((d) => d.id)) : new Set())} />
                  </th>
                  <th>Название</th>
                  <th>Адрес</th>
                  <th>Тип</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} onClick={() => setSel((s) => (s.has(d.id) ? (s.delete(d.id), new Set(s)) : new Set(s.add(d.id))))}>
                    <td>
                      <input type="checkbox" checked={sel.has(d.id)} readOnly />
                    </td>
                    <td>{d.name}</td>
                    <td className="mono small">{d.host}</td>
                    <td className="small">{d.deviceType}</td>
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

export function NodeDetailsDialog({ node, onClose }: { node: MonitorNode; onClose: () => void }) {
  const app = useApp();
  const mon = useMonitor();
  const st = mon.states.get(node.id);
  const status = st?.status ?? 'unknown';
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [ports, setPorts] = useState<Awaited<ReturnType<typeof api.monitor.ports>> | null>(null);
  const [portsErr, setPortsErr] = useState('');
  const [loadingPorts, setLoadingPorts] = useState(false);
  useEffect(() => {
    void api.monitor.events({ nodeId: node.id, limit: 100 }).then(setEvents);
  }, [node.id, mon.events.length]);
  const loadPorts = async () => {
    setLoadingPorts(true);
    setPortsErr('');
    try {
      setPorts(await api.monitor.ports(node.id));
    } catch (e) {
      setPortsErr(errMsg(e));
    } finally {
      setLoadingPorts(false);
    }
  };
  return (
    <Modal
      title={
        <span className="row" style={{ gap: 8 }}>
          <Icon name={kindIcon(node.kind)} /> {node.name}
        </span>
      }
      width="xwide"
      onClose={onClose}
      footer={
        <>
          {node.deviceId && (
            <Button icon="terminal" onClick={() => (void app.connect(node.deviceId!), onClose())}>
              Открыть SSH
            </Button>
          )}
          <Button icon="edit" onClick={() => (onClose(), app.openDialog((close) => <NodeEditor node={node} onClose={close} />))}>
            Изменить
          </Button>
          <Button icon="refresh" onClick={() => void api.monitor.checkNow(node.id)}>
            Проверить сейчас
          </Button>
          <Button variant="primary" onClick={onClose}>
            Закрыть
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <div className="kv">
          <span>Адрес</span>
          <span className="mono">{node.host}</span>
          <span>Состояние</span>
          <b style={{ color: STATUS_COLORS[status] }}>
            {STATUS_LABELS[status]} {status !== 'unknown' && <span className="muted">{sinceText(st?.since)}</span>}
          </b>
          <span>Проверка</span>
          <span>{node.method === 'ping' ? 'ping' : node.method === 'snmp' ? `SNMP v${node.snmpVersion === 1 ? '1' : '2c'}, порт ${node.snmpPort}${node.hasCommunity ? '' : ' — community не задана'}` : `TCP-порт ${node.tcpPort}`}</span>
          <span>Результат</span>
          <span>{st?.message || '—'}</span>
          {st?.latencyMs != null && (
            <>
              <span>Отклик</span>
              <span>{st.latencyMs} мс</span>
            </>
          )}
        </div>
        <div className="kv">
          {st?.sysName && (
            <>
              <span>Имя (SNMP)</span>
              <span>{st.sysName}</span>
            </>
          )}
          {st?.sysDescr && (
            <>
              <span>Описание</span>
              <span className="small">{st.sysDescr}</span>
            </>
          )}
          {st?.uptimeTicks !== undefined && (
            <>
              <span>Работает</span>
              <span>{sinceText(new Date(Date.now() - st.uptimeTicks * 10).toISOString()).replace(/^с /, 'с ')}</span>
            </>
          )}
          {node.notes && (
            <>
              <span>Заметка</span>
              <span>{node.notes}</span>
            </>
          )}
        </div>
      </div>
      {!!st?.portsDown.length && (
        <Banner kind="warn">
          По трапам linkDown упали порты: {st.portsDown.map((p) => `${p.label} (${sinceText(p.since)})`).join(', ')}.{' '}
          <button className="linklike" onClick={() => void api.monitor.clearPorts(node.id)}>
            Сбросить
          </button>
        </Banner>
      )}
      {node.method === 'snmp' && (
        <>
          <div className="section-title row">
            Порты (SNMP)
            <span className="grow" />
            <Button size="sm" icon="refresh" disabled={loadingPorts || !node.hasCommunity} onClick={loadPorts}>
              {ports ? 'Обновить' : 'Показать порты'}
            </Button>
          </div>
          {portsErr && <Banner kind="warn">{portsErr}</Banner>}
          {ports && (
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Порт</th>
                    <th>Описание</th>
                    <th>Состояние</th>
                    <th>Скорость</th>
                  </tr>
                </thead>
                <tbody>
                  {ports.map((p) => (
                    <tr key={p.ifIndex}>
                      <td className="mono small">{p.name}</td>
                      <td className="small">{p.alias}</td>
                      <td className="small" style={{ color: p.admin === 'down' ? 'var(--text-dim)' : p.oper === 'up' ? 'var(--ok)' : 'var(--danger)' }}>
                        {p.admin === 'down' ? 'выключен' : p.oper === 'up' ? 'подключён' : p.oper === 'down' ? 'нет линка' : p.oper}
                      </td>
                      <td className="small">{p.oper === 'up' && p.speedMbps ? (p.speedMbps >= 1000 ? `${p.speedMbps / 1000} Гбит/с` : `${p.speedMbps} Мбит/с`) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="section-title">История</div>
      <div className="mevents" style={{ maxHeight: 220, overflow: 'auto' }}>
        {events.map((e) => (
          <div key={e.id} className={`mevent l-${e.level}`}>
            <span className="t">{new Date(e.ts).toLocaleString('ru-RU')}</span>
            <span className="m">{e.message}</span>
          </div>
        ))}
        {!events.length && <div className="small muted">Событий пока не было.</div>}
      </div>
    </Modal>
  );
}

// ---------- Настройки ----------

export function MonitorSettingsPanel() {
  const app = useApp();
  const mon = useMonitor();
  const [s, setS] = useState<MonitorSettings>(() => withMonitorDefaults(app.settings.monitor));
  const [mailPw, setMailPw] = useState('');
  const [trapCommunity, setTrapCommunity] = useState('');
  const [busy, setBusy] = useState(false);
  const status = mon.status;
  const dirty = JSON.stringify(s) !== JSON.stringify(withMonitorDefaults(app.settings.monitor));
  const set = <K extends keyof MonitorSettings>(k: K, v: Partial<MonitorSettings[K]> | MonitorSettings[K]) => setS((x) => ({ ...x, [k]: typeof v === 'object' && v !== null ? { ...(x[k] as object), ...(v as object) } : v }));
  const apply = async () => {
    setBusy(true);
    try {
      await app.updateSettings({ monitor: s });
      if (mailPw) await api.monitor.setSecret('smtp-password', mailPw);
      if (trapCommunity) await api.monitor.setSecret('trap-community', trapCommunity);
      setMailPw('');
      setTrapCommunity('');
      const st = await api.monitor.applySettings();
      app.toast(s.trap.enabled && !st.trap.listening ? `Настройки сохранены, но трапы не принимаются: ${st.trap.error}` : 'Настройки мониторинга сохранены', s.trap.enabled && !st.trap.listening ? 'error' : 'ok');
      await reloadMonitor();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const testMail = async () => {
    setBusy(true);
    try {
      if (dirty || mailPw) await apply();
      await api.monitor.testMail();
      app.toast(`Тестовое письмо отправлено на ${s.email.to}`, 'ok');
    } catch (e) {
      app.toast(`Письмо не отправлено: ${errMsg(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const ips = status?.localAddresses ?? [];
  const trapIp = ips[0] ?? 'IP_ЭТОГО_КОМПЬЮТЕРА';
  return (
    <div className="settings-grid">
      <div className="card">
        <h3>Проверки</h3>
        <Check checked={s.enabled} onChange={(v) => set('enabled', v)} label="Мониторинг включён" />
        <div className="grid-2" style={{ marginTop: 8 }}>
          <Field label="Интервал проверки, с" hint="Как часто проверять каждый узел">
            <input className="input" type="number" min={5} max={3600} value={s.defaultIntervalSec} onChange={(e) => set('defaultIntervalSec', Math.max(5, Number(e.target.value) || 30))} />
          </Field>
          <Field label="Ожидание ответа, мс">
            <input className="input" type="number" min={300} max={10000} value={s.timeoutMs} onChange={(e) => set('timeoutMs', Math.max(300, Number(e.target.value) || 1500))} />
          </Field>
          <Field label="«Не в сети» после неудач подряд" hint="2 — защита от ложной тревоги при потере одного пакета">
            <input className="input" type="number" min={1} max={10} value={s.failThreshold} onChange={(e) => set('failThreshold', Math.max(1, Math.min(10, Number(e.target.value) || 2)))} />
          </Field>
          <Field label="Одновременных проверок">
            <input className="input" type="number" min={1} max={64} value={s.concurrency} onChange={(e) => set('concurrency', Math.max(1, Math.min(64, Number(e.target.value) || 16)))} />
          </Field>
        </div>
      </div>

      <div className="card">
        <h3>SNMP-трапы</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Устройства сами сообщают о событиях (порт отключился, перезагрузка) на IP этого компьютера. Выключенное устройство трап отправить не может — поэтому «не в сети» определяют проверки, а трапы дополняют их.
        </div>
        <Check checked={s.trap.enabled} onChange={(v) => set('trap', { enabled: v })} label="Принимать SNMP-трапы" />
        <div className="grid-2" style={{ marginTop: 8 }}>
          <Field label="UDP-порт" hint="Стандартный — 162">
            <input className="input" type="number" min={1} max={65535} value={s.trap.port} onChange={(e) => set('trap', { port: Number(e.target.value) || 162 })} />
          </Field>
          <Field label="Адрес приёма" hint="0.0.0.0 — все сетевые интерфейсы">
            <input className="input mono" value={s.trap.bind} onChange={(e) => set('trap', { bind: e.target.value.trim() || '0.0.0.0' })} />
          </Field>
        </div>
        <Check checked={s.trap.linkDownWarn} onChange={(v) => set('trap', { linkDownWarn: v })} label="Трап «порт отключился» отмечает коммутатор жёлтым до трапа «порт включился»" />
        <Check checked={s.trap.logUnknown} onChange={(v) => set('trap', { logUnknown: v })} label="Записывать трапы от адресов, которых нет в мониторинге" />
        <Check checked={s.trap.checkCommunity} onChange={(v) => set('trap', { checkCommunity: v })} label="Принимать трапы только с указанной community" />
        {s.trap.checkCommunity && (
          <Field label="Community трапов" hint={status?.trapCommunity ? 'Сохранена. Введите новую, чтобы заменить.' : 'Хранится в защищённом хранилище'}>
            <input className="input" type="password" value={trapCommunity} placeholder={status?.trapCommunity ? '•••••••• (сохранена)' : ''} onChange={(e) => setTrapCommunity(e.target.value)} />
          </Field>
        )}
        {status?.trap.enabled && (
          <div className="small" style={{ marginTop: 6, color: status.trap.listening ? 'var(--ok)' : 'var(--danger)' }}>
            {status.trap.listening ? `Приём работает: UDP ${status.trap.bind}:${status.trap.port}, принято трапов: ${status.trap.received}, отброшено: ${status.trap.dropped}` : `Приём не работает: ${status.trap.error}`}
          </div>
        )}
        {ips.length > 0 && (
          <div className="small muted" style={{ marginTop: 6 }}>
            Адреса этого компьютера: <span className="mono">{ips.join(', ')}</span> — один из них указывается на устройствах как получатель трапов. Разрешите входящий UDP {s.trap.port} в брандмауэре Windows.
          </div>
        )}
      </div>

      <div className="card">
        <h3>Уведомления</h3>
        <Check checked={s.notify.desktop} onChange={(v) => set('notify', { desktop: v })} label="Уведомление на рабочем столе, когда узел пропал или перезагрузился" />
        <Check checked={s.notify.onRecovery} onChange={(v) => set('notify', { onRecovery: v })} label="Сообщать и о восстановлении («снова в сети»)" />
        <div className="section-title">Работа в фоне</div>
        <Check checked={s.background.keepRunning} onChange={(v) => set('background', { keepRunning: v })} label="При закрытии окна продолжать мониторинг (значок в области уведомлений)" />
        <Check checked={s.background.openAtLogin} onChange={(v) => set('background', { openAtLogin: v })} label="Запускать вместе с Windows (скрыто, в области уведомлений)" />
        <div className="small muted">Мониторинг работает, пока запущена программа. Для круглосуточного наблюдения оставьте её запущенной на компьютере со статическим IP.</div>
      </div>

      <div className="card">
        <h3>Письма на почту</h3>
        <Check checked={s.email.enabled} onChange={(v) => set('email', { enabled: v })} label="Отправлять письмо, когда узел пропал, вернулся или перезагрузился" />
        <div className="grid-3" style={{ marginTop: 8 }}>
          <Field label="SMTP-сервер">
            <input className="input" value={s.email.host} placeholder="smtp.example.com" onChange={(e) => set('email', { host: e.target.value.trim() })} />
          </Field>
          <Field label="Шифрование">
            <select className="select" value={s.email.security} onChange={(e) => set('email', { security: e.target.value as MonitorSettings['email']['security'], port: e.target.value === 'tls' ? 465 : e.target.value === 'starttls' ? 587 : 25 })}>
              <option value="starttls">STARTTLS (порт 587)</option>
              <option value="tls">SSL/TLS (порт 465)</option>
              <option value="none">Без шифрования (порт 25)</option>
            </select>
          </Field>
          <Field label="Порт">
            <input className="input" type="number" value={s.email.port} onChange={(e) => set('email', { port: Number(e.target.value) || 25 })} />
          </Field>
          <Field label="Логин" hint="Пусто — без авторизации (внутренний релей)">
            <input className="input" value={s.email.user} autoComplete="off" onChange={(e) => set('email', { user: e.target.value.trim() })} />
          </Field>
          <Field label="Пароль" hint={status?.emailPassword ? 'Сохранён. Введите новый, чтобы заменить.' : 'Хранится в защищённом хранилище'}>
            <input className="input" type="password" autoComplete="new-password" value={mailPw} placeholder={status?.emailPassword ? '•••••••• (сохранён)' : ''} disabled={!s.email.user} onChange={(e) => setMailPw(e.target.value)} />
          </Field>
          <Field label="Отправитель">
            <input className="input" value={s.email.from} placeholder="monitor@example.com" onChange={(e) => set('email', { from: e.target.value.trim() })} />
          </Field>
        </div>
        <Field label="Получатели" hint="Через запятую">
          <input className="input" value={s.email.to} placeholder="admin@example.com, duty@example.com" onChange={(e) => set('email', { to: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Собирать события в одно письмо, с" hint="Если упал коммутатор, а за ним 20 камер — придёт одно письмо, а не 21">
            <input className="input" type="number" min={5} max={3600} value={s.email.delaySec} onChange={(e) => set('email', { delaySec: Math.max(5, Number(e.target.value) || 60) })} />
          </Field>
          <div>
            <Check checked={s.email.includeTraps} onChange={(v) => set('email', { includeTraps: v })} label="Включать трапы (порты, перезагрузки)" />
            <Check checked={s.email.allowInvalidCert} onChange={(v) => set('email', { allowInvalidCert: v })} label="Не проверять сертификат сервера (самоподписанный)" />
          </div>
        </div>
        {s.email.security === 'none' && s.email.user && <Banner kind="warn">Без шифрования логин и пароль почты передаются по сети открыто. Используйте STARTTLS или SSL/TLS, если сервер их поддерживает.</Banner>}
        {status?.lastMailError && <Banner kind="warn">Последняя ошибка отправки: {status.lastMailError}</Banner>}
        <Button icon="mail" disabled={busy || !s.email.host || !s.email.from || !s.email.to} onClick={testMail} style={{ marginTop: 6 }}>
          Отправить тестовое письмо
        </Button>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h3>Как настроить устройства</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Для проверки ping на устройствах ничего настраивать не нужно. Для SNMP — разрешите опрос с IP этого компьютера ({trapIp}); для трапов — укажите его как получателя. Подробно — «Обучение → Мониторинг сети».
        </div>
        <div className="grid-2">
          <div>
            <b>Cisco IOS</b>
            <pre className="cmd-block">{`conf t\nsnmp-server community ВАША_COMMUNITY RO\nsnmp-server host ${trapIp} version 2c ВАША_COMMUNITY\nsnmp-server enable traps snmp linkdown linkup coldstart warmstart\nend\nwrite memory`}</pre>
          </div>
          <div>
            <b>Linux (snmpd)</b>
            <pre className="cmd-block">{`sudo apt install snmpd\n# /etc/snmp/snmpd.conf:\nagentAddress udp:161\nrocommunity ВАША_COMMUNITY ${trapIp}\ntrap2sink ${trapIp} ВАША_COMMUNITY\nsudo systemctl restart snmpd`}</pre>
          </div>
          <div>
            <b>OSNOVO и другие коммутаторы с веб-интерфейсом</b>
            <div className="small">
              Раздел SNMP в веб-интерфейсе: включите SNMP v2c, задайте community только для чтения, в получателях трапов (Trap Receiver / Trap Host) укажите {trapIp}. Названия пунктов зависят от модели и прошивки.
            </div>
          </div>
          <div>
            <b>UserGate NGFW</b>
            <div className="small">
              В свойствах зоны интерфейса, через который будут идти запросы, на вкладке «Контроль доступа» разрешите сервис SNMP. Создайте правило SNMP: версия v2c, community, «Разрешить SNMP-запросы», при необходимости «Разрешить SNMP-трапы» с адресом сервера трапов {trapIp}:162.
            </div>
          </div>
        </div>
      </div>
      <div className="settings-actions">
        <Button variant="primary" icon="check" disabled={busy || (!dirty && !mailPw && !trapCommunity)} onClick={apply}>
          Сохранить настройки мониторинга
        </Button>
      </div>
    </div>
  );
}
