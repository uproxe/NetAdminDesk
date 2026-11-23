// Диагностика: мастера для коммутаторов (профиль команд для каждой платформы), Linux-серверов, поиск MAC.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, errMsg, type OpenSession } from '../lib/store';
import * as terms from '../lib/terminals';
import { Banner, Button, Check, Empty, Field, Tabs } from '../components/ui';
import { TemplateFill } from '../components/ExecuteDialog';
import { SWITCH_TASKS, MAC_TABLE_DUMP, NEIGHBOR_COMMANDS, tasksFor } from '../../../data/profiles';
import { LINUX_TASKS, LINUX_TASK_GROUPS, checkById, compareMetrics, linuxTaskGroup } from '../../shared/linuxDiag';
import { getPlatform, PLATFORMS } from '../../shared/platforms';
import { classifyCommand } from '../../shared/risk';
import { parseTemplate, renderTemplate } from '../../shared/templates';
import { MAC_FORMAT_LABELS, formatMac, parseMac } from '../../shared/mac';
import { parseMacTable, parseNeighbors, samePort, type MacHit, type Neighbor } from '../../shared/macTrace';
import { diffLines, diffStats } from '../../shared/diff';
import type { CheckStatus, DiagnosticCheck, DiagnosticProfileStep, DiagnosticReport, DiagnosticResult, Device } from '../../shared/types';
import { fmtDate } from '../lib/format';

type Tab = 'switch' | 'linux' | 'mac' | 'profiles' | 'reports';

export function DiagnosticsView() {
  const [tab, setTab] = useState<Tab>('switch');
  return (
    <div className="page" style={{ maxWidth: 1300 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'switch', label: 'Коммутаторы' },
          { id: 'linux', label: 'Linux-серверы' },
          { id: 'mac', label: 'Поиск MAC' },
          { id: 'profiles', label: 'Профили платформ' },
          { id: 'reports', label: 'Сохранённые отчёты' }
        ]}
      />
      {tab === 'switch' && <SwitchDiag />}
      {tab === 'linux' && <LinuxDiag />}
      {tab === 'mac' && <MacSearch />}
      {tab === 'profiles' && <ProfilesEditor />}
      {tab === 'reports' && <Reports />}
    </div>
  );
}

const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'Норма', warn: 'Внимание', crit: 'Проблема', info: 'Информация', unknown: 'Нет данных' };

