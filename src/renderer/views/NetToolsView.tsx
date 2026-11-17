// Сетевые утилиты: калькулятор подсетей, MAC-адреса, ping/трассировка/порты с этого компьютера, SSH-ключи.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useApp, errMsg } from '../lib/store';
import { Icon } from '../lib/icons';
import { Banner, Button, Field, Tabs } from '../components/ui';
import { inSubnet, maskFromPrefix, ipToStr, parseIPv4, parseNetInput, prefixForHosts, splitSubnet, subnetInfo } from '../../shared/netcalc';
import { findMacsInText, formatMac, MAC_FORMAT_LABELS, parseMac } from '../../shared/mac';
import { PLATFORMS } from '../../shared/platforms';
import type { MacFormat } from '../../shared/platforms';

export type NetToolTab = 'calc' | 'mac' | 'ping' | 'keys';
let pendingTab: NetToolTab | null = null;

/** Открыть нужную утилиту из любого места (Ctrl+K, главная). */
export function openNetTool(app: ReturnType<typeof useApp>, tab: NetToolTab): void {
  pendingTab = tab;
  app.setSection('nettools');
  window.dispatchEvent(new CustomEvent('nad:nettool', { detail: tab }));
}

export function NetToolsView() {
  const [tab, setTab] = useState<NetToolTab>(() => {
    const t = pendingTab ?? 'calc';
    pendingTab = null;
    return t;
  });
  useEffect(() => {
    const h = (e: Event) => {
      setTab((e as CustomEvent<NetToolTab>).detail);
      pendingTab = null;
    };
    window.addEventListener('nad:nettool', h);
    return () => window.removeEventListener('nad:nettool', h);
  }, []);
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'calc', label: 'Калькулятор подсетей' },
          { id: 'mac', label: 'MAC-адреса' },
          { id: 'ping', label: 'Ping, трассировка, порты' },
          { id: 'keys', label: 'SSH-ключи' }
        ]}
      />
      {tab === 'calc' && <SubnetCalc />}
      {tab === 'mac' && <MacTool />}
      {tab === 'ping' && <PingTool />}
      {tab === 'keys' && <KeysTool />}
    </div>
  );
}

function Copyable({ text, label }: { text: string; label?: string }) {
  const app = useApp();
  return (
    <span className="copyable">
      <code>{text}</code>
      <button className="btn ghost icon sm" title={`Копировать${label ? `: ${label}` : ''}`} onClick={() => void app.copy(text)}>
        <Icon name="copy" size={12} />
      </button>
    </span>
  );
}

