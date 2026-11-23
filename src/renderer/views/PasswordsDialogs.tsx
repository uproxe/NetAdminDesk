// Диалоги менеджера паролей: редактор записи с генератором, генератор, экспорт, импорт
// с предпросмотром, настройки, смена мастер-пароля, удаление хранилища.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { errMsg } from '../lib/store';
import { usePmApp } from './pmSession';
import { Icon } from '../lib/icons';
import { Banner, Button, Field, Modal, Toggle } from '../components/ui';
import {
  DEFAULT_PASSGEN,
  PM_LIMITS,
  PM_MIN_MASTER,
  estimateStrength,
  generatePassword,
  generatorEntropy,
  normalizePassGen,
  webRandomInt,
  withPmDefaults,
  STRENGTH_LABELS,
  type PassGenOptions,
  type PmEntrySummary,
  type PmExportFormat,
  type PmGroup,
  type PmImportPreview,
  type PmSettings
} from '../../shared/passwords';

// Настройки генератора сохраняются на время работы программы
let genOptions: PassGenOptions = DEFAULT_PASSGEN;

// ---------- Общие элементы ----------

export function PasswordInput({
  label,
  value,
  onChange,
  onEnter,
  autoFocus,
  placeholder,
  error,
  hint,
  extra
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  extra?: ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error} hint={hint}>
      <div className="pm-pass-input">
        <input
          className="input mono"
          type={show ? 'text' : 'password'}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        />
        <Button variant="ghost" iconOnly icon="eye" size="sm" onClick={() => setShow(!show)} title={show ? 'Скрыть' : 'Показать'} className={show ? 'pm-eye-on' : ''} />
        {extra}
      </div>
    </Field>
  );
}

/** Полоса стойкости: по паролю (оценка) или по готовому числу бит. */
export function StrengthMeter({ password, bits, compact }: { password?: string; bits?: number; compact?: boolean }) {
  const info = password !== undefined ? estimateStrength(password) : (() => {
    const b = bits ?? 0;
    const level = (b < 28 ? 0 : b < 45 ? 1 : b < 60 ? 2 : b < 80 ? 3 : 4) as 0 | 1 | 2 | 3 | 4;
    return { bits: b, level, label: STRENGTH_LABELS[level] };
  })();
  if (password !== undefined && !password) return compact ? null : <div className="pm-strength-empty" />;
  return (
    <div className={`pm-strength l${info.level} ${compact ? 'compact' : ''}`} title="Оценка по длине и набору символов; распространённые пароли и повторы снижают оценку">
      <div className="pm-strength-bar">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= info.level ? 'on' : ''} />
        ))}
      </div>
      <span className="small">
        {info.label} · ≈{info.bits} бит
      </span>
    </div>
  );
}

export function ageText(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return 'меньше суток';
  if (days < 30) return `${days} дн.`;
  if (days < 365) return `${Math.floor(days / 30)} мес.`;
  const y = Math.floor(days / 365);
  return `${y} ${y === 1 ? 'год' : y < 5 ? 'года' : 'лет'}`;
}

// ---------- Генератор ----------

function GeneratorPanel({ onUse, useLabel = 'Использовать' }: { onUse: (pw: string) => void; useLabel?: string }) {
  const [o, setO] = useState<PassGenOptions>(genOptions);
  const [pw, setPw] = useState(() => generatePassword(genOptions, webRandomInt));
  const update = (patch: Partial<PassGenOptions>) => {
    const next = normalizePassGen({ ...o, ...patch });
    genOptions = next;
    setO(next);
    setPw(generatePassword(next, webRandomInt));
  };
  return (
    <div className="pm-gen">
      <div className="pm-gen-out">
        <span className="mono">{pw}</span>
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => setPw(generatePassword(o, webRandomInt))} title="Другой пароль" />
      </div>
      <StrengthMeter bits={generatorEntropy(o)} />
      <div className="pm-gen-opts">
        <label className="pm-gen-len">
          Длина <b>{o.length}</b>
          <input type="range" min={8} max={64} value={o.length} onChange={(e) => update({ length: Number(e.target.value) })} />
        </label>
        <div className="pm-gen-checks">
          {(
            [
              ['lower', 'a–z'],
              ['upper', 'A–Z'],
              ['digits', '0–9'],
              ['symbols', '!@#$%…']
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={o[k]} onChange={(e) => update({ [k]: e.target.checked })} />
              <span className="mono">{label}</span>
            </label>
          ))}
          <label className="check" title="Без I, l, 1, O, 0, o и | — удобно, если пароль придётся вводить вручную">
            <input type="checkbox" checked={o.excludeAmbiguous} onChange={(e) => update({ excludeAmbiguous: e.target.checked })} />
            <span>без похожих (I l 1 O 0)</span>
          </label>
        </div>
      </div>
      <div className="small muted">Без кавычек, «\», пробела и «?» — их неудобно вводить в CLI коммутаторов и конфигурационных файлах.</div>
      <div className="btn-row">
        <Button variant="primary" icon="check" onClick={() => onUse(pw)}>
          {useLabel}
        </Button>
      </div>
    </div>
  );
}

