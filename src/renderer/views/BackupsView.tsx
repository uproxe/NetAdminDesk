// Резервные копии: конфигурации коммутаторов и файлы Linux, история по устройствам и датам, сравнение версий.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp, errMsg } from '../lib/store';
import { Banner, Button, Check, Empty, Field, Modal } from '../components/ui';
import { fmtDate, fmtSize } from '../lib/format';
import { getPlatform } from '../../shared/platforms';
import type { BackupRecord, Device } from '../../shared/types';
import type { DiffHunk } from '../../shared/diff';

export function BackupsView() {
  const app = useApp();
  const [all, setAll] = useState<BackupRecord[]>([]);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [checked, setChecked] = useState<number[]>([]);
  const load = useCallback(async () => setAll(await api.backups.list()), []);
  useEffect(() => {
    void load();
  }, [load]);
  const devices = app.devices;
  const dev = devices.find((d) => d.id === deviceId) ?? null;
  const list = all.filter((b) => (deviceId ? b.deviceId === deviceId : true));
  const open = app.sessions.find((s) => s.deviceId === deviceId && !s.pending && s.status === 'ready');

  const create = async () => {
    if (!dev || !open) return;
    try {
      if (dev.platform === 'linux') {
        app.openDialog((close) => <LinuxBackupDialog device={dev} sessionId={open.id} onClose={close} onDone={load} />);
        return;
      }
      app.toast('Получение конфигурации… Команды видны в терминале сессии.', 'info');
      const b = await api.backups.fetchSwitchConfig(open.id);
      app.toast(`Сохранено: ${fmtSize(b.size)}${b.sameAsPrevious ? ' (без изменений с прошлой копии)' : ''}`, 'ok');
      await load();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const view = async (b: BackupRecord) => {
    try {
      const text = await api.backups.read(b.id);
      app.openDialog((close) => (
        <Modal title={`${b.deviceName} — ${fmtDate(b.ts, true)}`} width="xwide" onClose={close} footer={<><Button icon="copy" onClick={() => app.copy(text)}>Копировать</Button><Button icon="folder" onClick={() => void api.app.showItemInFolder(b.path)}>Показать в папке</Button><Button onClick={close}>Закрыть</Button></>}>
          <pre className="output" style={{ maxHeight: '65vh' }}>{text}</pre>
        </Modal>
      ));
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const compare = () => {
    const [a, b] = checked.map((id) => all.find((x) => x.id === id)!).sort((x, y) => x.ts.localeCompare(y.ts));
    app.openDialog((close) => <DiffDialog a={a} b={b} onClose={close} />);
  };
  const remove = async (b: BackupRecord) => {
    let delFile = true;
    const ok = await app.confirm({
      title: 'Удалить резервную копию?',
      text: (
        <>
          <p>
            {b.deviceName}, {fmtDate(b.ts, true)}
          </p>
          <label className="check">
            <input type="checkbox" defaultChecked onChange={(e) => (delFile = e.target.checked)} />
            <span>Удалить и файл на диске</span>
          </label>
        </>
      ),
      okText: 'Удалить',
      danger: true
    });
    if (!ok) return;
    await api.backups.remove(b.id, delFile);
    setChecked((c) => c.filter((x) => x !== b.id));
    await load();
  };

  return (
    <div className="columns">
      <div className="col col-filter">
        <div className="filter-group">
          <div className="filter-title">Устройства</div>
          <button className={`filter-item ${deviceId === null ? 'active' : ''}`} onClick={() => setDeviceId(null)}>
            Все копии<span className="n">{all.length}</span>
          </button>
          {devices.map((d) => (
            <button key={d.id} className={`filter-item ${deviceId === d.id ? 'active' : ''}`} onClick={() => (setDeviceId(d.id), setChecked([]))}>
              <span className="ellipsis">{d.name}</span>
              <span className="n">{all.filter((b) => b.deviceId === d.id).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="col grow" style={{ overflowY: 'auto' }}>
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 className="grow" style={{ margin: 0, fontSize: 16 }}>
              {dev ? `${dev.name} — ${getPlatform(dev.platform).name}` : 'Все резервные копии'}
            </h2>
            <Button disabled={checked.length !== 2} icon="split" onClick={compare}>
              Сравнить выбранные (2)
            </Button>
            {dev && (
              <Button variant="primary" icon="archive" disabled={!open} onClick={create} title={open ? '' : 'Сначала подключитесь к устройству'}>
                {dev.platform === 'linux' ? 'Загрузить файлы (SFTP)' : 'Сохранить текущую конфигурацию'}
              </Button>
            )}
          </div>
          {dev && !open && (
            <Banner>
              Для создания копии подключитесь к устройству.{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), void app.connect(dev.id))}>
                Подключить
              </a>
            </Banner>
          )}
          {dev && dev.platform !== 'linux' && (
            <div className="small muted" style={{ marginBottom: 10 }}>
              Команда получения конфигурации для платформы: <code>{getPlatform(dev.platform).configCommand ?? '—'}</code>
              {!getPlatform(dev.platform).configCommandVerified && ' (не подтверждена для этой платформы — проверьте результат)'}. Для каждого производителя используется свой способ.
            </div>
          )}
          {dev?.platform === 'linux' && <LinuxBackupCommands />}
          {!list.length ? (
            <Empty icon="archive" title="Копий пока нет" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 30 }} />
                  <th>Дата</th>
                  {!dev && <th>Устройство</th>}
                  <th>Тип</th>
                  <th>Размер</th>
                  <th>Примечание</th>
                  <th style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {b.kind === 'switch-config' && (
                        <input type="checkbox" checked={checked.includes(b.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, b.id].slice(-2) : checked.filter((x) => x !== b.id))} />
                      )}
                    </td>
                    <td>{fmtDate(b.ts, true)}</td>
                    {!dev && <td>{b.deviceName}</td>}
                    <td className="small">{b.kind === 'switch-config' ? 'конфигурация' : 'файлы (SFTP)'}</td>
                    <td className="small">{fmtSize(b.size)}</td>
                    <td className="small muted">
                      {b.sameAsPrevious && <span className="badge outline">без изменений</span>} {b.comment}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 2 }}>
                        <Button size="sm" variant="ghost" iconOnly icon="eye" title="Просмотр" onClick={() => view(b)} />
                        <Button size="sm" variant="ghost" iconOnly icon="folder" title="Показать в папке" onClick={() => void api.app.showItemInFolder(b.path)} />
                        <Button size="sm" variant="ghost" iconOnly icon="trash" title="Удалить" onClick={() => remove(b)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DiffDialog({ a, b, onClose }: { a: BackupRecord; b: BackupRecord; onClose: () => void }) {
  const app = useApp();
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [ignoreVol, setIgnoreVol] = useState(true);
  const [res, setRes] = useState<{ hunks: DiffHunk[]; stats: { added: number; removed: number; unchanged: number } } | null>(null);
  useEffect(() => {
    api.backups.diff(a.id, b.id, { ignoreWhitespace: ignoreWs, ignoreVolatile: ignoreVol }).then(setRes, (e) => app.toast(errMsg(e), 'error'));
  }, [a.id, b.id, ignoreWs, ignoreVol, app]);
  return (
    <Modal title="Сравнение конфигураций" width="xwide" onClose={onClose} footer={<Button onClick={onClose}>Закрыть</Button>}>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <span className="grow">
          <b>{a.deviceName}</b>: {fmtDate(a.ts, true)} → {fmtDate(b.ts, true)}
        </span>
        <Check checked={ignoreWs} onChange={setIgnoreWs} label="Игнорировать пробелы" />
        <Check checked={ignoreVol} onChange={setIgnoreVol} label="Игнорировать служебные строки (время изменения, ntp clock-period)" />
      </div>
      {res && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span className="badge ok">+{res.stats.added}</span>
            <span className="badge crit">−{res.stats.removed}</span>
            <span className="badge outline">без изменений: {res.stats.unchanged}</span>
          </div>
          {!res.hunks.length ? (
            <Banner kind="ok">Конфигурации совпадают.</Banner>
          ) : (
            <div className="diff">
              {res.hunks.map((h, i) => (
                <div key={i}>
                  <div className="hunk">
                    @@ строка {h.aStart} → {h.bStart}
                  </div>
                  {h.ops.map((o, j) => (
                    <div key={j} className={`ln ${o.type}`}>
                      <span>{o.aLine ?? ''}</span>
                      <span>{o.bLine ?? ''}</span>
                      <span>{o.type === 'add' ? '+' : o.type === 'del' ? '−' : ' '}</span>
                      <span>{o.text}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function LinuxBackupDialog({ device, sessionId, onClose, onDone }: { device: Device; sessionId: string; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [paths, setPaths] = useState('/etc/ssh/sshd_config\n/etc/nginx\n/etc/fstab\n/etc/network/interfaces\n/etc/netplan');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const b = await api.backups.downloadLinux(sessionId, paths.split('\n'), comment);
      app.toast(`Загружено ${fmtSize(b.size)}${b.comment ? ` (${b.comment})` : ''}`, 'ok');
      onDone();
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Резервная копия файлов: ${device.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon="download" disabled={busy} onClick={run}>
            {busy ? 'Загрузка…' : 'Загрузить'}
          </Button>
        </>
      }
    >
      <Field label="Файлы и каталоги на сервере (по одному в строке)" hint="Загружаются через SFTP с правами пользователя сессии. Файлы, недоступные на чтение, будут перечислены в MANIFEST.txt.">
        <textarea className="textarea mono" rows={8} value={paths} onChange={(e) => setPaths(e.target.value)} />
      </Field>
      <Field label="Комментарий">
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  );
}

function LinuxBackupCommands() {
  const app = useApp();
  const cmds = [
    ['Архив конфигурации сервера (/etc, cron, свои скрипты)', 'sudo tar -czpf /root/config-$(hostname)-$(date +%F).tgz /etc /var/spool/cron /usr/local/bin'],
    ['Список установленных пакетов', 'dpkg --get-selections > ~/packages-$(hostname)-$(date +%F).list'],
    ['Синхронизация каталога на другой сервер (сначала пробный прогон)', 'rsync -avhn /srv/data/ backup@10.0.0.6:/backup/data/']
  ];
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3>Подготовленные команды резервирования</h3>
      {cmds.map(([t, c]) => (
        <div key={c} className="cmd-line" style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 6 }}>
          <div className="code mono">
            {c}
            <span className="note">{t}</span>
          </div>
          <div className="actions">
            <Button size="sm" variant="ghost" iconOnly icon="copy" onClick={() => app.copy(c)} />
            <Button size="sm" variant="ghost" iconOnly icon="play" onClick={() => app.execute({ title: t, command: c, kind: 'linux', platform: 'linux', risk: 'change', source: 'backup' })} />
          </div>
        </div>
      ))}
      <div className="small muted">После создания архива на сервере скачайте его кнопкой «Загрузить файлы (SFTP)».</div>
    </div>
  );
}
