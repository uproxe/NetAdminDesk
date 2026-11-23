// Сценарии: список, редактор (сборка из команд справочника), выполнение по шагам или автоматически.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, errMsg } from '../lib/store';
import { Banner, Button, Check, CodeWithParams, Empty, Field, Modal, RiskBadge, useDebounced } from '../components/ui';
import { TemplateFill } from '../components/ExecuteDialog';
import { PLATFORMS, checkCompat, getPlatform } from '../../shared/platforms';
import { classifyCommand, isChanging, maxRisk, riskAtLeast } from '../../shared/risk';
import { renderTemplate } from '../../shared/templates';
import { plural } from '../lib/format';
import type { CommandRecord, RiskLevel, Scenario, ScenarioInput, ScenarioStep } from '../../shared/types';

export function ScenariosView({ openId, onOpened }: { openId: number | null; onOpened: () => void }) {
  const app = useApp();
  const [sel, setSel] = useState<number | null>(openId ?? app.scenarios[0]?.id ?? null);
  const [mode, setMode] = useState<'view' | 'edit' | 'run'>('view');
  const [draft, setDraft] = useState<ScenarioInput | null>(null);
  useEffect(() => {
    if (openId) {
      setSel(openId);
      setMode('view');
      onOpened();
    }
  }, [openId, onOpened]);
  const s = app.scenarios.find((x) => x.id === sel) ?? null;
  // Поиск и фильтр по платформе: встроенных сценариев больше сотни
  const [q, setQ] = useState('');
  const [plat, setPlat] = useState('');
  const dq = useDebounced(q, 80);
  const platformsInUse = useMemo(() => [...new Set(app.scenarios.flatMap((x) => x.platforms))], [app.scenarios]);
  const visible = useMemo(() => {
    const byPlat = (x: Scenario) => !plat || x.platforms.includes(plat);
    if (!dq.trim()) return app.scenarios.filter(byPlat);
    return app.index
      .search(dq, { groups: ['scenario'] }, 300)
      .map((h) => h.doc.ref)
      .filter((r): r is { type: 'scenario'; item: Scenario } => r.type === 'scenario')
      .map((r) => app.scenarios.find((x) => x.id === r.item.id) ?? r.item)
      .filter(byPlat);
  }, [dq, plat, app.scenarios, app.index]);
  const startNew = () => {
    setDraft({ uid: '', name: 'Новый сценарий', description: '', platforms: [], steps: [], builtin: false, favorite: false });
    setMode('edit');
  };
  return (
    <div className="columns">
      <div className="col col-list" style={{ maxWidth: 380 }}>
        <div className="col-header">
          <input className="input" placeholder="Поиск: порт, vlan, poe, диск, nginx…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="primary" icon="plus" onClick={startNew} title="Создать свой сценарий">
            Создать
          </Button>
        </div>
        <div className="row" style={{ padding: '6px 14px', gap: 8, borderBottom: '1px solid var(--border)' }}>
          <select className="select" style={{ height: 26, fontSize: 12.5 }} value={plat} onChange={(e) => setPlat(e.target.value)}>
            <option value="">Все платформы</option>
            {platformsInUse.map((p) => (
              <option key={p} value={p}>
                {getPlatform(p).name}
              </option>
            ))}
          </select>
          <span className="small faint" style={{ whiteSpace: 'nowrap' }}>
            {visible.length} из {app.scenarios.length}
          </span>
        </div>
        <div className="col-body">
          {!visible.length && <div className="small muted" style={{ padding: 14 }}>Ничего не найдено.</div>}
          {visible.map((x) => (
            <div key={x.id} className={`list-item ${x.id === sel && mode !== 'edit' ? 'active' : ''}`} onClick={() => (setSel(x.id), setMode('view'))}>
              <div className="title">
                <span className="t">{x.name}</span>
                {x.builtin && <span className="badge outline">встроенный</span>}
              </div>
              <div className="small muted ellipsis">
                {x.steps.length} {plural(x.steps.length, 'шаг', 'шага', 'шагов')} · {x.platforms.map((p) => getPlatform(p).name).join(', ') || 'любая платформа'}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col grow" style={{ overflowY: 'auto' }}>
        {mode === 'edit' && draft ? (
          <ScenarioEditor
            draft={draft}
            onCancel={() => setMode('view')}
            onSaved={(id) => {
              setSel(id);
              setMode('view');
            }}
          />
        ) : mode === 'run' && s ? (
          <ScenarioRunner s={s} onClose={() => setMode('view')} />
        ) : s ? (
          <div className="detail">
            <div className="row">
              <h2 className="grow">{s.name}</h2>
              <Button variant="primary" icon="play" onClick={() => setMode('run')}>
                Выполнить
              </Button>
              <Button icon="edit" onClick={() => (setDraft({ ...s }), setMode('edit'))}>
                Изменить
              </Button>
              <Button
                icon="copy"
                onClick={() => {
                  setDraft({ ...s, id: undefined, uid: '', name: `${s.name} (копия)`, builtin: false });
                  setMode('edit');
                }}
              >
                Копия
              </Button>
              <Button
                variant="ghost"
                icon="star"
                style={{ color: s.favorite ? 'var(--warn)' : undefined }}
                onClick={async () => {
                  await api.scenarios.setFavorite(s.id, !s.favorite);
                  await app.refresh('scenarios');
                }}
              />
              <Button
                variant="ghost"
                icon="trash"
                onClick={async () => {
                  if (!(await app.confirm({ title: 'Удалить сценарий?', text: s.name, okText: 'Удалить', danger: true }))) return;
                  await api.scenarios.remove(s.id);
                  await app.refresh('scenarios');
                  setSel(null);
                }}
              />
            </div>
            <p className="muted">{s.description}</p>
            <div className="row wrap small" style={{ gap: 6, marginBottom: 12 }}>
              Совместимые платформы:
              {s.platforms.length ? s.platforms.map((p) => <span key={p} className="badge accent">{getPlatform(p).name}</span>) : <span className="badge outline">любая</span>}
            </div>
            {s.steps.map((st, i) => (
              <div key={st.id} className="step">
                <div className="row">
                  <b className="grow">
                    {i + 1}. {st.title}
                  </b>
                  <RiskBadge risk={st.risk ?? 'info'} />
                  <Button size="sm" variant="ghost" iconOnly icon="copy" title="Копировать шаг" onClick={() => app.copy(st.command)} />
                </div>
                <pre className="mono" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
                  <CodeWithParams text={st.command} />
                </pre>
                {st.note && <div className="small muted">{st.note}</div>}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="list" title="Выберите или создайте сценарий" />
        )}
      </div>
    </div>
  );
}

let stepSeq = 1;
const newStepId = () => `u${Date.now().toString(36)}${stepSeq++}`;

function ScenarioEditor({ draft, onCancel, onSaved }: { draft: ScenarioInput; onCancel: () => void; onSaved: (id: number) => void }) {
  const app = useApp();
  const [s, setS] = useState<ScenarioInput>(draft);
  const kind: 'switch' | 'linux' = s.platforms.includes('linux') ? 'linux' : 'switch';
  const setStep = (i: number, patch: Partial<ScenarioStep>) =>
    setS((x) => ({ ...x, steps: x.steps.map((st, j) => (j === i ? { ...st, ...patch, risk: patch.command !== undefined ? classifyCommand(patch.command, kind, x.platforms[0]).level : st.risk } : st)) }));
  const move = (i: number, d: number) =>
    setS((x) => {
      const steps = [...x.steps];
      const [it] = steps.splice(i, 1);
      steps.splice(Math.max(0, Math.min(steps.length, i + d)), 0, it);
      return { ...x, steps };
    });
  const addFromRef = () =>
    app.openDialog((close) => (
      <PickCommand
        kind={kind}
        platforms={s.platforms}
        onClose={close}
        onPick={(c) => {
          setS((x) => ({ ...x, steps: [...x.steps, { id: newStepId(), title: c.title, command: c.template || c.command, note: c.description.split('\n')[0]?.slice(0, 200), risk: c.risk, commandUid: c.uid, platform: c.platform }] }));
          close();
        }}
      />
    ));
  const save = async () => {
    try {
      const saved = await api.scenarios.save({ ...s, builtin: false });
      await app.refresh('scenarios');
      app.toast('Сценарий сохранён', 'ok');
      onSaved(saved.id);
    } catch (e) {
      app.toast(errMsg(e), 'error');
    }
  };
  return (
    <div className="detail">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 className="grow">{draft.id ? 'Редактирование сценария' : 'Новый сценарий'}</h2>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="primary" icon="check" onClick={save}>
          Сохранить
        </Button>
      </div>
      {draft.builtin && <Banner>Изменённый встроенный сценарий сохраняется как ваш и не перезаписывается обновлениями.</Banner>}
      <Field label="Название">
        <input className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
      </Field>
      <Field label="Описание">
        <textarea className="textarea" rows={2} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} />
      </Field>
      <Field label="Совместимые платформы" hint="Сценарий можно запустить только в сессиях этих платформ (или с явным подтверждением).">
        <div className="row wrap" style={{ gap: 10 }}>
          {PLATFORMS.map((p) => (
            <Check key={p.id} checked={s.platforms.includes(p.id)} onChange={(v) => setS({ ...s, platforms: v ? [...s.platforms, p.id] : s.platforms.filter((x) => x !== p.id) })} label={p.name} />
          ))}
        </div>
      </Field>
      <div className="section-title">Шаги</div>
      {s.steps.map((st, i) => (
        <div key={st.id} className="step">
          <div className="row" style={{ marginBottom: 6 }}>
            <b>{i + 1}.</b>
            <input className="input" value={st.title} onChange={(e) => setStep(i, { title: e.target.value })} placeholder="Название шага" />
            <RiskBadge risk={st.risk ?? 'info'} />
            <Button size="sm" variant="ghost" iconOnly icon="chevronDown" style={{ transform: 'rotate(180deg)' }} title="Выше" onClick={() => move(i, -1)} />
            <Button size="sm" variant="ghost" iconOnly icon="chevronDown" title="Ниже" onClick={() => move(i, 1)} />
            <Button size="sm" variant="ghost" iconOnly icon="trash" title="Удалить шаг" onClick={() => setS({ ...s, steps: s.steps.filter((_, j) => j !== i) })} />
          </div>
          <textarea className="textarea mono" rows={Math.max(1, st.command.split('\n').length)} value={st.command} onChange={(e) => setStep(i, { command: e.target.value })} placeholder="Команда; параметры {{INTERFACE}}, {{VLAN}}…" spellCheck={false} />
          <input className="input" style={{ marginTop: 6 }} value={st.note ?? ''} onChange={(e) => setStep(i, { note: e.target.value })} placeholder="Пояснение (необязательно)" />
        </div>
      ))}
      <div className="btn-row">
        <Button icon="plus" onClick={() => setS({ ...s, steps: [...s.steps, { id: newStepId(), title: `Шаг ${s.steps.length + 1}`, command: '', risk: 'info' }] })}>
          Добавить шаг
        </Button>
        <Button icon="book" onClick={addFromRef}>
          Добавить из справочника
        </Button>
      </div>
    </div>
  );
}

function PickCommand({ kind, platforms, onPick, onClose }: { kind: 'switch' | 'linux'; platforms: string[]; onPick: (c: CommandRecord) => void; onClose: () => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 80);
  const items = useMemo(
    () =>
      app.index
        .search(dq, { groups: kind === 'linux' ? ['linux', 'sql'] : [kind] }, 200)
        .map((h) => (h.doc.ref as { item: CommandRecord }).item)
        .filter((c) => c.kind === 'sql' || !platforms.length || platforms.includes(c.platform) || c.platform === 'unknown-ios'),
    [app.index, dq, kind, platforms]
  );
  return (
    <Modal title="Команда из справочника" width="wide" onClose={onClose}>
      <input className="input" autoFocus placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 8 }}>
        {items.map((c) => (
          <div key={c.id} className="list-item" onClick={() => onPick(c)}>
            <div className="title">
              <span className="t">{c.title}</span>
            </div>
            <div className="cmd">{(c.template || c.command).split('\n')[0]}</div>
            <div className="meta">
              <RiskBadge risk={c.risk} />
              <span className="badge outline">{c.vendorLabel}</span>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

type StepState = { status: 'pending' | 'running' | 'done' | 'skipped' | 'error'; output?: string };

function ScenarioRunner({ s, onClose }: { s: Scenario; onClose: () => void }) {
  const app = useApp();
  const ready = app.sessions.filter((x) => !x.pending && x.status === 'ready');
  const [targets, setTargets] = useState<string[]>(() => {
    const act = ready.find((x) => x.key === app.activeSession);
    return act ? [act.key] : ready.length === 1 ? [ready[0].key] : [];
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [runMode, setRunMode] = useState<'step' | 'auto'>('step');
  const [confirmAll, setConfirmAll] = useState(false);
  const [compatOk, setCompatOk] = useState(false);
  const [states, setStates] = useState<Record<string, StepState[]>>({});
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [stepConfirm, setStepConfirm] = useState(false);

  const allTpl = s.steps.map((st) => st.command).join('\n');
  const rendered = (cmd: string, platform: string) => renderTemplate(cmd, values, { platform, custom: app.templateParams });
  const check = rendered(allTpl, ready.find((x) => targets.includes(x.key))?.platform ?? s.platforms[0] ?? 'generic-ssh');
  const missing = check.missing.length > 0 || Object.keys(check.errors).length > 0;
  const scenarioRisk: RiskLevel = s.steps.reduce<RiskLevel>((r, st) => maxRisk(r, st.risk ?? 'info'), 'info');
  const massBlocked = targets.length > 1 && isChanging(scenarioRisk) && !app.settings.allowMassConfig;
  const compat = targets.map((k) => {
    const sess = ready.find((x) => x.key === k)!;
    const kind = sess.platform === 'linux' ? 'linux' : 'switch';
    const best = s.platforms.length ? s.platforms.map((p) => checkCompat(p, kind, sess.platform)).sort((a, b) => ['ok', 'maybe', 'mismatch'].indexOf(a.level) - ['ok', 'maybe', 'mismatch'].indexOf(b.level))[0] : { level: 'maybe' as const, message: 'У сценария не указаны платформы.' };
    return { sess, ...best };
  });
  const compatProblem = compat.some((c) => c.level !== 'ok');
  const ro = app.settings.readOnlyMode;
  const canStart = targets.length > 0 && !missing && !massBlocked && (!compatProblem || compatOk);

  const runStep = async (i: number) => {
    const st = s.steps[i];
    for (const key of targets) {
      const sess = app.sessionByKey(key)!;
      const kind = sess.platform === 'linux' ? 'linux' : 'switch';
      const cmd = rendered(st.command, sess.platform).text;
      setStates((m) => ({ ...m, [key]: replaceAt(m[key] ?? s.steps.map(() => ({ status: 'pending' as const })), i, { status: 'running' }) }));
      try {
        let out = '';
        for (const line of cmd.split('\n').filter((l) => l.trim())) {
          const r = await api.ssh.capture(sess.id, line, { timeoutMs: 90000 }, { source: 'scenario', risk: classifyCommand(line, kind, sess.platform).level, note: `${s.name}: ${st.title}` });
          out += `${out ? '\n' : ''}${r.output}${r.timedOut ? '\n[превышено время ожидания]' : ''}`;
        }
        setStates((m) => ({ ...m, [key]: replaceAt(m[key], i, { status: 'done', output: out }) }));
      } catch (e) {
        setStates((m) => ({ ...m, [key]: replaceAt(m[key], i, { status: 'error', output: errMsg(e) }) }));
        throw e;
      }
      if (st.waitMs) await new Promise((r) => setTimeout(r, st.waitMs));
    }
  };

  const skip = (i: number) => {
    setStates((m) => Object.fromEntries(targets.map((k) => [k, replaceAt(m[k] ?? s.steps.map(() => ({ status: 'pending' as const })), i, { status: 'skipped' })])));
    setCursor(i + 1);
  };

  const runAuto = async () => {
    setRunning(true);
    try {
      for (let i = cursor; i < s.steps.length; i++) {
        const st = s.steps[i];
        if (riskAtLeast(st.risk ?? 'info', 'danger')) {
          setCursor(i);
          const ok = await app.confirm({
            title: 'Опасный шаг',
            text: (
              <>
                <p>
                  Шаг {i + 1} «{st.title}» помечен как опасный. Выполнить его на: <b>{targets.map((k) => app.sessionByKey(k)?.deviceName).join(', ')}</b>?
                </p>
                <pre className="output">{rendered(st.command, app.sessionByKey(targets[0])!.platform).text}</pre>
              </>
            ),
            okText: 'Выполнить шаг',
            danger: true
          });
          if (!ok) {
            skip(i);
            continue;
          }
        }
        setCursor(i);
        await runStep(i);
        setCursor(i + 1);
      }
      app.toast('Сценарий выполнен', 'ok');
    } catch (e) {
      app.toast(`Сценарий остановлен: ${errMsg(e)}`, 'error');
    } finally {
      setRunning(false);
    }
  };

  const started = Object.keys(states).length > 0;
  const firstKey = targets[0];

  return (
    <div className="detail">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 className="grow">Выполнение: {s.name}</h2>
        <Button onClick={onClose}>Закрыть</Button>
      </div>
      {!started && (
        <>
          <Field label="Где выполнить" hint="Команды отправляются в видимые терминалы выбранных сессий; вывод собирается здесь.">
            {!ready.length && <Banner kind="warn">Нет подключённых сессий. Сначала подключитесь к устройству.</Banner>}
            <div className="row wrap" style={{ gap: 12 }}>
              {ready.map((x) => (
                <Check key={x.key} checked={targets.includes(x.key)} onChange={(v) => setTargets(v ? [...targets, x.key] : targets.filter((k) => k !== x.key))} label={`${x.deviceName} (${getPlatform(x.platform).name})`} />
              ))}
            </div>
          </Field>
          {massBlocked && <Banner kind="crit">Массовое выполнение изменяющих команд на нескольких устройствах отключено (Настройки → Безопасность).</Banner>}
          {compat
            .filter((c) => c.level !== 'ok')
            .map((c) => (
              <Banner key={c.sess.key} kind={c.level === 'maybe' ? 'warn' : 'crit'}>
                {c.sess.deviceName}: {c.message}
              </Banner>
            ))}
          {compatProblem && targets.length > 0 && <Check checked={compatOk} onChange={setCompatOk} label="Я проверил совместимость команд с выбранными устройствами" />}
          <TemplateFill template={allTpl} values={values} onChange={setValues} custom={app.templateParams} platform={ready.find((x) => targets.includes(x.key))?.platform} />
          <Field label="Режим">
            <div className="row" style={{ gap: 16 }}>
              <Check checked={runMode === 'step'} onChange={() => setRunMode('step')} label="Пошаговый — после каждого шага ждать решения" />
              <Check checked={runMode === 'auto'} onChange={() => setRunMode('auto')} label="Автоматический — после проверки всех команд" />
            </div>
          </Field>
          {runMode === 'auto' && (
            <>
              <div className="section-title">Итоговые команды</div>
              {s.steps.map((st, i) => (
                <div key={st.id} className="step">
                  <div className="row">
                    <b className="grow">
                      {i + 1}. {st.title}
                    </b>
                    <RiskBadge risk={st.risk ?? 'info'} />
                  </div>
                  <pre className="mono" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                    {rendered(st.command, ready.find((x) => targets.includes(x.key))?.platform ?? 'generic-ssh').text}
                  </pre>
                </div>
              ))}
              {isChanging(scenarioRisk) && <Banner kind="warn">Сценарий содержит изменяющие шаги. Перед опасными шагами будет запрошено отдельное подтверждение.</Banner>}
              <Check checked={confirmAll} onChange={setConfirmAll} label="Я проверил итоговые команды и целевые устройства" />
            </>
          )}
          {ro && isChanging(scenarioRisk) && <Banner kind="warn">Режим «Только чтение»: изменяющие шаги будут заблокированы.</Banner>}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <Button
              variant="primary"
              icon="play"
              disabled={!canStart || (runMode === 'auto' && !confirmAll)}
              onClick={() => {
                setStates(Object.fromEntries(targets.map((k) => [k, s.steps.map(() => ({ status: 'pending' as const }))])));
                setCursor(0);
                if (runMode === 'auto') setTimeout(() => void runAuto(), 0);
              }}
            >
              Начать
            </Button>
          </div>
        </>
      )}
      {started && (
        <>
          <div className="small muted" style={{ marginBottom: 10 }}>
            Устройства: {targets.map((k) => app.sessionByKey(k)?.deviceName).join(', ')} · режим: {runMode === 'step' ? 'пошаговый' : 'автоматический'}
          </div>
          {s.steps.map((st, i) => {
            const stt = states[firstKey]?.[i];
            const cmd = rendered(st.command, app.sessionByKey(firstKey)?.platform ?? 'generic-ssh').text;
            const isCur = i === cursor && !running && runMode === 'step';
            return (
              <div key={st.id} className={`step ${i === cursor ? 'current' : ''} ${stt?.status === 'done' ? 'done' : ''} ${stt?.status === 'skipped' ? 'skipped' : ''}`}>
                <div className="row">
                  <b className="grow">
                    {i + 1}. {st.title}
                  </b>
                  <span className="small muted">{{ pending: 'ожидает', running: 'выполняется…', done: 'выполнен', skipped: 'пропущен', error: 'ошибка' }[stt?.status ?? 'pending']}</span>
                  <RiskBadge risk={st.risk ?? 'info'} />
                </div>
                <pre className="mono" style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>
                  {cmd}
                </pre>
                {st.note && <div className="small muted">{st.note}</div>}
                {isCur && (
                  <>
                    {isChanging(st.risk ?? 'info') && <Check checked={stepConfirm} onChange={setStepConfirm} label="Подтверждаю выполнение изменяющего шага" />}
                    <div className="btn-row" style={{ marginTop: 6 }}>
                      <Button
                        variant={isChanging(st.risk ?? 'info') ? 'danger' : 'primary'}
                        size="sm"
                        icon="play"
                        disabled={isChanging(st.risk ?? 'info') && !stepConfirm}
                        onClick={async () => {
                          setRunning(true);
                          try {
                            await runStep(i);
                            setCursor(i + 1);
                            setStepConfirm(false);
                          } catch (e) {
                            app.toast(errMsg(e), 'error');
                          } finally {
                            setRunning(false);
                          }
                        }}
                      >
                        Выполнить шаг
                      </Button>
                      <Button size="sm" onClick={() => skip(i)}>
                        Пропустить
                      </Button>
                      <Button size="sm" icon="copy" onClick={() => app.copy(cmd)}>
                        Копировать
                      </Button>
                    </div>
                  </>
                )}
                {targets.map((k) =>
                  states[k]?.[i]?.output ? (
                    <details key={k} open={targets.length === 1}>
                      <summary>Вывод: {app.sessionByKey(k)?.deviceName}</summary>
                      <pre className="output">{states[k][i].output}</pre>
                    </details>
                  ) : null
                )}
              </div>
            );
          })}
          {cursor >= s.steps.length && <Banner kind="ok">Сценарий завершён.</Banner>}
        </>
      )}
    </div>
  );
}

function replaceAt<T>(arr: T[], i: number, v: T): T[] {
  const a = [...arr];
  a[i] = v;
  return a;
}