export function GeneratorDialog({ onClose }: { onClose: () => void }) {
  const app = usePmApp();
  return (
    <Modal title="Генератор паролей" onClose={onClose}>
      <GeneratorPanel
        useLabel="Скопировать"
        onUse={async (pw) => {
          const r = await api.passwords.copyValue(pw);
          app.toast(r.clearAfterSec ? `Пароль скопирован. Будет удалён из буфера через ${r.clearAfterSec} с` : 'Пароль скопирован', 'ok');
        }}
      />
    </Modal>
  );
}

// ---------- Редактор записи ----------

export function EntryEditor({ id, groups, defaultGroupId, onClose, onSaved }: { id?: string; groups: PmGroup[]; defaultGroupId?: string | null; onClose: () => void; onSaved: (e: PmEntrySummary) => void | Promise<void> }) {
  const app = usePmApp();
  const [loaded, setLoaded] = useState(!id);
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [groupId, setGroupId] = useState<string | null>(defaultGroupId ?? null);
  const [favorite, setFavorite] = useState(false);
  const [tags, setTags] = useState('');
  const [gen, setGen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const d = await api.passwords.get(id);
        setTitle(d.title);
        setUsername(d.username);
        setUrl(d.url);
        setNotes(d.notes);
        setGroupId(d.groupId);
        setFavorite(d.favorite);
        setTags(d.tags.join(', '));
        setPassword(await api.passwords.reveal(id));
        setLoaded(true);
      } catch (e) {
        app.toast(errMsg(e), 'error');
        onClose();
      }
    })();
  }, [id]);
  const save = async () => {
    if (!title.trim()) return setError('Укажите название записи');
    setBusy(true);
    setError('');
    try {
      const r = await api.passwords.save({
        id,
        title,
        username,
        password,
        url,
        notes,
        groupId,
        favorite,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      });
      onClose();
      await onSaved(r);
      app.toast(id ? 'Запись сохранена' : 'Запись добавлена', 'ok');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  if (!loaded) return null;
  return (
    <Modal
      title={id ? 'Изменить запись' : 'Новая запись'}
      onClose={onClose}
      width="wide"
      footer={
        <>
          {error && <span className="pm-error grow">{error}</span>}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon="check" disabled={busy} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="pm-editor">
        <Field label="Название *">
          <input className="input" autoFocus value={title} maxLength={PM_LIMITS.title} placeholder="Например: SW-CORE-1, почта отдела, VPN" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="pm-editor-row">
          <Field label="Логин">
            <input className="input mono" value={username} autoComplete="off" spellCheck={false} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Папка">
            <select className="select" value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value || null)}>
              <option value="">Без папки</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <PasswordInput
          label="Пароль"
          value={password}
          onChange={setPassword}
          extra={
            <Button size="sm" icon="zap" onClick={() => setGen(!gen)} className={gen ? 'active' : ''}>
              Сгенерировать
            </Button>
          }
        />
        <StrengthMeter password={password} />
        {gen && (
          <GeneratorPanel
            onUse={(pw) => {
              setPassword(pw);
              setGen(false);
            }}
          />
        )}
        {id && <div className="small muted">При смене пароля прежний сохранится в истории записи (до {PM_LIMITS.history} последних).</div>}
        <Field label="Адрес" hint="IP-адрес, ssh://…, https://… — ссылки http(s) можно открыть из карточки">
          <input className="input mono" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Заметки">
          <textarea className="input pm-notes-input" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Где стоит, кто выдал доступ, секретные вопросы, ключи восстановления…" />
        </Field>
        <div className="pm-editor-row">
          <Field label="Метки" hint="Через запятую">
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="коммутаторы, этаж 2" />
          </Field>
          <label className="check pm-fav-check">
            <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
            <span>
              <Icon name="star" size={13} /> В избранное
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Экспорт ----------

export function ExportDialog({ count, onClose }: { count: number; onClose: () => void }) {
  const app = usePmApp();
  const [format, setFormat] = useState<PmExportFormat>('nadpass');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [master, setMaster] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = format === 'nadpass' ? pw.length >= PM_MIN_MASTER && pw === pw2 : ack && master.length > 0;
  const run = async () => {
    const date = new Date().toISOString().slice(0, 10);
    const path = await api.app.selectSaveFile({
      title: format === 'nadpass' ? 'Сохранить зашифрованную копию паролей' : 'Сохранить пароли в CSV (без шифрования)',
      defaultPath: `passwords-${date}.${format === 'nadpass' ? 'nadpass' : 'csv'}`,
      filters: format === 'nadpass' ? [{ name: 'Пароли NetAdmin Desk', extensions: ['nadpass'] }] : [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (!path) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.passwords.exportFile(path, format === 'nadpass' ? { format, password: pw } : { format, masterPassword: master });
      app.toast(`Сохранено записей: ${r.count}`, 'ok');
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Экспорт паролей"
      onClose={onClose}
      footer={
        <>
          {error && <span className="pm-error grow">{error}</span>}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant={format === 'csv' ? 'danger' : 'primary'} icon="upload" disabled={!ok || busy || !count} onClick={run}>
            {busy ? 'Сохранение…' : 'Сохранить файл…'}
          </Button>
        </>
      }
    >
      <div className="pm-choice">
        <label className={`pm-choice-card ${format === 'nadpass' ? 'on' : ''}`}>
          <input type="radio" checked={format === 'nadpass'} onChange={() => setFormat('nadpass')} />
          <div>
            <b>Зашифрованный файл .nadpass</b> — рекомендуется
            <div className="small muted">Для резервной копии и переноса на другой компьютер. Защищён отдельным паролем файла (AES-256-GCM).</div>
          </div>
        </label>
        <label className={`pm-choice-card ${format === 'csv' ? 'on' : ''}`}>
          <input type="radio" checked={format === 'csv'} onChange={() => setFormat('csv')} />
          <div>
            <b>CSV без шифрования</b>
            <div className="small muted">Для переноса в KeePass, KeePassXC, Bitwarden. Столбцы как у KeePassXC: Group, Title, Username, Password, URL, Notes.</div>
          </div>
        </label>
      </div>
      {format === 'nadpass' ? (
        <>
          <PasswordInput label="Пароль файла" value={pw} onChange={setPw} autoFocus placeholder={`не короче ${PM_MIN_MASTER} символов`} hint="Можно тот же, что мастер-пароль, или другой — его спросят при импорте" />
          <StrengthMeter password={pw} />
          <PasswordInput label="Повторите пароль файла" value={pw2} onChange={setPw2} error={pw2 && pw !== pw2 ? 'Пароли не совпадают' : null} />
        </>
      ) : (
        <>
          <Banner kind="crit">
            Все пароли окажутся в файле <b>открытым текстом</b>. Любой, кто получит файл, увидит их. Перенесите его сразу, затем удалите файл (и из корзины). Не отправляйте по почте и мессенджерам.
          </Banner>
          <label className="check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>Понимаю, что файл не защищён</span>
          </label>
          <PasswordInput label="Мастер-пароль (для подтверждения)" value={master} onChange={setMaster} />
        </>
      )}
      <div className="small muted">Записей: {count}. В файл попадут папки, логины, пароли, адреса и заметки{format === 'nadpass' ? ', избранное и история паролей' : ''}.</div>
    </Modal>
  );
}

// ---------- Импорт ----------

export function ImportDialog({ groups, onClose, onDone }: { groups: PmGroup[]; onClose: () => void; onDone: () => Promise<void> }) {
  const app = usePmApp();
  const [preview, setPreview] = useState<PmImportPreview | null>(null);
  const [pw, setPw] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupMode, setGroupMode] = useState<'file' | 'target'>('file');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (preview) void api.passwords.importCancel(preview.token);
    onClose();
  };
  const ready = (p: PmImportPreview) => {
    setPreview(p);
    setSelected(new Set(p.rows.filter((r) => !r.duplicate).map((r) => r.index)));
    if (!p.groups.length) setGroupMode('target');
  };
  const choose = async () => {
    const path = await api.app.selectFile({ title: 'Файл с паролями', filters: [{ name: 'Пароли (.nadpass, .csv)', extensions: ['nadpass', 'csv', 'txt'] }] });
    if (!path) return;
    setError('');
    setBusy(true);
    try {
      if (preview) await api.passwords.importCancel(preview.token);
      ready(await api.passwords.importOpen(path));
    } catch (e) {
      setError(errMsg(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const decrypt = async () => {
    if (!preview || !pw) return;
    setBusy(true);
    setError('');
    try {
      ready(await api.passwords.importDecrypt(preview.token, pw));
      setPw('');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.passwords.importCommit(preview.token, { indexes: [...selected], groupMode, targetGroupId: target });
      onClose();
      await onDone();
      app.toast(`Импортировано записей: ${r.added}${r.groupsCreated ? `, создано папок: ${r.groupsCreated}` : ''}`, 'ok');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const rows = preview?.rows ?? [];
  const dupCount = rows.filter((r) => r.duplicate).length;
  const toggle = (i: number) => {
    const s = new Set(selected);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    setSelected(s);
  };
  const showRows = preview && !preview.needsPassword;
  return (
    <Modal
      title="Импорт паролей"
      onClose={close}
      width={showRows ? 'xwide' : 'normal'}
      footer={
        <>
          {error && <span className="pm-error grow">{error}</span>}
          <Button onClick={close}>Отмена</Button>
          {showRows && (
            <Button variant="primary" icon="download" disabled={busy || !selected.size} onClick={commit}>
              Импортировать ({selected.size})
            </Button>
          )}
        </>
      }
    >
      {!preview && (
        <>
          <p>Поддерживаются:</p>
          <ul className="pm-import-list">
            <li>
              <b>.nadpass</b> — зашифрованный экспорт NetAdmin Desk (понадобится пароль файла);
            </li>
            <li>
              <b>CSV</b> с заголовками — из KeePass, KeePassXC, Bitwarden, Chrome/Edge, Firefox, LastPass или таблицы Excel (столбцы «Название; Логин; Пароль; Адрес; Заметки; Папка»).
            </li>
          </ul>
          <div className="small muted">Файл .kdbx KeePass напрямую не открывается — выгрузите из KeePass или KeePassXC CSV («Файл → Экспорт → CSV»), а после импорта удалите его.</div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Button variant="primary" icon="folder" disabled={busy} onClick={choose}>
              Выбрать файл…
            </Button>
          </div>
        </>
      )}
      {preview?.needsPassword && (
        <>
          <p>
            Файл <b>{preview.file}</b> зашифрован. Введите пароль, с которым он был сохранён.
          </p>
          <PasswordInput label="Пароль файла" value={pw} onChange={setPw} onEnter={decrypt} autoFocus />
          <div className="btn-row">
            <Button variant="primary" icon="unlock" disabled={!pw || busy} onClick={decrypt}>
              {busy ? 'Расшифровка…' : 'Открыть файл'}
            </Button>
            <Button variant="ghost" onClick={choose}>
              Другой файл…
            </Button>
          </div>
        </>
      )}
      {showRows && (
        <>
          <div className="pm-import-head">
            <span>
              <b>{preview.file}</b> · {preview.source} · записей: {rows.length}
              {dupCount > 0 && <span className="muted"> · уже есть: {dupCount} (не отмечены)</span>}
            </span>
            <span className="btn-row">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(rows.map((r) => r.index)))}>
                Отметить все
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Снять все
              </Button>
              <Button size="sm" variant="ghost" icon="folder" onClick={choose}>
                Другой файл…
              </Button>
            </span>
          </div>
          <div className="pm-import-table">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Название</th>
                  <th>Логин</th>
                  <th>Адрес</th>
                  <th>Папка</th>
                  <th>Пароль</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.index} className={r.duplicate ? 'pm-dup' : ''} onClick={() => toggle(r.index)}>
                    <td>
                      <input type="checkbox" checked={selected.has(r.index)} onChange={() => toggle(r.index)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td>
                      {r.title}
                      {r.duplicate && <span className="badge warn">уже есть</span>}
                    </td>
                    <td className="mono">{r.username}</td>
                    <td className="mono ellipsis pm-import-url">{r.url}</td>
                    <td>{r.group}</td>
                    <td>{r.hasPassword ? '••••••' : <span className="faint">нет</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pm-import-opts">
            {preview.groups.length > 0 && (
              <label className="check">
                <input type="radio" checked={groupMode === 'file'} onChange={() => setGroupMode('file')} />
                <span>Папки из файла ({preview.groups.length}) — недостающие будут созданы</span>
              </label>
            )}
            <label className="check">
              <input type="radio" checked={groupMode === 'target'} onChange={() => setGroupMode('target')} />
              <span>Все в папку:</span>
            </label>
            <select className="select" style={{ width: 'auto' }} value={target ?? ''} disabled={groupMode !== 'target'} onChange={(e) => setTarget(e.target.value || null)}>
              <option value="">Без папки</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          {preview.kind === 'csv' && <Banner kind="warn">CSV хранит пароли открытым текстом — после импорта удалите исходный файл.</Banner>}
        </>
      )}
    </Modal>
  );
}

// ---------- Настройки, смена мастер-пароля, удаление ----------

export function PmSettingsDialog({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  const app = usePmApp();
  const [s, setS] = useState<PmSettings>(app.settings.passwords);
  const set = (patch: Partial<PmSettings>) => setS(withPmDefaults({ ...s, ...patch }));
  const save = async () => {
    await app.updateSettings({ passwords: s });
    app.toast('Настройки менеджера паролей сохранены', 'ok');
    onClose();
  };
  const reset = () => {
    onClose();
    app.openDialog((close) => <ResetDialog onClose={close} onDone={onReset} />);
  };
  return (
    <Modal
      title="Настройки менеджера паролей"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon="check" onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="settings-grid">
        <Field label="Автоблокировка" hint="Нужно будет снова ввести мастер-пароль">
          <select className="select" value={s.autoLockMin} onChange={(e) => set({ autoLockMin: Number(e.target.value) })}>
            {[1, 5, 10, 15, 30, 60, 0].map((m) => (
              <option key={m} value={m}>
                {m ? `через ${m} мин без действий` : 'не блокировать'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Очистка буфера обмена" hint="Скопированный пароль удаляется, если в буфере всё ещё он">
          <select className="select" value={s.clipboardClearSec} onChange={(e) => set({ clipboardClearSec: Number(e.target.value) })}>
            {[10, 20, 30, 60, 120, 0].map((x) => (
              <option key={x} value={x}>
                {x ? `через ${x} с` : 'не очищать'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Toggle label="Блокировать при блокировке экрана и переходе в сон" checked={s.lockOnScreenLock} onChange={(v) => set({ lockOnScreenLock: v })} />
      <Toggle label="Блокировать при сворачивании окна" desc="И при скрытии окна в область уведомлений" checked={s.lockOnMinimize} onChange={(v) => set({ lockOnMinimize: v })} />
      {s.autoLockMin === 0 && <Banner kind="warn">Без автоблокировки записи остаются открытыми, пока вы не нажмёте «Заблокировать» или не закроете программу.</Banner>}
      <div className="section-title">Опасная зона</div>
      <Button variant="danger" icon="trash" onClick={reset}>
        Удалить все записи и мастер-пароль…
      </Button>
    </Modal>
  );
}

export function ChangeMasterDialog({ onClose }: { onClose: () => void }) {
  const app = usePmApp();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = cur.length > 0 && pw.length >= PM_MIN_MASTER && pw === pw2;
  const run = async () => {
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.passwords.changeMaster(cur, pw);
      app.toast('Мастер-пароль изменён, записи перешифрованы', 'ok');
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Смена мастер-пароля"
      onClose={onClose}
      footer={
        <>
          {error && <span className="pm-error grow">{error}</span>}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon="shield" disabled={!ok || busy} onClick={run}>
            {busy ? 'Перешифровка…' : 'Сменить'}
          </Button>
        </>
      }
    >
      <PasswordInput label="Текущий мастер-пароль" value={cur} onChange={setCur} autoFocus />
      <PasswordInput label="Новый мастер-пароль" value={pw} onChange={setPw} placeholder={`не короче ${PM_MIN_MASTER} символов`} />
      <StrengthMeter password={pw} />
      <PasswordInput label="Повторите новый" value={pw2} onChange={setPw2} onEnter={run} error={pw2 && pw !== pw2 ? 'Пароли не совпадают' : null} />
      <div className="small muted">Все записи будут перешифрованы новым ключом. Файлы .nadpass, сохранённые раньше, по-прежнему открываются своим паролем файла.</div>
    </Modal>
  );
}

export function ResetDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const app = usePmApp();
  const [word, setWord] = useState('');
  const run = async () => {
    try {
      await api.passwords.reset(word);
      app.toast('Записи менеджера паролей удалены', 'ok');
      onClose();
      onDone();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <Modal
      title="Удалить все записи"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="danger" icon="trash" disabled={word !== 'УДАЛИТЬ'} onClick={run}>
            Удалить навсегда
          </Button>
        </>
      }
    >
      <Banner kind="crit">
        Забытый мастер-пароль восстановить нельзя: записи зашифрованы, и без него их не расшифровать. Можно только удалить все записи менеджера паролей и создать хранилище заново. Пароли устройств, мониторинг и остальные данные программы не затрагиваются.
      </Banner>
      <p className="small">Если есть файл .nadpass — после создания нового хранилища записи можно вернуть через «Импорт».</p>
      <Field label="Для подтверждения введите слово УДАЛИТЬ">
        <input className="input" value={word} onChange={(e) => setWord(e.target.value)} />
      </Field>
    </Modal>
  );
}
