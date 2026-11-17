// Карточка устройства: параметры подключения, авторизация, секреты (хранятся в защищённом хранилище).
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useApp, errMsg } from '../lib/store';
import { Banner, Button, Field, Modal, Tabs, Toggle } from './ui';
import type { Device, DeviceColor, DeviceInput, DeviceSecretsInput, DeviceSecretsState } from '../../shared/types';
import { DEVICE_TYPES, getPlatform } from '../../shared/platforms';
import { listSerialPorts, serialSupported } from '../lib/serial';

export const DEVICE_COLORS: { id: DeviceColor; label: string; css: string }[] = [
  { id: '', label: 'Без цвета', css: 'transparent' },
  { id: 'red', label: 'Красный — «боевое», осторожно', css: '#e5534b' },
  { id: 'orange', label: 'Оранжевый', css: '#e0823d' },
  { id: 'yellow', label: 'Жёлтый', css: '#d6a32e' },
  { id: 'green', label: 'Зелёный — тестовое', css: '#3fb950' },
  { id: 'blue', label: 'Синий', css: '#4f8cff' },
  { id: 'purple', label: 'Фиолетовый', css: '#a371f7' }
];

export const colorCss = (c: DeviceColor | undefined) => DEVICE_COLORS.find((x) => x.id === c)?.css ?? 'transparent';

export const PROTOCOL_LABELS: Record<DeviceInput['protocol'], string> = { ssh: 'SSH', telnet: 'Telnet', serial: 'COM-порт' };

const BAUDS = [9600, 19200, 38400, 57600, 115200];