function SessionPicker({ linux, value, onChange }: { linux: boolean; value: string; onChange: (k: string) => void }) {
  const app = useApp();
  const ready = app.sessions.filter((s) => !s.pending && s.status === 'ready' && (s.platform === 'linux') === linux);
  const devices = app.devices.filter((d) => (d.platform === 'linux') === linux);
  const [dev, setDev] = useState<number | ''>('');
  useEffect(() => {
    if (!value && ready[0]) onChange(ready[0].key);
  }, [ready, value, onChange]);
  return (
    <div className="row wrap" style={{ marginBottom: 12 }}>
      <Field label="Сессия">
        <select className="select" style={{ minWidth: 280 }} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— нет подключённой сессии —</option>
          {ready.map((s) => (
            <option key={s.key} value={s.key}>
              {s.deviceName} ({getPlatform(s.platform).name})
            </option>
          ))}
        </select>
      </Field>
      <Field label="или подключиться к устройству">
        <div className="row">
          <select className="select" style={{ minWidth: 240 }} value={dev} onChange={(e) => setDev(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— выберите —</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button
            icon="plug"
            disabled={!dev}
            onClick={async () => {
              const id = await app.connect(Number(dev), { background: true });
              if (id) onChange(id);
            }}
          >
            Подключить
          </Button>
        </div>
      </Field>
    </div>
  );
}

function outputProblem(out: string): string | null {
  if (/% ?(Invalid input|Unknown command|Incomplete command|Ambiguous command)|Unrecognized command|Error: Invalid|command not found|Неизвестная команда/i.test(out)) {
    return 'Устройство не распознало команду — проверьте профиль этой платформы.';
  }
  return null;
}

const HL = /(err-disabled|notconnect|\bdown\b|errors?|crc|collision|drop|fail|denied|deny|blocked|faulty|overload)/i;

function Highlighted({ text }: { text: string }) {
  return (
    <pre className="output">
      {text.split('\n').map((l, i) => (
        <div key={i} className={HL.test(l) && !/\b0\s+(input )?errors?\b/i.test(l) ? 'highlight' : undefined}>
          {l || ' '}
        </div>
      ))}
    </pre>
  );
}

function TaskOverview({ text, items }: { text: string; items: { id: string; title: string; description: string }[] }) {
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <h3>Доступные проверки</h3>
      <div className="small muted" style={{ marginBottom: 10 }}>
        {text}
      </div>
      <div className="card-grid">
        {items.map((i) => (
          <div key={i.id} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
            <div style={{ fontWeight: 550 }}>{i.title}</div>
            <div className="small muted">{i.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SwitchDiag() {
  const app = useApp();
  const [key, setKey] = useState('');
  const [task, setTask] = useState(SWITCH_TASKS[0].id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pager, setPager] = useState(true);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [prev, setPrev] = useState<DiagnosticResult | null>(null);
  const sess = app.sessionByKey(key);
  const platform = sess?.platform ?? '';
  const tasks = tasksFor(platform, (id) => app.profiles.some((p) => p.platform === platform && p.task === id), getPlatform(platform).diagOnlyProfiled);
  // При смене устройства задача может оказаться недоступной (например, PoE для межсетевого экрана)
  useEffect(() => {
    if (tasks.length && !tasks.some((x) => x.id === task)) setTask(tasks[0].id);
  }, [platform]);
  const profile = app.profiles.find((p) => p.platform === platform && p.task === task);
  const t = SWITCH_TASKS.find((x) => x.id === task)!;
  const tpl = (profile?.steps ?? []).map((s) => s.command).join('\n');
  const rendered = renderTemplate(tpl, values, { platform, custom: app.templateParams });
  const missing = rendered.missing.length > 0 || Object.keys(rendered.errors).length > 0;

  const run = async () => {
    if (!sess || !profile) return;
    setBusy(true);
    setReport(null);
    const started = new Date().toISOString();
    const checks: DiagnosticCheck[] = [];
    try {
      const p = getPlatform(platform);
      if (pager) for (const c of p.pagerOff) await api.ssh.capture(sess.id, c, { timeoutMs: 6000, idleMs: 800 }, { source: 'diagnostic', risk: 'info' });
      for (const step of profile.steps) {
        const cmd = renderTemplate(step.command, values, { platform, custom: app.templateParams }).text;
        const risk = classifyCommand(cmd, 'switch', platform).level;
        if (risk !== 'info' && !(await app.confirm({ title: 'Команда не только для просмотра', text: <pre className="output">{cmd}</pre>, okText: 'Выполнить' }))) continue;
        const r = await api.ssh.capture(sess.id, cmd, { timeoutMs: 90000 }, { source: 'diagnostic', risk, note: t.title });
        const problem = outputProblem(r.output);
        checks.push({
          id: cmd,
          title: cmd,
          status: problem ? 'unknown' : 'info',
          summary: problem ?? (r.timedOut ? 'Вывод мог быть получен не полностью (превышено время ожидания)' : `${r.output.split('\n').length} строк вывода`),
          criteria: t.description,
          commands: [{ command: cmd, output: r.output }],
          findings: [...(step.unverified ? ['Синтаксис команды не подтверждён для всех моделей этой платформы'] : []), ...(step.fromUserTxt ? ['Команда из TXT-заметок'] : [])]
        });
      }
      const rep: DiagnosticReport = { task, title: t.title, deviceName: sess.deviceName, platform, startedAt: started, finishedAt: new Date().toISOString(), checks };
      const history = await api.diagnostics.list(sess.deviceId, `switch:${task}`);
      setPrev(history[0] ?? null);
      await api.diagnostics.save(sess.deviceId, sess.deviceName, `switch:${task}`, rep);
      setReport(rep);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SessionPicker linux={false} value={key} onChange={setKey} />
      {!sess && (
        <TaskOverview
          text="Подключитесь к коммутатору (или выберите открытую сессию). Команды для каждой задачи берутся из профиля платформы устройства — в основном из TXT-заметок; профили можно изменить на вкладке «Профили платформ». Перед запуском показываются все команды, изменяющие команды отдельно подтверждаются."
          items={SWITCH_TASKS.filter((x) => !x.only).map((x) => ({ id: x.id, title: x.title, description: x.description }))}
        />
      )}
      {sess && (
        <div className="grid-2" style={{ gap: 16, alignItems: 'start' }}>
          <div className="card">
            <h3>Сценарий диагностики</h3>
            <Field label="Задача">
              <select className="select" value={task} onChange={(e) => (setTask(e.target.value), setReport(null))}>
                {tasks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </Field>
            <div className="small muted" style={{ marginBottom: 10 }}>
              Платформа: <b>{getPlatform(platform).name}</b>. Используются команды именно этой платформы.
            </div>
            {!profile ? (
              <Banner kind="warn">
                Для платформы «{getPlatform(platform).name}» нет проверенной команды для этой задачи. Добавьте свою во вкладке «Профили платформ» — команды других производителей не подставляются.
              </Banner>
            ) : (
              <>
                <TemplateFill template={tpl} values={values} onChange={setValues} custom={app.templateParams} platform={platform} />
                <div className="section-title">Будут выполнены (видимо в терминале)</div>
                <div className="cmd-block">
                  {rendered.text.split('\n').map((l, i) => (
                    <div className="cmd-line" key={i}>
                      <div className="code">
                        {l}
                        {profile.steps[i]?.fromUserTxt && <span className="note">из TXT-заметок</span>}
                        {profile.steps[i]?.unverified && <span className="note" style={{ color: 'var(--warn)' }}>синтаксис не подтверждён для всех моделей</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {getPlatform(platform).pagerOff.length > 0 && <Check checked={pager} onChange={setPager} label={`Сначала отключить постраничный вывод (${getPlatform(platform).pagerOff.join('; ')})`} />}
                <Button variant="primary" icon="play" style={{ marginTop: 10 }} disabled={busy || missing} onClick={run}>
                  {busy ? 'Выполняется…' : 'Запустить'}
                </Button>
              </>
            )}
          </div>
          <div>{report ? <ReportView report={report} prev={prev} /> : <Empty icon="activity" title="Отчёт появится после запуска" />}</div>
        </div>
      )}
    </>
  );
}

function LinuxDiag() {
  const app = useApp();
  const [key, setKey] = useState('');
  const [task, setTask] = useState(LINUX_TASKS[0].id);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [prev, setPrev] = useState<DiagnosticResult | null>(null);
  const sess = app.sessionByKey(key);
  const t = LINUX_TASKS.find((x) => x.id === task)!;
  const checks = t.checks.map((c) => checkById(c)!).filter(Boolean);
  const run = async () => {
    if (!sess) return;
    setBusy(true);
    setReport(null);
    const started = new Date().toISOString();
    const results: DiagnosticCheck[] = [];
    try {
      terms.writeInfo(sess.key, `[диагностика «${t.title}»: команды выполняются через отдельный канал SSH exec, результаты — в разделе «Диагностика»]`);
      for (const c of checks) {
        const outs = [];
        for (const cmd of c.commands) {
          terms.writeInfo(sess.key, `[диагностика] $ ${cmd}`);
          try {
            const r = await api.ssh.exec(sess.id, cmd, { source: 'diagnostic', risk: 'info', note: t.title }, 60000);
            outs.push({ command: cmd, output: r.stdout + (r.stderr ? `\n${r.stderr}` : ''), code: r.code });
          } catch (e) {
            outs.push({ command: cmd, output: '', error: errMsg(e) });
          }
        }
        const a = c.analyze(outs);
        results.push({ id: c.id, title: c.title, status: a.status, summary: a.summary, criteria: c.criteria, metrics: a.metrics, commands: outs, findings: a.findings });
      }
      const rep: DiagnosticReport = { task, title: t.title, deviceName: sess.deviceName, platform: 'linux', startedAt: started, finishedAt: new Date().toISOString(), checks: results };
      const history = await api.diagnostics.list(sess.deviceId, `linux:${task}`);
      setPrev(history[0] ?? null);
      await api.diagnostics.save(sess.deviceId, sess.deviceName, `linux:${task}`, rep);
      setReport(rep);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SessionPicker linux value={key} onChange={setKey} />
      {!sess && (
        <TaskOverview
          text="Подключитесь к Linux-серверу. Проверки выполняются отдельными командами только для чтения (канал exec); каждая команда и её вывод видны в отчёте и дублируются в терминал сессии. Отчёт сохраняется и сравнивается с предыдущим запуском."
          items={LINUX_TASK_GROUPS.flatMap((g) => LINUX_TASKS.filter((x) => linuxTaskGroup(x) === g.id)).map((x) => ({ id: x.id, title: x.title, description: x.checks.map((c) => checkById(c)?.title ?? c).join(' · ') }))}
        />
      )}
      {sess && (
        <div className="grid-2" style={{ gap: 16, alignItems: 'start' }}>
          <div className="card">
            <h3>Мастер диагностики</h3>
            <Field label="Задача">
              <select className="select" value={task} onChange={(e) => (setTask(e.target.value), setReport(null))}>
                {LINUX_TASK_GROUPS.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    {LINUX_TASKS.filter((x) => linuxTaskGroup(x) === g.id).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {linuxTaskGroup(t) === 'db' && (
                <div className="small muted" style={{ marginTop: 6 }}>
                  Проверки баз данных выполняют только запросы на чтение. Под root вход в MySQL / MariaDB идёт через сокет, в PostgreSQL — от имени postgres (runuser, без sudo). Под обычным пользователем нужен ~/.my.cnf или ~/.pgpass, иначе отчёт подскажет, как дать доступ. Проверки СУБД, которой нет на сервере, отмечаются «не установлен».
                </div>
              )}
            </Field>
            <div className="section-title">Команды (только просмотр, без sudo)</div>
            <div className="cmd-block" style={{ maxHeight: 360, overflow: 'auto' }}>
              {checks.flatMap((c) => c.commands).map((cmd, i) => (
                <div className="cmd-line" key={i}>
                  <div className="code">{cmd}</div>
                </div>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Команды выполняются от имени пользователя сессии. Часть сведений (имена процессов портов, параметры sshd) доступна только с правами root — это отмечается в отчёте.
            </div>
            <Button variant="primary" icon="play" style={{ marginTop: 10 }} disabled={busy} onClick={run}>
              {busy ? 'Выполняется…' : 'Запустить'}
            </Button>
          </div>
          <div>{report ? <ReportView report={report} prev={prev} /> : <Empty icon="activity" title="Отчёт появится после запуска" />}</div>
        </div>
      )}
    </>
  );
}

export function ReportView({ report, prev }: { report: DiagnosticReport; prev?: DiagnosticResult | null }) {
  const counts = report.checks.reduce<Record<string, number>>((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
  return (
    <div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            {report.title}: {report.deviceName}
          </h3>
          <span className="small muted">{fmtDate(report.finishedAt, true)}</span>
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          {(['crit', 'warn', 'ok', 'info', 'unknown'] as CheckStatus[]).filter((s) => counts[s]).map((s) => (
            <span key={s} className={`badge ${s === 'crit' ? 'crit' : s === 'warn' ? 'warn' : s === 'ok' ? 'ok' : ''}`}>
              {STATUS_LABEL[s]}: {counts[s]}
            </span>
          ))}
        </div>
        {prev && <div className="small muted" style={{ marginTop: 6 }}>Сравнение с отчётом от {fmtDate(prev.ts)}</div>}
      </div>
      {report.checks.map((c) => {
        const p = prev?.report.checks.find((x) => x.id === c.id);
        const delta = compareMetrics(p?.metrics, c.metrics);
        const outDiff = p && !c.metrics ? diffStats(diffLines(p.commands.map((x) => x.output).join('\n'), c.commands.map((x) => x.output).join('\n'))) : null;
        return (
          <div key={c.id} className={`check-card ${c.status}`}>
            <div className="row">
              <b className="grow mono" style={{ fontFamily: report.platform === 'linux' ? 'var(--ui-font)' : undefined }}>
                {c.title}
              </b>
              <span className={`badge ${c.status === 'crit' ? 'crit' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : ''}`}>{STATUS_LABEL[c.status]}</span>
            </div>
            <div style={{ margin: '4px 0' }}>{c.summary}</div>
            {c.findings.filter(Boolean).map((f, i) => (
              <div key={i} className="small" style={{ color: c.status === 'crit' ? 'var(--crit)' : c.status === 'warn' ? 'var(--warn)' : 'var(--text-dim)' }}>
                • {f}
              </div>
            ))}
            {delta.length > 0 && <div className="small muted">Изменения с прошлого раза: {delta.join('; ')}</div>}
            {outDiff && (outDiff.added || outDiff.removed) ? <div className="small muted">По сравнению с прошлым отчётом: +{outDiff.added} / −{outDiff.removed} строк вывода</div> : null}
            <details>
              <summary>Критерии оценки и исходный вывод</summary>
              <div className="small muted" style={{ marginBottom: 6 }}>
                {c.criteria}
              </div>
              {c.commands.map((x, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div className="mono small">
                    $ {x.command} {x.code != null && x.code !== 0 ? <span style={{ color: 'var(--warn)' }}>(код {x.code})</span> : null}
                  </div>
                  {x.error ? <Banner kind="crit">{x.error}</Banner> : <Highlighted text={x.output || '(пустой вывод)'} />}
                </div>
              ))}
            </details>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Поиск MAC ----------

interface Hop {
  device: Device;
  status: 'searching' | 'found' | 'not-found' | 'error';
  hits: MacHit[];
  commands: { command: string; output: string }[];
  neighbor?: Neighbor;
  next?: Device;
  error?: string;
}

function MacSearch() {
  const app = useApp();
  const [mac, setMac] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [vlan, setVlan] = useState('');
  const [hops, setHops] = useState<Hop[]>([]);
  const [busy, setBusy] = useState(false);
  const hex = parseMac(mac);
  const switches = app.devices.filter((d) => d.platform !== 'linux');

  const ensureSession = async (d: Device): Promise<OpenSession | null> => {
    const open = app.sessions.find((s) => s.deviceId === d.id && !s.pending && s.status === 'ready');
    if (open) return open;
    const id = await app.connect(d.id, { background: true });
    if (!id) return null;
    await new Promise((r) => setTimeout(r, 1200));
    return app.sessionByKey(id) ?? ({ id, key: id, deviceId: d.id, deviceName: d.name, platform: d.platform } as OpenSession);
  };

  const searchOn = async (d: Device): Promise<Hop> => {
    const hop: Hop = { device: d, status: 'searching', hits: [], commands: [] };
    try {
      const s = await ensureSession(d);
      if (!s) return { ...hop, status: 'error', error: 'Не удалось подключиться' };
      const p = getPlatform(d.platform);
      for (const c of p.pagerOff) await api.ssh.capture(s.id, c, { timeoutMs: 6000, idleMs: 800 }, { source: 'mac-search', risk: 'info' });
      const profile = app.profiles.find((x) => x.platform === d.platform && x.task === 'mac-find');
      const vals = { MAC: hex!, VLAN: vlan };
      const tried: DiagnosticProfileStep[] = [];
      if (profile) tried.push(...profile.steps);
      const dump = MAC_TABLE_DUMP[d.platform];
      if (dump && !tried.some((t) => t.command === dump.command)) tried.push(dump);
      for (const step of tried) {
        const params = parseTemplate(step.command).map((x) => x.name);
        if (params.includes('VLAN') && !vlan) continue;
        const cmd = renderTemplate(step.command, vals, { platform: d.platform }).text;
        const r = await api.ssh.capture(s.id, cmd, { timeoutMs: 90000 }, { source: 'mac-search', risk: 'info', note: `поиск ${formatMac(hex!, 'cisco')}` });
        hop.commands.push({ command: cmd, output: r.output });
        hop.hits = parseMacTable(r.output, hex!, d.platform);
        if (hop.hits.length) break;
      }
      hop.status = hop.hits.length ? 'found' : 'not-found';
      const port = hop.hits.find((h) => h.port)?.port;
      if (port) {
        for (const nc of NEIGHBOR_COMMANDS[d.platform] ?? []) {
          const r = await api.ssh.capture(s.id, nc.command, { timeoutMs: 60000 }, { source: 'mac-search', risk: 'info' });
          hop.commands.push({ command: nc.command, output: r.output });
          const n = parseNeighbors(r.output).find((x) => samePort(x.localPort, port));
          if (n) {
            hop.neighbor = n;
            const shortName = n.name.split('.')[0].toLowerCase();
            hop.next = app.devices.find((x) => x.id !== d.id && ((n.ip && x.host === n.ip) || x.name.toLowerCase() === shortName || x.hostname.toLowerCase() === shortName));
            break;
          }
        }
      }
    } catch (e) {
      return { ...hop, status: 'error', error: errMsg(e) };
    }
    return hop;
  };

  const run = async (devices: Device[], append = false) => {
    if (!hex) return;
    setBusy(true);
    if (!append) setHops([]);
    for (const d of devices) {
      setHops((h) => [...h, { device: d, status: 'searching', hits: [], commands: [] }]);
      const res = await searchOn(d);
      setHops((h) => h.map((x) => (x.device.id === d.id && x.status === 'searching' ? res : x)));
    }
    setBusy(false);
  };

  return (
    <div className="grid-2" style={{ gap: 16, alignItems: 'start', gridTemplateColumns: '380px 1fr' }}>
      <div className="card">
        <h3>Поиск устройства по MAC</h3>
        <Field label="MAC-адрес (любой формат)" error={mac && !hex ? 'Некорректный MAC' : null}>
          <input className="input mono" value={mac} onChange={(e) => setMac(e.target.value)} placeholder="0011.2233.4455 / 00:11:22:33:44:55" autoFocus />
        </Field>
        {hex && (
          <div className="small muted" style={{ marginBottom: 10 }}>
            {(['cisco', 'dash', 'colon', 'hp'] as const).map((f) => (
              <div key={f} className="mono">
                {formatMac(hex, f)} <span className="faint">({MAC_FORMAT_LABELS[f]})</span>
              </div>
            ))}
          </div>
        )}
        <Field label="VLAN (нужен для OSNOVO: поиск по таблице FDB VLAN)">
          <input className="input mono" value={vlan} onChange={(e) => setVlan(e.target.value)} placeholder="необязательно" />
        </Field>
        <Field label="Коммутаторы для поиска">
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' }}>
            {!switches.length && <div className="small muted">Нет сохранённых коммутаторов.</div>}
            {switches.map((d) => (
              <Check key={d.id} checked={selected.includes(d.id)} onChange={(v) => setSelected(v ? [...selected, d.id] : selected.filter((x) => x !== d.id))} label={`${d.name} (${getPlatform(d.platform).name})`} />
            ))}
          </div>
        </Field>
        <Button variant="primary" icon="search" disabled={!hex || !selected.length || busy} onClick={() => run(switches.filter((d) => selected.includes(d.id)))}>
          {busy ? 'Поиск…' : 'Искать'}
        </Button>
        <div className="small muted" style={{ marginTop: 8 }}>
          Выполняются только команды просмотра из профиля платформы (или полная таблица MAC с фильтрацией на компьютере). Команды видны в терминалах сессий.
        </div>
      </div>
      <div>
        {!hops.length && <Empty icon="search" title="Результаты поиска появятся здесь">Если коммутаторы связаны через CDP/LLDP, будет предложен следующий коммутатор в цепочке.</Empty>}
        {hops.map((h, i) => (
          <div key={`${h.device.id}-${i}`} className={`check-card ${h.status === 'found' ? 'ok' : h.status === 'not-found' ? 'info' : h.status === 'error' ? 'crit' : 'info'}`}>
            <div className="row">
              <b className="grow">
                {i + 1}. {h.device.name}
              </b>
              <span className={`badge ${h.status === 'found' ? 'ok' : h.status === 'error' ? 'crit' : ''}`}>
                {{ searching: 'поиск…', found: 'MAC найден', 'not-found': 'не найден', error: 'ошибка' }[h.status]}
              </span>
            </div>
            {h.error && <div style={{ color: 'var(--crit)' }}>{h.error}</div>}
            {h.hits.map((x, j) => (
              <div key={j} style={{ margin: '4px 0' }}>
                VLAN: <b>{x.vlan ?? '?'}</b> · порт: <b>{x.port ?? '?'}</b>
                <div className="mono small muted">{x.line}</div>
              </div>
            ))}
            {h.status === 'found' && !h.hits.some((x) => x.port) && <div className="small" style={{ color: 'var(--warn)' }}>Порт не удалось определить автоматически — смотрите строку вывода.</div>}
            {h.neighbor && (
              <div style={{ marginTop: 4 }}>
                На порту виден сосед ({h.neighbor.source.toUpperCase()}): <b>{h.neighbor.name}</b> {h.neighbor.ip && <span className="mono">{h.neighbor.ip}</span>} {h.neighbor.remotePort && <span className="muted">порт {h.neighbor.remotePort}</span>}
                <div className="small muted">Это предположительный следующий узел цепочки — подтвердите поиском на нём.</div>
                {h.next ? (
                  <Button size="sm" icon="route" style={{ marginTop: 6 }} disabled={busy || hops.some((x) => x.device.id === h.next!.id)} onClick={() => run([h.next!], true)}>
                    Проверить на «{h.next.name}»
                  </Button>
                ) : (
                  <div className="small" style={{ color: 'var(--warn)' }}>Соседнее устройство не найдено среди сохранённых — добавьте его, чтобы продолжить трассировку.</div>
                )}
              </div>
            )}
            {h.status === 'found' && !h.neighbor && h.hits.some((x) => x.port) && (
              <div className="small muted" style={{ marginTop: 4 }}>
                Соседний коммутатор на этом порту по данным CDP/LLDP не обнаружен — вероятно, это порт доступа (конечный порт). {!NEIGHBOR_COMMANDS[h.device.platform] && 'Для этой платформы команды CDP/LLDP в профиле нет.'}
              </div>
            )}
            {h.status === 'not-found' && <div className="small muted">Проверено: {h.commands.map((c) => c.command).join('; ') || 'нет подходящих команд в профиле платформы'}</div>}
            {h.commands.length > 0 && (
              <details>
                <summary>Проверенные таблицы ({h.commands.length})</summary>
                {h.commands.map((c, j) => (
                  <div key={j}>
                    <div className="mono small">$ {c.command}</div>
                    <pre className="output">{c.output || '(пусто)'}</pre>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Профили ----------

function ProfilesEditor() {
  const app = useApp();
  const [platform, setPlatform] = useState('cisco-ios');
  const switchPlatforms = PLATFORMS.filter((p) => p.kind === 'switch');
  return (
    <>
      <Banner>
        Для каждой платформы — свои команды. Встроенные профили составлены в первую очередь из ваших команд (TXT) и документированного синтаксиса Cisco. Отредактируйте профиль, если на вашей модели команда другая.
      </Banner>
      <Field label="Платформа">
        <select className="select" style={{ maxWidth: 360 }} value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {switchPlatforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {tasksFor(platform, () => true).map((t) => (
        <ProfileRow key={`${platform}:${t.id}`} platform={platform} taskId={t.id} title={t.title} onSaved={() => void app.refresh('profiles')} />
      ))}
    </>
  );
}

function ProfileRow({ platform, taskId, title, onSaved }: { platform: string; taskId: string; title: string; onSaved: () => void }) {
  const app = useApp();
  const p = app.profiles.find((x) => x.platform === platform && x.task === taskId);
  const [text, setText] = useState((p?.steps ?? []).map((s) => s.command).join('\n'));
  useEffect(() => setText((p?.steps ?? []).map((s) => s.command).join('\n')), [p]);
  const dirty = text !== (p?.steps ?? []).map((s) => s.command).join('\n');
  const save = async () => {
    const steps = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((command) => ({ command, ...(p?.steps.find((s) => s.command === command) ?? {}) }));
    const risky = steps.filter((s) => classifyCommand(s.command, 'switch', platform).level !== 'info');
    if (risky.length && !(await app.confirm({ title: 'Изменяющие команды в профиле', text: `Профили диагностики должны содержать только команды просмотра. Найдено: ${risky.map((r) => r.command).join('; ')}`, okText: 'Сохранить всё равно', danger: true }))) return;
    await api.profiles.save({ platform, task: taskId, steps });
    onSaved();
    app.toast('Профиль сохранён', 'ok');
  };
  return (
    <div className="step">
      <div className="row" style={{ marginBottom: 6 }}>
        <b className="grow">{title}</b>
        {p?.userModified && <span className="badge accent">изменён вами</span>}
        {p?.steps.some((s) => s.fromUserTxt) && <span className="badge outline">из TXT-заметок</span>}
        {p?.steps.some((s) => s.unverified) && <span className="badge warn">не подтверждено</span>}
        {!p && <span className="badge outline">нет команд</span>}
      </div>
      <textarea className="textarea mono" rows={Math.max(1, text.split('\n').length)} value={text} onChange={(e) => setText(e.target.value)} placeholder="Команды просмотра, по одной в строке; параметры {{INTERFACE}}, {{MAC}}, {{VLAN}}, {{IP}}" spellCheck={false} />
      <div className="btn-row" style={{ marginTop: 6 }}>
        <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>
          Сохранить
        </Button>
        {p?.userModified && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await api.profiles.reset(platform, taskId);
              onSaved();
            }}
          >
            Вернуть встроенный
          </Button>
        )}
      </div>
    </div>
  );
}

function Reports() {
  const [list, setList] = useState<DiagnosticResult[]>([]);
  const [sel, setSel] = useState<DiagnosticResult | null>(null);
  useEffect(() => {
    void api.diagnostics.list().then(setList);
  }, []);
  const prev = useMemo(() => (sel ? list.find((x) => x.id !== sel.id && x.deviceId === sel.deviceId && x.task === sel.task && x.ts < sel.ts) ?? null : null), [sel, list]);
  return (
    <div className="grid-2" style={{ gap: 16, alignItems: 'start', gridTemplateColumns: '380px 1fr' }}>
      <div className="card" style={{ padding: 0 }}>
        {!list.length && <Empty icon="activity" title="Отчётов пока нет" />}
        {list.map((r) => (
          <div key={r.id} className={`list-item ${sel?.id === r.id ? 'active' : ''}`} onClick={() => setSel(r)}>
            <div className="title">
              <span className="t">{r.report.title}</span>
            </div>
            <div className="small muted">
              {r.deviceName} · {fmtDate(r.ts)}
            </div>
            <div className="meta">
              {r.report.checks.some((c) => c.status === 'crit') && <span className="badge crit">проблемы</span>}
              {r.report.checks.some((c) => c.status === 'warn') && <span className="badge warn">внимание</span>}
            </div>
          </div>
        ))}
      </div>
      <div>{sel ? <ReportView report={sel.report} prev={prev} /> : <Empty icon="activity" title="Выберите отчёт" />}</div>
    </div>
  );
}