function SubnetCalc() {
  const [q, setQ] = useState('192.168.1.10/24');
  const [splitTo, setSplitTo] = useState(0);
  const [check, setCheck] = useState('');
  const [hosts, setHosts] = useState('');
  const parsed = parseNetInput(q);
  const err = 'error' in parsed ? parsed.error : null;
  const info = !err && !('error' in parsed) ? subnetInfo(parsed.ip, parsed.prefix) : null;
  const prefix = info?.prefix ?? 24;
  const parts = info && splitTo > prefix ? splitSubnet(parseIPv4(info.network)!, prefix, splitTo, 64) : [];
  const chk = parseIPv4(check);
  const needed = Number(hosts);
  return (
    <>
      <Field label="Адрес и маска" hint="Можно в любом виде: 10.0.5.17/26 · 10.0.5.17 255.255.255.192 · 10.0.5.0 0.0.0.63 (wildcard из ACL)">
        <input className={`input mono ${err ? 'invalid' : ''}`} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoFocus />
      </Field>
      <div className="row" style={{ gap: 6, marginTop: -6, marginBottom: 12, flexWrap: 'wrap' }}>
        {['192.168.1.10/24', '10.10.0.1 255.255.252.0', '10.20.30.0 0.0.0.255', '10.0.0.1/30', '100.64.12.5/10'].map((x) => (
          <button key={x} className="chip" onClick={() => setQ(x)}>
            {x}
          </button>
        ))}
      </div>
      {err && <Banner kind="warn">{err}</Banner>}
      {info && !('error' in parsed) && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <dl className="kv">
              <dt>Адрес</dt>
              <dd className="mono">{info.ip}</dd>
              <dt>Маска</dt>
              <dd>
                <Copyable text={info.mask} /> <span className="muted">/ {info.prefix}</span>
              </dd>
              <dt>Wildcard (для ACL)</dt>
              <dd>
                <Copyable text={info.wildcard} />
              </dd>
              <dt>Адрес сети</dt>
              <dd>
                <Copyable text={`${info.network}/${info.prefix}`} />
              </dd>
              <dt>Широковещательный</dt>
              <dd className="mono">{info.broadcast}</dd>
              <dt>Адреса для узлов</dt>
              <dd className="mono">
                {info.firstHost} — {info.lastHost}
              </dd>
              <dt>Узлов</dt>
              <dd>
                <b>{info.hosts.toLocaleString('ru-RU')}</b> <span className="muted small">(всего адресов {info.total.toLocaleString('ru-RU')})</span>
              </dd>
              <dt>Тип адреса</dt>
              <dd>{info.kind}</dd>
            </dl>
            {parsed.given === 'none' && <div className="small muted">Маска не указана — показан один адрес (/32). Добавьте /24 или маску.</div>}
            {parsed.given === 'wildcard' && <div className="small muted">Вторая часть распознана как wildcard-маска (обратная маска из ACL).</div>}
            {info.ipIsSpecial === 'network' && parsed.prefix < 31 && parsed.given !== 'none' && <div className="small" style={{ color: 'var(--warn)' }}>Это адрес самой сети: его не назначают на интерфейс.</div>}
            {info.ipIsSpecial === 'broadcast' && <div className="small" style={{ color: 'var(--warn)' }}>Это широковещательный адрес: его не назначают на интерфейс.</div>}
          </div>
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              Как записать
            </div>
            <div className="small muted">Интерфейс Cisco / SG300 / Qtech</div>
            <Copyable text={`ip address ${info.ip} ${info.mask}`} />
            <div className="small muted" style={{ marginTop: 8 }}>
              Строка ACL (вся сеть)
            </div>
            <Copyable text={`permit ip ${info.network} ${info.wildcard} any`} />
            <div className="small muted" style={{ marginTop: 8 }}>
              HP ProCurve, Linux
            </div>
            <Copyable text={`ip address ${info.ip}/${info.prefix}`} />
            <Copyable text={`ip addr add ${info.ip}/${info.prefix} dev eth0`} />
            <div className="section-title">Входит ли адрес в эту сеть?</div>
            <input className="input mono" placeholder="например 192.168.1.200" value={check} onChange={(e) => setCheck(e.target.value)} />
            {check && (chk === null ? <div className="small muted">Введите адрес полностью</div> : inSubnet(chk, parseIPv4(info.network)!, info.prefix) ? <div className="small" style={{ color: 'var(--ok)' }}>✔ Да, {check} в сети {info.network}/{info.prefix}</div> : <div className="small" style={{ color: 'var(--danger)' }}>✘ Нет, {check} в другой сети — нужен маршрутизатор (шлюз)</div>)}
          </div>
        </div>
      )}
      {info && (
        <div className="grid-2" style={{ alignItems: 'start', marginTop: 12 }}>
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              Разделить сеть на подсети
            </div>
            <div className="row">
              <span className="small">По</span>
              <select className="select" style={{ width: 'auto' }} value={splitTo} onChange={(e) => setSplitTo(Number(e.target.value))}>
                <option value={0}>— выберите размер —</option>
                {Array.from({ length: Math.min(8, 32 - prefix) }, (_, i) => prefix + i + 1).map((p) => (
                  <option key={p} value={p}>
                    /{p} — {2 ** (p - prefix)} подсетей по {Math.max(p >= 31 ? 2 ** (32 - p) : 2 ** (32 - p) - 2, 1)} узлов
                  </option>
                ))}
              </select>
            </div>
            {parts.length > 0 && (
              <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
                <table className="table small">
                  <thead>
                    <tr>
                      <th>Подсеть</th>
                      <th>Узлы</th>
                      <th>Широковещательный</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((p) => (
                      <tr key={p.network}>
                        <td className="mono">{p.network}</td>
                        <td className="mono">
                          {p.first} — {p.last}
                        </td>
                        <td className="mono">{p.broadcast}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="section-title">Сколько нужно узлов?</div>
            <div className="row">
              <input className="input" type="number" min={1} style={{ width: 120 }} value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="например 50" />
              {needed > 0 && (
                <span className="small">
                  Минимум: <b>/{prefixForHosts(needed)}</b> ({ipToStr(maskFromPrefix(prefixForHosts(needed)))}) — {2 ** (32 - prefixForHosts(needed)) - 2} узлов
                </span>
              )}
            </div>
          </div>
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              Шпаргалка по маскам
            </div>
            <table className="table small">
              <thead>
                <tr>
                  <th>Префикс</th>
                  <th>Маска</th>
                  <th>Wildcard</th>
                  <th>Узлов</th>
                </tr>
              </thead>
              <tbody>
                {[8, 16, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].map((p) => (
                  <tr key={p} className={p === prefix ? 'hl' : ''}>
                    <td>/{p}</td>
                    <td className="mono">{ipToStr(maskFromPrefix(p))}</td>
                    <td className="mono">{ipToStr(~maskFromPrefix(p) >>> 0)}</td>
                    <td>{p === 32 ? 1 : p === 31 ? 2 : (2 ** (32 - p) - 2).toLocaleString('ru-RU')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function MacTool() {
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const hex = parseMac(q);
  const formats: MacFormat[] = ['cisco', 'colon', 'dash', 'hp', 'plain'];
  const byFormat = useMemo(() => {
    const m = new Map<MacFormat, string[]>();
    for (const p of PLATFORMS.filter((x) => x.kind === 'switch')) m.set(p.macFormat, [...(m.get(p.macFormat) ?? []), `${p.name}${p.macFormatVerified ? '' : ' *'}`]);
    return m;
  }, []);
  const found = useMemo(() => {
    const seen = new Set<string>();
    return findMacsInText(text).filter((m) => (seen.has(m.hex) ? false : (seen.add(m.hex), true)));
  }, [text]);
  const first = hex ? parseInt(hex.slice(0, 2), 16) : 0;
  return (
    <>
      <Field label="MAC-адрес в любом виде" hint="aabb.ccdd.eeff · aa:bb:cc:dd:ee:ff · AA-BB-CC-DD-EE-FF · aabbcc-ddeeff · aabbccddeeff">
        <input className={`input mono ${q && !hex ? 'invalid' : ''}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="например 00:1A:2B:3C:4D:5E" autoFocus spellCheck={false} />
      </Field>
      {q && !hex && <Banner kind="warn">Не похоже на MAC-адрес: нужно 12 шестнадцатеричных символов (0–9, a–f).</Banner>}
      {hex && (
        <div className="card">
          <table className="table">
            <tbody>
              {formats.map((f) => (
                <tr key={f}>
                  <td style={{ width: 170 }} className="muted small">
                    {MAC_FORMAT_LABELS[f]}
                  </td>
                  <td>
                    <Copyable text={formatMac(hex, f)} />
                    {f !== 'plain' && <Copyable text={formatMac(hex, f).toUpperCase()} />}
                  </td>
                  <td className="small muted">{(byFormat.get(f) ?? []).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 8 }}>
            Первые 3 байта (OUI, код производителя): <b className="mono">{formatMac(hex, 'colon').slice(0, 8).toUpperCase()}</b>. Определение производителя по OUI требует базы IEEE и офлайн не выполняется.
            {first & 1 ? ' Это групповой (multicast) адрес — у обычного устройства такого не бывает.' : ''}
            {first & 2 ? ' Адрес локально назначенный: так бывает у виртуальных машин и у телефонов со «случайным MAC» для Wi-Fi.' : ''}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            * — формат взят из документации производителя и на реальном оборудовании не проверялся. Чтобы найти порт по этому адресу, используйте «Диагностика → Поиск по MAC»: программа сама подставит нужный формат для каждого коммутатора.
          </div>
        </div>
      )}
      <div className="section-title">Найти MAC-адреса в тексте</div>
      <textarea className="textarea mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Вставьте вывод show mac address-table, arp -a, ip neigh — программа найдёт все MAC-адреса" />
      {text && (
        <div className="small" style={{ marginTop: 6 }}>
          Найдено уникальных: <b>{found.length}</b>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {found.slice(0, 200).map((m) => (
              <button key={m.hex} className="chip mono" onClick={() => setQ(m.raw)} title="Показать во всех форматах">
                {formatMac(m.hex, 'colon')}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PingTool() {
  const app = useApp();
  const [host, setHost] = useState('');
  const [ports, setPorts] = useState('22, 23, 80, 443');
  const [out, setOut] = useState('');
  const [run, setRun] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ port: number; ok: boolean; ms: number; text: string }[] | null>(null);
  const runRef = useRef<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(
    () =>
      api.on((e) => {
        if (e.type === 'tools:output' && e.runId === runRef.current) setOut((o) => (o + e.chunk).slice(-60000));
        if (e.type === 'tools:done' && e.runId === runRef.current) {
          setOut((o) => `${o}\n[завершено${e.code === null ? '' : `, код ${e.code}`}]\n`);
          runRef.current = null;
          setRun(null);
        }
      }),
    []
  );
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [out]);
  const start = async (tool: 'ping' | 'traceroute') => {
    try {
      setChecks(null);
      const r = await api.tools.run(tool, host);
      runRef.current = r.runId;
      setRun(r.runId);
      setOut(`$ ${r.commandLine}\n`);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const check = async () => {
    try {
      setChecks(await api.tools.tcpCheck(host, ports.split(/[\s,;]+/).map(Number).filter(Boolean)));
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const netDevices = app.devices.filter((d) => d.protocol !== 'serial');
  return (
    <>
      <Banner>Проверки выполняются с этого компьютера. Так видно, доступно ли устройство из вашей сети — до подключения по SSH или Telnet.</Banner>
      <div className="grid-2">
        <Field label="Адрес или имя">
          <div className="row">
            <input className="input mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.1 или server.local" onKeyDown={(e) => e.key === 'Enter' && host && void start('ping')} />
            {netDevices.length > 0 && (
              <select className="select" style={{ width: 170 }} value="" onChange={(e) => setHost(e.target.value)} title="Подставить адрес устройства">
                <option value="">из устройств…</option>
                {netDevices.map((d) => (
                  <option key={d.id} value={d.host}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </Field>
        <Field label="Порты для проверки" hint="SSH 22, Telnet 23, HTTP 80, HTTPS 443, RTSP 554, SNMP 161 (UDP не проверяется)">
          <input className="input mono" value={ports} onChange={(e) => setPorts(e.target.value)} />
        </Field>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="primary" icon="activity" disabled={!host || !!run} onClick={() => void start('ping')}>
          Ping
        </Button>
        <Button icon="route" disabled={!host || !!run} onClick={() => void start('traceroute')}>
          Трассировка
        </Button>
        <Button icon="plug" disabled={!host} onClick={() => void check()}>
          Проверить порты
        </Button>
        {run && (
          <Button icon="x" onClick={() => void api.tools.stop(run)}>
            Остановить
          </Button>
        )}
      </div>
      {checks && (
        <div className="card">
          {checks.map((c) => (
            <div key={c.port} className="row small" style={{ padding: '3px 0' }}>
              <span style={{ color: c.ok ? 'var(--ok)' : 'var(--danger)' }}>{c.ok ? '✔' : '✘'}</span>
              <span className="grow">{c.text}</span>
              <span className="muted">{c.ms} мс</span>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 6 }}>
            «Закрыт» — устройство ответило отказом (служба выключена). «Нет ответа» — пакеты теряются: firewall, ACL, неверный адрес или узел выключен.
          </div>
        </div>
      )}
      {out && (
        <pre ref={preRef} className="output" style={{ maxHeight: 420 }}>
          {out}
        </pre>
      )}
    </>
  );
}

function KeysTool() {
  const app = useApp();
  const [comment, setComment] = useState('netadmin');
  const [pass, setPass] = useState('');
  const [key, setKey] = useState<{ path: string; publicKey: string; fingerprint: string } | null>(null);
  const [target, setTarget] = useState('');
  const [deviceId, setDeviceId] = useState(0);
  const linuxSessions = app.sessions.filter((s) => s.platform === 'linux' && (s.protocol ?? 'ssh') === 'ssh' && s.status === 'ready');
  const create = async () => {
    const path = await api.app.selectSaveFile({ title: 'Где сохранить приватный ключ', defaultPath: 'id_ed25519_netadmin' });
    if (!path) return;
    try {
      setKey(await api.tools.createKey({ path, comment, passphrase: pass || undefined }));
      setPass('');
      app.toast('Ключ создан', 'ok');
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  const install = () => {
    if (!key) return;
    const s = linuxSessions.find((x) => x.key === target) ?? linuxSessions[0];
    if (!s) return app.toast('Подключитесь к Linux-серверу по SSH', 'warn');
    const pub = key.publicKey.replace(/'/g, '');
    app.execute({
      title: 'Добавить открытый SSH-ключ в authorized_keys',
      command: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qxF '${pub}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
      kind: 'linux',
      platform: 'linux',
      risk: 'change',
      source: 'reference',
      sessionKey: s.key
    });
  };
  const useForDevice = async () => {
    const d = app.devices.find((x) => x.id === deviceId);
    if (!d || !key) return;
    try {
      await api.devices.save({ ...d, authMethod: 'key', keyPath: key.path });
      await app.refresh('devices');
      app.toast(`«${d.name}»: вход по ключу. Проверьте подключение, прежде чем запрещать вход по паролю на сервере.`, 'ok');
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <>
      <Banner>
        Вход по ключу безопаснее пароля: пароль не передаётся на сервер, а подобрать ключ невозможно. Приватный ключ остаётся только на этом компьютере (файл без расширения), на сервер копируется открытый (<code>.pub</code>).
      </Banner>
      <div className="grid-3">
        <Field label="Комментарий" hint="Чтобы потом узнать ключ в authorized_keys">
          <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <Field label="Парольная фраза (необязательно)" hint="Защищает файл ключа, если его украдут. Её нужно будет сохранить в карточке устройства или вводить при подключении.">
          <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </Field>
        <Field label="Тип">
          <input className="input" value="ed25519 (современный, короткий)" disabled />
        </Field>
      </div>
      <Button variant="primary" icon="key" onClick={() => void create()}>
        Создать ключ…
      </Button>
      {key && (
        <div className="card" style={{ marginTop: 12 }}>
          <dl className="kv">
            <dt>Приватный ключ</dt>
            <dd className="mono small">{key.path}</dd>
            <dt>Открытый ключ</dt>
            <dd className="mono small">{key.path}.pub</dd>
            <dt>Отпечаток</dt>
            <dd className="mono small">{key.fingerprint}</dd>
          </dl>
          <pre className="output" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {key.publicKey}
          </pre>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button icon="copy" onClick={() => void app.copy(key.publicKey)}>
              Копировать открытый ключ
            </Button>
          </div>
          <div className="section-title">1. Установить на сервер</div>
          {linuxSessions.length ? (
            <div className="row">
              <select className="select" style={{ width: 'auto' }} value={target} onChange={(e) => setTarget(e.target.value)}>
                {linuxSessions.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.deviceName} ({s.host})
                  </option>
                ))}
              </select>
              <Button icon="play" onClick={install}>
                Добавить в authorized_keys…
              </Button>
            </div>
          ) : (
            <div className="small muted">Подключитесь к Linux-серверу по SSH (паролем) — здесь появится кнопка установки. Команда будет показана перед выполнением.</div>
          )}
          <div className="section-title">2. Входить по ключу</div>
          <div className="row">
            <select className="select" style={{ width: 'auto' }} value={deviceId} onChange={(e) => setDeviceId(Number(e.target.value))}>
              <option value={0}>— устройство —</option>
              {app.devices
                .filter((d) => d.protocol === 'ssh')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.host})
                  </option>
                ))}
            </select>
            <Button disabled={!deviceId} onClick={() => void useForDevice()}>
              Использовать этот ключ
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