/** Раскрывающийся блок «Дополнительно» (в простом режиме свёрнут). */
function More({ title, children, open }: { title: string; children: ReactNode; open: boolean }) {
  return (
    <details className="more-block" open={open}>
      <summary>{title}</summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

export function blankDevice(): DeviceInput {
  return {
    name: '',
    host: '',
    port: 22,
    vendor: '',
    model: '',
    platform: 'cisco-ios',
    deviceType: 'cisco',
    osVersion: '',
    username: '',
    authMethod: 'password',
    keyPath: '',
    description: '',
    location: '',
    groupId: null,
    tags: [],
    favorite: false,
    linuxDistro: '',
    linuxVersion: '',
    hostname: '',
    serverType: '',
    servicesNotes: '',
    connectionNotes: '',
    legacyAlgorithms: false,
    autoEnable: false,
    disablePagerOnConnect: false,
    readOnly: false,
    keepaliveSec: 30,
    timeoutSec: 20,
    jumpDeviceId: null,
    protocol: 'ssh',
    serialBaud: 9600,
    loginCommands: '',
    color: ''
  };
}

type SecretMode = 'keep' | 'set' | 'clear';

function SecretField({ label, stored, mode, value, onMode, onValue, hint }: { label: string; stored: boolean; mode: SecretMode; value: string; onMode: (m: SecretMode) => void; onValue: (v: string) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {stored && mode === 'keep' ? (
        <div className="row">
          <span className="badge ok">сохранён в защищённом хранилище</span>
          <Button size="sm" onClick={() => onMode('set')}>
            Изменить
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onMode('clear')}>
            Удалить
          </Button>
        </div>
      ) : mode === 'clear' ? (
        <div className="row">
          <span className="badge warn">будет удалён при сохранении</span>
          <Button size="sm" variant="ghost" onClick={() => onMode('keep')}>
            Отменить
          </Button>
        </div>
      ) : (
        <input className="input" type="password" autoComplete="new-password" value={value} placeholder={stored ? 'новое значение' : 'не сохранён'} onChange={(e) => (onValue(e.target.value), onMode('set'))} />
      )}
    </Field>
  );
}

export function DeviceEditor({ initial, onClose, onSaved }: { initial?: Device | DeviceInput; onClose: () => void; onSaved?: (d: Device) => void }) {
  const app = useApp();
  const [d, setD] = useState<DeviceInput>({ ...blankDevice(), ...(initial ?? {}) });
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [tab, setTab] = useState<'main' | 'auth' | 'extra'>('main');
  const [stored, setStored] = useState<DeviceSecretsState>({ password: false, keyPassphrase: false, enablePassword: false });
  const [modes, setModes] = useState<Record<keyof DeviceSecretsInput, SecretMode>>({ password: 'keep', keyPassphrase: 'keep', enablePassword: 'keep' });
  const [values, setValues] = useState<Record<keyof DeviceSecretsInput, string>>({ password: '', keyPassphrase: '', enablePassword: '' });
  const [busy, setBusy] = useState(false);
  const isLinux = d.platform === 'linux';
  const id = (initial as Device | undefined)?.id;
  const full = app.settings.uiMode === 'full';
  const [ports, setPorts] = useState<{ portName: string; displayName?: string }[] | null>(null);
  const setProtocol = (p: DeviceInput['protocol']) =>
    setD((x) => ({
      ...x,
      protocol: p,
      // Стандартный порт меняется вместе с протоколом, если пользователь его не менял.
      port: p === 'telnet' && (x.port === 22 || !x.port) ? 23 : p === 'ssh' && x.port === 23 ? 22 : x.port,
      authMethod: p === 'ssh' ? x.authMethod : 'password'
    }));
  const findPorts = async () => {
    const list = await listSerialPorts();
    setPorts(list);
    if (list.length === 1 && !d.host) set('host', list[0].portName);
  };

  useEffect(() => {
    if (id) void api.devices.secretsState(id).then(setStored);
  }, [id]);

  const set = <K extends keyof DeviceInput>(k: K, v: DeviceInput[K]) => setD((x) => ({ ...x, [k]: v }));
  const vaultCanStore = app.vault && (app.vault.mode === 'os' ? app.vault.osSecure : app.vault.mode === 'master' ? app.vault.unlocked : false);
  const wantsSecret = (Object.keys(modes) as (keyof DeviceSecretsInput)[]).some((k) => modes[k] === 'set' && values[k]);

  const save = async () => {
    setBusy(true);
    try {
      const secrets: DeviceSecretsInput = {};
      for (const k of Object.keys(modes) as (keyof DeviceSecretsInput)[]) {
        if (modes[k] === 'set' && values[k]) secrets[k] = values[k];
        if (modes[k] === 'clear') secrets[k] = null;
      }
      const saved = await api.devices.save(
        { ...d, id, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), vendor: d.vendor || getPlatform(d.platform).vendor },
        Object.keys(secrets).length ? secrets : undefined
      );
      await app.refresh('devices');
      app.toast(`Устройство «${saved.name}» сохранено`, 'ok');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const pickKey = async () => {
    const p = await api.app.selectFile({ title: 'Приватный SSH-ключ' });
    if (p) set('keyPath', p);
  };

  return (
    <Modal
      title={id ? `Устройство: ${initial?.name}` : 'Новое устройство'}
      onClose={onClose}
      width="wide"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon="check" onClick={save} disabled={busy || !d.name.trim() || !d.host.trim()}>
            Сохранить
          </Button>
        </>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'main', label: 'Основное' },
          { id: 'auth', label: 'Подключение и авторизация' },
          { id: 'extra', label: isLinux ? 'Сведения о сервере' : 'Дополнительно' }
        ]}
      />
      {tab === 'main' && (
        <>
          <div className="grid-2">
            <Field label="Название *">
              <input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="core-sw1" />
            </Field>
            <Field label="Тип устройства">
              <select
                className="select"
                value={d.deviceType}
                onChange={(e) => {
                  const t = DEVICE_TYPES.find((x) => x.id === e.target.value)!;
                  setD((x) => ({ ...x, deviceType: t.id, platform: t.platform, vendor: getPlatform(t.platform).vendor }));
                }}
              >
                {DEVICE_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Как подключаться">
            <div className="seg">
              {(['ssh', 'telnet', 'serial'] as const).map((p) => (
                <button key={p} type="button" className={d.protocol === p ? 'on' : ''} onClick={() => setProtocol(p)}>
                  {p === 'ssh' ? 'SSH (рекомендуется)' : p === 'telnet' ? 'Telnet' : 'COM-порт / консольный кабель'}
                </button>
              ))}
            </div>
          </Field>
          {d.protocol === 'telnet' && (
            <Banner kind="warn">
              Telnet не шифрует данные: логин, пароль и конфигурация видны всем, кто может перехватить трафик. Используйте только для старого оборудования без SSH и только во внутренней сети управления.
            </Banner>
          )}
          {d.protocol === 'serial' ? (
            <>
              <div className="grid-3">
                <Field label="COM-порт *" hint="Windows: COM3; Linux: /dev/ttyUSB0; macOS: /dev/tty.usbserial-…">
                  <div className="row">
                    <input className="input mono" list="nad-serial-ports" value={d.host} onChange={(e) => set('host', e.target.value)} placeholder="COM3" spellCheck={false} />
                    <Button size="sm" icon="search" disabled={!serialSupported()} onClick={() => void findPorts()} title="Показать подключённые COM-порты">
                      Найти
                    </Button>
                  </div>
                  <datalist id="nad-serial-ports">
                    {(ports ?? []).map((p) => (
                      <option key={p.portName} value={p.portName}>
                        {p.displayName}
                      </option>
                    ))}
                  </datalist>
                </Field>
                <Field label="Скорость, бод" hint="Большинство коммутаторов — 9600, часть новых — 115200">
                  <select className="select" value={d.serialBaud} onChange={(e) => set('serialBaud', Number(e.target.value))}>
                    {BAUDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Параметры порта">
                  <input className="input mono" value="8N1, без управления потоком" disabled />
                </Field>
              </div>
              {ports && (
                <div className="small muted" style={{ marginTop: -6, marginBottom: 10 }}>
                  {ports.length ? `Найдено: ${ports.map((p) => `${p.portName}${p.displayName && p.displayName !== p.portName ? ` (${p.displayName})` : ''}`).join(', ')}` : 'COM-порты не найдены. Подключите USB-переходник и проверьте драйвер (CH340, PL2303, FTDI).'}
                </div>
              )}
            </>
          ) : (
            <div className="grid-3">
              <Field label="IP-адрес или DNS-имя *">
                <input className="input mono" value={d.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.1.1" spellCheck={false} />
              </Field>
              <Field label={d.protocol === 'telnet' ? 'Telnet-порт' : 'SSH-порт'}>
                <input className="input mono" type="number" min={1} max={65535} value={d.port} onChange={(e) => set('port', Number(e.target.value) || (d.protocol === 'telnet' ? 23 : 22))} />
              </Field>
              <Field label="Логин">
                <input className="input mono" value={d.username} onChange={(e) => set('username', e.target.value)} spellCheck={false} autoComplete="off" />
              </Field>
            </div>
          )}
          <More title="Модель, группа, расположение, цвет, описание" open={full || !!(d.vendor || d.model || d.osVersion || d.location || d.description || d.color || tags)}>
          <div className="grid-3">
            <Field label="Производитель">
              <input className="input" value={d.vendor} placeholder={getPlatform(d.platform).vendor} onChange={(e) => set('vendor', e.target.value)} />
            </Field>
            <Field label="Модель">
              <input className="input" value={d.model} onChange={(e) => set('model', e.target.value)} placeholder={isLinux ? '' : 'SW-32G4X-3L'} />
            </Field>
            <Field label="Версия ОС / прошивки">
              <input className="input" value={d.osVersion} onChange={(e) => set('osVersion', e.target.value)} />
            </Field>
          </div>
          <div className="grid-3">
            <Field label="Группа">
              <select className="select" value={d.groupId ?? ''} onChange={(e) => set('groupId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— без группы —</option>
                {app.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.kind === 'folder' ? '📁 ' : ''}
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Расположение">
              <input className="input" value={d.location} onChange={(e) => set('location', e.target.value)} placeholder="Корпус 2, серверная" />
            </Field>
            <Field label="Теги (через запятую)">
              <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="камеры, poe" />
            </Field>
          </div>
          <Field label="Цвет метки" hint="Цвет полоски на вкладке сессии и в списке устройств. Например, красный — для «боевых» устройств, где нужна осторожность.">
            <div className="row" style={{ gap: 6 }}>
              {DEVICE_COLORS.map((c) => (
                <button key={c.id || 'none'} type="button" className={`swatch ${d.color === c.id ? 'on' : ''}`} style={{ background: c.css }} title={c.label} onClick={() => set('color', c.id)}>
                  {!c.id && '∅'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Описание">
            <textarea className="textarea" rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          </More>
        </>
      )}

      {tab === 'auth' && (
        <>
          {d.protocol === 'serial' && <Banner>При подключении через COM-порт логин и пароль вводятся прямо в терминале — так же, как в PuTTY. Если устройство ничего не показывает, нажмите Enter.</Banner>}
          {d.protocol === 'telnet' && <Banner>Telnet: если логин и пароль сохранены, программа ответит на запросы «Username:» и «Password:» сама. Иначе введите их в терминале.</Banner>}
          {d.protocol === 'ssh' && (
          <Field label="Способ авторизации">
            <select className="select" value={d.authMethod} onChange={(e) => set('authMethod', e.target.value as DeviceInput['authMethod'])}>
              <option value="password">Логин и пароль</option>
              <option value="key">SSH-ключ</option>
              <option value="agent">SSH Agent</option>
              <option value="keyboard-interactive">Keyboard-interactive</option>
            </select>
          </Field>
          )}
          {!vaultCanStore && wantsSecret && (
            <Banner kind="warn">
              {app.vault?.mode === 'master'
                ? 'Хранилище паролей заблокировано. Разблокируйте его (Настройки → Безопасность), чтобы сохранить пароль.'
                : 'Не выбран способ хранения паролей. На этом компьютере системное хранилище недоступно — задайте мастер-пароль в «Настройки → Безопасность» или оставьте поле пустым: пароль будет запрошен при подключении.'}
            </Banner>
          )}
          {d.protocol !== 'serial' && (d.authMethod === 'password' || d.authMethod === 'keyboard-interactive') && (
            <SecretField
              label="Пароль"
              stored={stored.password}
              mode={modes.password}
              value={values.password}
              onMode={(m) => setModes({ ...modes, password: m })}
              onValue={(v) => setValues({ ...values, password: v })}
              hint="Хранится в защищённом хранилище ОС или зашифрованным мастер-паролем. Если не сохранять — будет запрошен при подключении."
            />
          )}
          {d.protocol === 'ssh' && d.authMethod === 'key' && (
            <>
              <Field label="Путь к приватному ключу">
                <div className="row">
                  <input className="input mono" value={d.keyPath} onChange={(e) => set('keyPath', e.target.value)} placeholder="~/.ssh/id_ed25519" />
                  <Button onClick={pickKey}>Выбрать…</Button>
                </div>
              </Field>
              <SecretField
                label="Пароль приватного ключа (если ключ зашифрован)"
                stored={stored.keyPassphrase}
                mode={modes.keyPassphrase}
                value={values.keyPassphrase}
                onMode={(m) => setModes({ ...modes, keyPassphrase: m })}
                onValue={(v) => setValues({ ...values, keyPassphrase: v })}
              />
            </>
          )}
          {d.protocol === 'ssh' && d.authMethod === 'agent' && <Banner>Используется SSH Agent ({navigator.platform.startsWith('Win') ? 'OpenSSH Agent Windows' : 'переменная SSH_AUTH_SOCK'}).</Banner>}
          {!isLinux && (
            <SecretField
              label="Пароль привилегированного режима (enable)"
              stored={stored.enablePassword}
              mode={modes.enablePassword}
              value={values.enablePassword}
              onMode={(m) => setModes({ ...modes, enablePassword: m })}
              onValue={(v) => setValues({ ...values, enablePassword: v })}
              hint="Можно ввести автоматически после входа или кнопкой «enable-пароль» в терминале. В историю не записывается."
            />
          )}
          <More title="Дополнительные параметры: после входа, тайм-ауты, Jump Host, алгоритмы" open={full || !!(d.loginCommands || d.jumpDeviceId || d.legacyAlgorithms || d.readOnly)}>
          <Field label="Команды после входа (по одной на строку)" hint="Отправляются видимо в терминал сразу после подключения и проходят проверку «Только чтение». Например: terminal length 0, show clock. Пароли сюда не пишите.">
            <textarea className="textarea mono" rows={2} value={d.loginCommands} onChange={(e) => set('loginCommands', e.target.value)} placeholder={isLinux ? 'uptime' : 'show clock'} spellCheck={false} />
          </Field>
          {d.protocol !== 'serial' && (
          <div className="grid-3">
            <Field label="Keepalive, с" hint="0 — отключено">
              <input className="input" type="number" min={0} value={d.keepaliveSec} onChange={(e) => set('keepaliveSec', Number(e.target.value))} />
            </Field>
            <Field label="Тайм-аут подключения, с">
              <input className="input" type="number" min={5} value={d.timeoutSec} onChange={(e) => set('timeoutSec', Number(e.target.value))} />
            </Field>
            <Field label="Через промежуточный сервер (Jump Host)" hint={d.protocol === 'ssh' ? undefined : 'Только для SSH'}>
              <select className="select" disabled={d.protocol !== 'ssh'} value={d.jumpDeviceId ?? ''} onChange={(e) => set('jumpDeviceId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— напрямую —</option>
                {app.devices
                  .filter((x) => x.id !== id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.host})
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          )}
          {!isLinux && (
            <>
              <Toggle label="Автоматически входить в режим enable" desc="После входа, если приглашение заканчивается на «>», будет отправлено enable и сохранённый пароль." checked={d.autoEnable} onChange={(v) => set('autoEnable', v)} />
              <Toggle
                label="Отключать постраничный вывод при подключении"
                desc={getPlatform(d.platform).pagerOff.length ? `Будет выполнено: ${getPlatform(d.platform).pagerOff.join('; ')}` : 'Для этой платформы команда неизвестна — «--More--» обрабатывается автоматически при захвате вывода.'}
                checked={d.disablePagerOnConnect}
                onChange={(v) => set('disablePagerOnConnect', v)}
                disabled={!getPlatform(d.platform).pagerOff.length}
              />
            </>
          )}
          <Toggle label="Только чтение для этого устройства" desc="Изменяющие команды из справочника, сценариев и диагностики не будут отправляться." checked={d.readOnly} onChange={(v) => set('readOnly', v)} />
          {d.protocol === 'ssh' && (
          <Toggle
            label="Разрешить устаревшие алгоритмы SSH"
            desc="Только для этого устройства: diffie-hellman-group1/14-sha1, ssh-rsa/ssh-dss, CBC-шифры, hmac-sha1. Нужны старым коммутаторам. Глобально безопасность не ослабляется."
            checked={d.legacyAlgorithms}
            onChange={(v) => set('legacyAlgorithms', v)}
          />
          )}
          {d.protocol === 'ssh' && d.legacyAlgorithms && <Banner kind="warn">Устаревшие алгоритмы криптографически слабее. Используйте только для оборудования, которое не поддерживает современные.</Banner>}
          <Field label="Особенности подключения">
            <textarea className="textarea" rows={2} value={d.connectionNotes} onChange={(e) => set('connectionNotes', e.target.value)} />
          </Field>
          </More>
        </>
      )}

      {tab === 'extra' && (
        <>
          {isLinux && (
            <>
              <div className="grid-3">
                <Field label="Дистрибутив">
                  <input className="input" value={d.linuxDistro} onChange={(e) => set('linuxDistro', e.target.value)} placeholder="Debian" />
                </Field>
                <Field label="Версия Linux">
                  <input className="input" value={d.linuxVersion} onChange={(e) => set('linuxVersion', e.target.value)} placeholder="12 (bookworm)" />
                </Field>
                <Field label="Имя хоста">
                  <input className="input mono" value={d.hostname} onChange={(e) => set('hostname', e.target.value)} />
                </Field>
              </div>
              <Field label="Тип сервера">
                <input className="input" value={d.serverType} onChange={(e) => set('serverType', e.target.value)} placeholder="Сервер видеонаблюдения, Zabbix, файловый…" />
              </Field>
              <Field label="Установленные службы">
                <textarea className="textarea" rows={3} value={d.servicesNotes} onChange={(e) => set('servicesNotes', e.target.value)} placeholder="nginx, postgresql, zabbix-agent2…" />
              </Field>
            </>
          )}
          {!isLinux && <div className="muted small">Дополнительные поля для коммутаторов: модель и версия прошивки — на вкладке «Основное».</div>}
          <Toggle label="Избранное устройство" checked={d.favorite} onChange={(v) => set('favorite', v)} />
        </>
      )}
    </Modal>
  );
}
