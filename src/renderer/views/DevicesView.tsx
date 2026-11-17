// Устройства: группы и папки, поиск, сортировка, подключение одним нажатием, карточка устройства.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, errMsg } from '../lib/store';
import { Icon } from '../lib/icons';
import { Banner, Button, Check, Empty, Field, Modal, StatusDot } from '../components/ui';
import { DeviceEditor, blankDevice, colorCss, PROTOCOL_LABELS } from '../components/DeviceEditor';
import { fmtAgo, fmtDate } from '../lib/format';
import { getPlatform } from '../../shared/platforms';
import type { Device, DeviceGroup, DeviceSecretsState, KnownHost } from '../../shared/types';
import type { DevicesFilePreview, DevicesPreview } from '../../shared/ipc';

type GroupFilter = 'all' | 'fav' | 'none' | number;

export function DevicesView() {
  const app = useApp();
  const [group, setGroup] = useState<GroupFilter>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'name' | 'last' | 'host'>('name');
  const [selected, setSelected] = useState<number | null>(null);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let l = app.devices.filter((d) => {
      if (group === 'fav' && !d.favorite) return false;
      if (group === 'none' && d.groupId) return false;
      if (typeof group === 'number') {
        const ids = descendants(app.groups, group);
        if (!d.groupId || !ids.has(d.groupId)) return false;
      }
      if (!ql) return true;
      return [d.name, d.host, d.description, d.location, d.model, d.tags.join(' '), getPlatform(d.platform).name, d.hostname].join(' ').toLowerCase().includes(ql);
    });
    l = [...l].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'host' ? a.host.localeCompare(b.host, undefined, { numeric: true }) : (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? '')));
    return l;
  }, [app.devices, app.groups, group, q, sort]);

  const sel = app.devices.find((d) => d.id === selected) ?? null;

  const addGroup = (kind: 'group' | 'folder', parentId: number | null = null) =>
    app.openDialog((close) => <GroupDialog onClose={close} kind={kind} parentId={parentId} />);

  return (
    <div className="columns">
      <div className="col col-filter">
        <div className="filter-group">
          <div className="filter-title">Устройства</div>
          {(
            [
              ['all', 'Все устройства', app.devices.length],
              ['fav', 'Избранные', app.devices.filter((d) => d.favorite).length],
              ['none', 'Без группы', app.devices.filter((d) => !d.groupId).length]
            ] as [GroupFilter, string, number][]
          ).map(([id, label, n]) => (
            <button key={String(id)} className={`filter-item ${group === id ? 'active' : ''}`} onClick={() => setGroup(id)}>
              {label}
              <span className="n">{n}</span>
            </button>
          ))}
        </div>
        <div className="filter-group">
          <div className="row" style={{ margin: '0 4px 6px' }}>
            <div className="filter-title grow" style={{ margin: 0 }}>
              Группы и папки
            </div>
            <Button size="sm" variant="ghost" iconOnly icon="plus" title="Новая группа" onClick={() => addGroup('group')} />
            <Button size="sm" variant="ghost" iconOnly icon="folder" title="Новая папка" onClick={() => addGroup('folder')} />
          </div>
          <GroupTree groups={app.groups} parentId={null} depth={0} active={group} onSelect={setGroup} devices={app.devices} />
          {!app.groups.length && <div className="small faint" style={{ padding: '0 8px' }}>Создайте группы: Core-коммутаторы, Access, Камеры, Linux-серверы…</div>}
        </div>
      </div>
      <div className="col col-list">
        <div className="col-header" style={{ flexWrap: 'wrap' }}>
          <input className="input" style={{ minWidth: 110, flex: '1 1 110px' }} placeholder="Поиск по имени, адресу, тегам…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ width: 130, flexShrink: 0 }} title="Сортировка" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="name">По названию</option>
            <option value="host">По адресу</option>
            <option value="last">По подключению</option>
          </select>
          <Button variant="primary" icon="plus" onClick={() => app.openDialog((close) => <DeviceEditor onClose={close} initial={typeof group === 'number' ? { ...blankDevice(), groupId: group } : undefined} onSaved={(d) => setSelected(d.id)} />)}>
            Добавить
          </Button>
          <Button icon="upload" title="Добавить устройства из файла: с другого компьютера (файл NetAdmin Desk), из таблицы CSV или ~/.ssh/config" onClick={() => app.openDialog((close) => <ImportDevicesDialog onClose={close} />)}>
            Импорт
          </Button>
          <Button
            icon="download"
            disabled={!app.devices.length}
            title="Сохранить устройства в файл — чтобы перенести их на другой компьютер или открыть в Excel"
            onClick={() =>
              app.openDialog((close) => (
                <ExportDevicesDialog
                  onClose={close}
                  groupId={typeof group === 'number' ? group : null}
                  visibleIds={list.map((d) => d.id)}
                  filtered={group !== 'all' || !!q.trim()}
                  selected={sel}
                />
              ))
            }
          >
            Экспорт
          </Button>
        </div>
        <div className="col-body">
          {!list.length && (
            <Empty icon="server" title={app.devices.length ? 'Ничего не найдено' : 'Устройств пока нет'}>
              {!app.devices.length && 'Добавьте устройство один раз — дальше подключение одним нажатием.'}
            </Empty>
          )}
          <table className="table">
            {list.length > 0 && (
              <thead>
                <tr>
                  <th style={{ width: 24 }} />
                  <th>Устройство</th>
                  <th>Адрес</th>
                  <th>Тип</th>
                  <th>Подключение</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
            )}
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className={selected === d.id ? 'active' : ''} onClick={() => setSelected(d.id)} onDoubleClick={() => void app.connect(d.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <StatusDot status={d.lastStatus} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 550, whiteSpace: 'nowrap' }} className="row">
                      {d.color && <span className="color-dot" style={{ background: colorCss(d.color) }} />}
                      {d.favorite && <Icon name="star" size={12} style={{ color: 'var(--warn)' }} />}
                      {d.name}
                      {d.protocol !== 'ssh' && <span className={`proto-badge ${d.protocol}`}>{PROTOCOL_LABELS[d.protocol]}</span>}
                    </div>
                    <div className="small muted">{[app.groups.find((g) => g.id === d.groupId)?.name, d.location, d.tags.join(', ')].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="mono small" style={{ whiteSpace: 'nowrap' }}>
                    {d.protocol === 'serial' ? (
                      `${d.host} · ${d.serialBaud}`
                    ) : (
                      <>
                        {d.username ? `${d.username}@` : ''}
                        {d.host}
                        {d.port !== (d.protocol === 'telnet' ? 23 : 22) ? `:${d.port}` : ''}
                      </>
                    )}
                  </td>
                  <td className="small">{getPlatform(d.platform).name}</td>
                  <td className="small muted" title={d.lastError || undefined}>
                    {d.lastStatus === 'error' ? <span style={{ color: 'var(--crit)' }}>ошибка</span> : fmtAgo(d.lastConnectedAt)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="primary" iconOnly icon="plug" title="Подключиться (или двойной щелчок по строке)" onClick={() => void app.connect(d.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="col col-detail" style={{ width: 380, minWidth: 340 }}>{sel ? <DeviceDetail d={sel} onDeleted={() => setSelected(null)} /> : <Empty icon="server" title="Выберите устройство" />}</div>
    </div>
  );
}

function descendants(groups: DeviceGroup[], id: number): Set<number> {
  const out = new Set<number>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups) if (g.parentId && out.has(g.parentId) && !out.has(g.id)) (out.add(g.id), (changed = true));
  }
  return out;
}

function GroupTree({ groups, parentId, depth, active, onSelect, devices }: { groups: DeviceGroup[]; parentId: number | null; depth: number; active: GroupFilter; onSelect: (g: GroupFilter) => void; devices: Device[] }) {
  const app = useApp();
  const items = groups.filter((g) => g.parentId === parentId);
  return (
    <>
      {items.map((g) => {
        const ids = descendants(groups, g.id);
        const n = devices.filter((d) => d.groupId && ids.has(d.groupId)).length;
        return (
          <div key={g.id}>
            <div
              className={`tree-item ${active === g.id ? 'active' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onSelect(g.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                app.openDialog((close) => <GroupDialog onClose={close} group={g} kind={g.kind} parentId={g.parentId} />);
              }}
              title="Правая кнопка — изменить"
            >
              <Icon name={g.kind === 'folder' ? 'folder' : 'tag'} size={14} />
              <span className="ellipsis">{g.name}</span>
              <span className="n">{n}</span>
            </div>
            <GroupTree groups={groups} parentId={g.id} depth={depth + 1} active={active} onSelect={onSelect} devices={devices} />
          </div>
        );
      })}
    </>
  );
}

function GroupDialog({ onClose, group, kind, parentId }: { onClose: () => void; group?: DeviceGroup; kind: 'group' | 'folder'; parentId: number | null }) {
  const app = useApp();
  const [name, setName] = useState(group?.name ?? '');
  const [parent, setParent] = useState<number | null>(parentId);
  const save = async () => {
    if (!name.trim()) return;
    await api.groups.save({ id: group?.id, name: name.trim(), parentId: parent, kind, sort: group?.sort ?? 0 });
    await app.refresh('devices');
    onClose();
  };
  const remove = async () => {
    if (!group) return;
    if (!(await app.confirm({ title: 'Удалить группу?', text: `Устройства группы «${group.name}» останутся без группы.`, okText: 'Удалить', danger: true }))) return;
    await api.groups.remove(group.id);
    await app.refresh('devices');
    onClose();
  };
  return (
    <Modal
      title={group ? `Изменить: ${group.name}` : kind === 'folder' ? 'Новая папка' : 'Новая группа'}
      onClose={onClose}
      footer={
        <>
          {group && (
            <Button className="left" variant="ghost" icon="trash" onClick={remove}>
              Удалить
            </Button>
          )}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>
            Сохранить
          </Button>
        </>
      }
    >
      <Field label="Название">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="Core-коммутаторы" />
      </Field>
      <Field label="Внутри">
        <select className="select" value={parent ?? ''} onChange={(e) => setParent(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— верхний уровень —</option>
          {app.groups
            .filter((g) => g.id !== group?.id)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </select>
      </Field>
    </Modal>
  );
}

function DeviceDetail({ d, onDeleted }: { d: Device; onDeleted: () => void }) {
  const app = useApp();
  const [secrets, setSecrets] = useState<DeviceSecretsState | null>(null);
  const [known, setKnown] = useState<KnownHost | null>(null);
  useEffect(() => {
    void api.devices.secretsState(d.id).then(setSecrets);
    void api.devices.knownHosts().then((l) => setKnown(l.find((k) => k.host === d.host.toLowerCase() && k.port === d.port) ?? null));
  }, [d]);
  const p = getPlatform(d.platform);
  const remove = async () => {
    if (!(await app.confirm({ title: 'Удалить устройство?', text: `«${d.name}» и сохранённые для него пароли будут удалены.`, okText: 'Удалить', danger: true }))) return;
    await api.devices.remove(d.id);
    await app.refresh('devices');
    onDeleted();
  };
  const forget = async () => {
    if (!known) return;
    if (!(await app.confirm({ title: 'Забыть ключ хоста?', text: 'При следующем подключении отпечаток ключа будет запрошен заново. Делайте это, только если ключ сменился легитимно.', okText: 'Забыть', danger: true }))) return;
    await api.devices.forgetHostKey(known.host, known.port);
    setKnown(null);
  };
  return (
    <div className="detail">
      <div className="row" style={{ marginBottom: 6 }}>
        <StatusDot status={d.lastStatus} />
        <h2 className="grow" style={{ margin: 0 }}>
          {d.name}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon="star"
          title="Избранное"
          style={{ color: d.favorite ? 'var(--warn)' : undefined }}
          onClick={async () => {
            await api.devices.setFavorite(d.id, !d.favorite);
            await app.refresh('devices');
          }}
        />
      </div>
      <div className="muted small">{p.name}</div>
      <div className="btn-row" style={{ margin: '14px 0' }}>
        <Button variant="primary" icon="plug" onClick={() => void app.connect(d.id)}>
          Подключить
        </Button>
        <Button icon="edit" onClick={() => app.openDialog((close) => <DeviceEditor initial={d} onClose={close} />)}>
          Изменить
        </Button>
        <Button
          icon="copy"
          onClick={async () => {
            try {
              await api.devices.duplicate(d.id);
              await app.refresh('devices');
              app.toast('Создана копия карточки', 'ok');
            } catch (e) {
              app.toast(errMsg(e), 'error');
            }
          }}
        >
          Дублировать
        </Button>
        <Button variant="ghost" icon="trash" onClick={remove}>
          Удалить
        </Button>
      </div>
      {d.lastStatus === 'error' && d.lastError && <Banner kind="crit">Последняя ошибка: {d.lastError}</Banner>}
      <dl className="kv">
        <dt>{d.protocol === 'serial' ? 'COM-порт' : 'Адрес'}</dt>
        <dd className="mono">
          {d.protocol === 'serial' ? `${d.host}, ${d.serialBaud} бод, 8N1` : `${d.host}:${d.port}`} <span className={`proto-badge ${d.protocol}`}>{PROTOCOL_LABELS[d.protocol]}</span>
        </dd>
        <dt>Логин</dt>
        <dd className="mono">{d.username || '—'}</dd>
        <dt>Авторизация</dt>
        <dd>{{ password: 'пароль', key: `SSH-ключ ${d.keyPath}`, agent: 'SSH Agent', 'keyboard-interactive': 'keyboard-interactive' }[d.authMethod]}</dd>
        <dt>Секреты</dt>
        <dd>
          {secrets && (
            <span className="row wrap" style={{ gap: 4 }}>
              {secrets.password && <span className="badge ok">пароль</span>}
              {secrets.keyPassphrase && <span className="badge ok">пароль ключа</span>}
              {secrets.enablePassword && <span className="badge ok">enable</span>}
              {!secrets.password && !secrets.keyPassphrase && !secrets.enablePassword && <span className="faint">не сохранены</span>}
            </span>
          )}
        </dd>
        {d.model && (
          <>
            <dt>Модель</dt>
            <dd>{d.model}</dd>
          </>
        )}
        {d.osVersion && (
          <>
            <dt>Версия ПО</dt>
            <dd>{d.osVersion}</dd>
          </>
        )}
        {d.location && (
          <>
            <dt>Расположение</dt>
            <dd>{d.location}</dd>
          </>
        )}
        {d.jumpDeviceId && (
          <>
            <dt>Jump Host</dt>
            <dd>{app.devices.find((x) => x.id === d.jumpDeviceId)?.name}</dd>
          </>
        )}
        {d.platform === 'linux' && (
          <>
            <dt>Дистрибутив</dt>
            <dd>
              {d.linuxDistro} {d.linuxVersion}
            </dd>
            {d.serverType && (
              <>
                <dt>Тип сервера</dt>
                <dd>{d.serverType}</dd>
              </>
            )}
            {d.servicesNotes && (
              <>
                <dt>Службы</dt>
                <dd>{d.servicesNotes}</dd>
              </>
            )}
          </>
        )}
        <dt>Последнее подключение</dt>
        <dd>{fmtDate(d.lastConnectedAt)}</dd>
        <dt>Опции</dt>
        <dd className="row wrap" style={{ gap: 4 }}>
          {d.legacyAlgorithms && <span className="badge warn">устаревшие алгоритмы</span>}
          {d.protocol === 'telnet' && <span className="badge warn">Telnet без шифрования</span>}
          {d.loginCommands.trim() && <span className="badge outline" title={d.loginCommands}>команды после входа</span>}
          {d.readOnly && <span className="badge warn">только чтение</span>}
          {d.autoEnable && <span className="badge outline">auto-enable</span>}
          {d.disablePagerOnConnect && <span className="badge outline">без --More--</span>}
          {d.keepaliveSec > 0 && <span className="badge outline">keepalive {d.keepaliveSec} с</span>}
        </dd>
      </dl>
      {d.description && <div className="desc" style={{ marginTop: 12 }}>{d.description}</div>}
      <div className="detail-section">
        <div className="label">Ключ хоста SSH</div>
        {known ? (
          <>
            <div className="fingerprint">
              {known.keyType} {known.fingerprint}
            </div>
            <div className="row small muted" style={{ marginTop: 6 }}>
              <span className="grow">Принят {fmtDate(known.firstSeen)}</span>
              <Button size="sm" variant="ghost" onClick={forget}>
                Забыть ключ
              </Button>
            </div>
          </>
        ) : (
          <div className="small muted">Ещё не подключались — отпечаток будет показан при первом подключении.</div>
        )}
      </div>
      <div className="detail-section">
        <div className="btn-row">
          <Button size="sm" icon="activity" onClick={() => app.setSection('diagnostics')}>
            Диагностика
          </Button>
          <Button size="sm" icon="archive" onClick={() => app.setSection('backups')}>
            Резервные копии
          </Button>
          <Button size="sm" icon="history" onClick={() => app.setSection('history')}>
            История
          </Button>
        </div>
      </div>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function vaultCanStore(v: ReturnType<typeof useApp>['vault']): boolean {
  if (!v) return false;
  return v.mode === 'os' ? v.osSecure : v.mode === 'master' ? v.unlocked : false;
}

/** Экспорт устройств: файл переноса на другой компьютер или таблица CSV. */
export function ExportDevicesDialog({ onClose, groupId, visibleIds, filtered, selected }: { onClose: () => void; groupId: number | null; visibleIds: number[]; filtered: boolean; selected: Device | null }) {
  const app = useApp();
  type Scope = 'all' | 'visible' | 'selected';
  const [scope, setScope] = useState<Scope>(filtered && visibleIds.length ? 'visible' : 'all');
  const [format, setFormat] = useState<'nad' | 'csv'>('nad');
  const [knownHosts, setKnownHosts] = useState(true);
  const [secrets, setSecrets] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const canRead = vaultCanStore(app.vault);
  const ids = scope === 'all' ? undefined : scope === 'visible' ? visibleIds : selected ? [selected.id] : [];
  const count = ids ? ids.length : app.devices.length;
  const groupName = groupId ? app.groups.find((g) => g.id === groupId)?.name : null;
  const pwError = format === 'nad' && secrets ? (pw.length < 8 ? 'Пароль файла — не короче 8 символов' : pw !== pw2 ? 'Пароли не совпадают' : '') : '';
  const save = async () => {
    const ext = format === 'csv' ? 'csv' : 'nadevices';
    const path = await api.app.selectSaveFile({
      title: format === 'csv' ? 'Сохранить таблицу устройств' : 'Сохранить файл переноса устройств',
      defaultPath: `netadmin-devices-${today()}.${ext}`,
      filters: format === 'csv' ? [{ name: 'Таблица CSV', extensions: ['csv'] }] : [{ name: 'Устройства NetAdmin Desk', extensions: ['nadevices', 'json'] }]
    });
    if (!path) return;
    setBusy(true);
    try {
      if (format === 'csv') {
        const n = await api.io.exportDevicesCsv(path, ids);
        app.toast(`Сохранено устройств: ${n}. Пароли в таблицу не записываются.`, 'ok');
      } else {
        const r = await api.io.exportDevices(path, { deviceIds: ids, knownHosts, secrets, password: secrets ? pw : undefined });
        const parts = [`устройств: ${r.devices}`, r.jumpAdded ? `из них узлов-посредников, добавленных автоматически: ${r.jumpAdded}` : '', r.groups ? `групп: ${r.groups}` : '', knownHosts ? `ключей хостов: ${r.knownHosts}` : '', secrets ? `паролей: ${r.secrets} (файл зашифрован)` : 'без паролей'];
        app.toast(`Файл сохранён — ${parts.filter(Boolean).join(', ')}.`, 'ok');
      }
      void api.app.showItemInFolder(path);
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Экспорт устройств"
      width="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon="download" disabled={busy || !count || !!pwError} onClick={save}>
            Сохранить файл…
          </Button>
        </>
      }
    >
      <Banner>
        Перенос на другой компьютер: сохраните файл, скопируйте его (флешка, сетевая папка, почта) и на другом компьютере откройте <b>«Устройства → Импорт → С другого компьютера»</b>. Устройства, которые там уже есть, не задвоятся.
      </Banner>
      <div className="section-title">Какие устройства</div>
      <div className="stack" style={{ gap: 4 }}>
        <label className="check">
          <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
          <span>Все устройства ({app.devices.length})</span>
        </label>
        {filtered && (
          <label className="check">
            <input type="radio" name="scope" checked={scope === 'visible'} onChange={() => setScope('visible')} disabled={!visibleIds.length} />
            <span>
              Показанные в списке ({visibleIds.length}){groupName ? ` — группа «${groupName}»` : ''}
            </span>
          </label>
        )}
        {selected && (
          <label className="check">
            <input type="radio" name="scope" checked={scope === 'selected'} onChange={() => setScope('selected')} />
            <span>Только выбранное: {selected.name}</span>
          </label>
        )}
      </div>
      <div className="section-title">Формат</div>
      <div className="stack" style={{ gap: 4 }}>
        <label className="check">
          <input type="radio" name="fmt" checked={format === 'nad'} onChange={() => setFormat('nad')} />
          <span>
            <b>Файл переноса NetAdmin Desk</b> (.nadevices) — рекомендуется. Сохраняет все настройки подключения, группы и папки, узлы-посредники, цвета и команды после входа.
          </span>
        </label>
        <label className="check">
          <input type="radio" name="fmt" checked={format === 'csv'} onChange={() => setFormat('csv')} />
          <span>
            <b>Таблица CSV</b> — для Excel и учёта. Основные поля (название, адрес, порт, логин, тип, группа); без паролей и ключей хостов.
          </span>
        </label>
      </div>
      {format === 'nad' && (
        <>
          <div className="section-title">Что ещё включить</div>
          <Check checked={knownHosts} onChange={setKnownHosts} label="Ключи хостов (отпечатки SSH) этих устройств — на новом компьютере не придётся заново подтверждать подключение" />
          <label className="check">
            <input type="checkbox" checked={secrets} disabled={!canRead} onChange={(e) => setSecrets(e.target.checked)} />
            <span>
              Сохранённые пароли и фразы ключей{!canRead && ' — недоступно: хранилище паролей не настроено или заблокировано («Настройки → Пароли»)'}
            </span>
          </label>
          {secrets && (
            <>
              <Banner kind="warn">
                Файл будет <b>зашифрован</b> (AES-256-GCM, ключ из пароля через scrypt). Без пароля файла его не открыть — ни вам, ни постороннему. Сообщите пароль получателю <b>отдельно</b>, не в том же письме или чате, что файл.
              </Banner>
              <div className="grid-2">
                <Field label="Пароль файла (не короче 8 символов)">
                  <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                </Field>
                <Field label="Повторите пароль">
                  <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                </Field>
              </div>
              {pwError && pw && <div className="small" style={{ color: 'var(--warn)' }}>{pwError}</div>}
            </>
          )}
          {!secrets && <div className="small muted" style={{ marginTop: 6 }}>Без паролей файл не шифруется: в нём адреса, логины и настройки, но не пароли. Пароли на новом компьютере программа спросит при первом подключении.</div>}
        </>
      )}
      <div className="small muted" style={{ marginTop: 10 }}>
        Будет сохранено устройств: <b>{count}</b>
        {format === 'nad' && ' (плюс узлы-посредники, через которые они подключаются, — автоматически)'}. Файлы SSH-ключей в экспорт не входят — скопируйте их отдельно.
      </div>
    </Modal>
  );
}

export function ImportDevicesDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [kind, setKind] = useState<'nad' | 'csv' | 'ssh'>('nad');
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<DevicesPreview | null>(null);
  const [nad, setNad] = useState<DevicesFilePreview | null>(null);
  const [filePw, setFilePw] = useState('');
  const [skipDup, setSkipDup] = useState(true);
  const [importPw, setImportPw] = useState(false);
  const [importKnown, setImportKnown] = useState(true);
  const [busy, setBusy] = useState(false);
  const canStore = vaultCanStore(app.vault);
  const reset = (k: 'nad' | 'csv' | 'ssh') => {
    setKind(k);
    setPreview(null);
    setNad(null);
    setPath(null);
    setFilePw('');
    setImportPw(false);
  };
  const load = async (k: 'nad' | 'csv' | 'ssh', p?: string | null, pw?: string) => {
    try {
      if (k === 'nad') setNad(await api.io.previewDevicesFile(p!, pw || undefined));
      else setPreview(k === 'csv' ? await api.io.previewDevicesCsv(p!) : await api.io.previewSshConfig(p ?? undefined));
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const pick = async () => {
    const filters = kind === 'csv' ? [{ name: 'CSV', extensions: ['csv', 'txt'] }] : kind === 'nad' ? [{ name: 'Файлы NetAdmin Desk', extensions: ['nadevices', 'json', 'nadx'] }] : undefined;
    const p = await api.app.selectFile({ title: kind === 'csv' ? 'CSV-файл с устройствами' : kind === 'nad' ? 'Файл переноса устройств NetAdmin Desk' : 'Файл ssh config', filters });
    if (p) {
      setPath(p);
      setNad(null);
      setFilePw('');
      await load(kind, p);
    }
  };
  const doImport = async () => {
    setBusy(true);
    try {
      if (kind === 'nad') {
        const r = await api.io.importDevicesFile(path!, { password: filePw || undefined, overwrite: !skipDup, knownHosts: importKnown, secrets: importPw });
        const parts = [
          `добавлено устройств: ${r.devices}`,
          r.devicesUpdated ? `обновлено: ${r.devicesUpdated}` : '',
          r.devicesSkipped ? `уже были, пропущены: ${r.devicesSkipped}` : '',
          r.groups ? `новых групп: ${r.groups}` : '',
          importKnown && r.knownHosts ? `ключей хостов: ${r.knownHosts}` : '',
          r.knownHostConflicts ? `ключей хостов НЕ заменено (отличаются от известных): ${r.knownHostConflicts}` : '',
          importPw ? `паролей: ${r.secrets ?? 0}` : '',
          r.secretsSkipped ? `паролей пропущено — хранилище недоступно: ${r.secretsSkipped}` : ''
        ];
        await app.refresh('devices');
        app.toast(parts.filter(Boolean).join(', '), r.knownHostConflicts || r.secretsSkipped ? 'warn' : 'ok');
      } else {
        const n = kind === 'csv' ? await api.io.importDevicesCsv(path!, { importPasswords: importPw, skipDuplicates: skipDup }) : await api.io.importSshConfig(path ?? undefined, { skipDuplicates: skipDup });
        await app.refresh('devices');
        app.toast(`Импортировано устройств: ${n}`, 'ok');
      }
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const ready = kind === 'nad' ? !!nad && !nad.needsPassword && nad.devices.length > 0 : !!preview?.devices.length;
  const dupCount = kind === 'nad' ? nad?.devices.filter((d) => d.duplicateOf).length ?? 0 : preview?.devices.filter((d) => d.duplicateOf).length ?? 0;
  return (
    <Modal
      title="Импорт устройств"
      width="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!ready || busy} onClick={doImport}>
            Импортировать
          </Button>
        </>
      }
    >
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <Button variant={kind === 'nad' ? 'primary' : 'default'} onClick={() => reset('nad')} title="Файл, сохранённый кнопкой «Экспорт» в NetAdmin Desk на другом компьютере">
          С другого компьютера
        </Button>
        <Button variant={kind === 'csv' ? 'primary' : 'default'} onClick={() => reset('csv')}>
          Таблица CSV
        </Button>
        <Button
          variant={kind === 'ssh' ? 'primary' : 'default'}
          onClick={() => {
            reset('ssh');
            void load('ssh', null);
          }}
        >
          ~/.ssh/config
        </Button>
        <Button icon="folder" onClick={pick}>
          Выбрать файл…
        </Button>
        {path && <span className="small muted mono ellipsis">{path}</span>}
      </div>
      {kind === 'nad' && !nad && (
        <Banner>
          Выберите файл <b>.nadevices</b>, сохранённый в NetAdmin Desk кнопкой «Устройства → Экспорт». Подойдёт и файл «Экспорт данных» или зашифрованная копия из «Настроек» — из них будут взяты только устройства, группы и ключи хостов. Перед импортом вы увидите список устройств.
        </Banner>
      )}
      {kind === 'nad' && nad?.needsPassword && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ marginBottom: 8 }}>
            Файл зашифрован — в нём сохранены пароли. Введите пароль, который задали при экспорте.
          </div>
          <div className="row">
            <input
              className="input grow"
              type="password"
              autoFocus
              placeholder="Пароль файла"
              value={filePw}
              onChange={(e) => setFilePw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && filePw && void load('nad', path, filePw)}
            />
            <Button variant="primary" disabled={!filePw} onClick={() => void load('nad', path, filePw)}>
              Открыть
            </Button>
          </div>
        </div>
      )}
      {kind === 'nad' && nad && !nad.needsPassword && (
        <>
          <div className="small muted" style={{ marginBottom: 8 }}>
            {nad.content === 'devices' ? 'Файл переноса устройств' : nad.content === 'full' ? 'Полная копия данных — будут взяты только устройства, группы и ключи хостов' : 'Экспорт данных — будут взяты только устройства и группы'}
            {nad.createdAt && `, создан ${fmtDate(nad.createdAt)}`}
            {nad.appVersion && `, версия программы ${nad.appVersion}`}
            {nad.encrypted && ', зашифрован'}. Устройств: {nad.devices.length}, групп: {nad.groups}.
          </div>
          <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Адрес</th>
                  <th>Логин</th>
                  <th>Группа</th>
                  <th>Замечания</th>
                </tr>
              </thead>
              <tbody>
                {nad.devices.map((d, i) => (
                  <tr key={i}>
                    <td>
                      {d.name} {d.protocol !== 'ssh' && <span className={`proto-badge ${d.protocol}`}>{PROTOCOL_LABELS[d.protocol as Device['protocol']] ?? d.protocol}</span>}
                    </td>
                    <td className="mono small">{d.protocol === 'serial' ? d.host : `${d.host}:${d.port}`}</td>
                    <td className="mono small">{d.username}</td>
                    <td className="small">{d.group}</td>
                    <td className="small">
                      {d.duplicateOf && <span className="badge warn">уже есть: {d.duplicateOf}</span>} {d.hasSecret && <span className="badge outline">есть пароль</span>} {d.warnings.join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dupCount > 0 && (
            <div className="stack" style={{ gap: 4, marginTop: 8 }}>
              <label className="check">
                <input type="radio" name="dup" checked={skipDup} onChange={() => setSkipDup(true)} />
                <span>Устройства, которые уже есть ({dupCount}), оставить как есть</span>
              </label>
              <label className="check">
                <input type="radio" name="dup" checked={!skipDup} onChange={() => setSkipDup(false)} />
                <span>Обновить их настройки данными из файла</span>
              </label>
            </div>
          )}
          {nad.knownHosts > 0 && <Check checked={importKnown} onChange={setImportKnown} label={`Добавить ключи хостов (${nad.knownHosts}) — подключение к этим устройствам не потребует повторного подтверждения`} />}
          {nad.knownHostConflicts > 0 && (
            <Banner kind="warn">
              Ключи {nad.knownHostConflicts} хост(ов) в файле отличаются от уже известных на этом компьютере. Они <b>не будут заменены</b>: если ключ сервера действительно сменился, программа покажет новый отпечаток при подключении — сверьте его с администратором сервера.
            </Banner>
          )}
          {nad.secrets > 0 && (
            <label className="check">
              <input type="checkbox" checked={importPw} disabled={!canStore} onChange={(e) => setImportPw(e.target.checked)} />
              <span>
                Импортировать сохранённые пароли ({nad.secrets}) в защищённое хранилище этого компьютера
                {!canStore && ' — недоступно: настройте или разблокируйте хранилище в «Настройки → Пароли»; иначе пароли будут запрошены при подключении'}
              </span>
            </label>
          )}
        </>
      )}
      {kind === 'csv' && !preview && (
        <Banner>
          Первая строка — заголовки. Поддерживаются столбцы: Название/name, IP/host/адрес, Порт/port, Логин/username, Тип/type (Cisco, OSNOVO, Linux…), Группа, Описание, Расположение, Теги, Ключ, Протокол, Скорость. Разделитель «;» или «,». Такую таблицу создаёт «Экспорт → Таблица CSV».
        </Banner>
      )}
      {kind !== 'nad' && preview && (
        <>
          {preview.errors.map((e, i) => (
            <Banner key={i} kind="warn">
              {e}
            </Banner>
          ))}
          <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Адрес</th>
                  <th>Логин</th>
                  <th>Тип</th>
                  <th>Замечания</th>
                </tr>
              </thead>
              <tbody>
                {preview.devices.map((d, i) => (
                  <tr key={i}>
                    <td>{d.name}</td>
                    <td className="mono small">
                      {d.host}:{d.port}
                    </td>
                    <td className="mono small">{d.username}</td>
                    <td className="small">{getPlatform(d.platform).name}</td>
                    <td className="small">
                      {d.duplicateOf && <span className="badge warn">уже есть: {d.duplicateOf}</span>} {d.warnings.join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="check">
            <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} />
            <span>Пропустить устройства, которые уже есть (тот же адрес, порт и логин)</span>
          </label>
          {preview.hasPasswordColumn && (
            <label className="check">
              <input type="checkbox" checked={importPw} onChange={(e) => setImportPw(e.target.checked)} />
              <span>
                Импортировать пароли из файла в защищённое хранилище. <b>Пароли в открытом CSV — риск утечки; после импорта удалите файл.</b>
              </span>
            </label>
          )}
        </>
      )}
    </Modal>
  );
}
