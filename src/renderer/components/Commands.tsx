// Карточка команды справочника и редактор записи.
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useApp, errMsg, type ExecSpec } from '../lib/store';
import { Banner, Button, Check, CodeWithParams, Field, FlagBadges, Modal, RiskBadge, SourceBadge } from './ui';
import { Icon } from '../lib/icons';
import type { CommandInput, CommandRecord, RiskLevel } from '../../shared/types';
import { categoriesFor, categoryName } from '../../shared/categories';
import { PLATFORMS, getPlatform } from '../../shared/platforms';
import { RISK_LABELS, RISK_ORDER, classifyCommand } from '../../shared/risk';
import { suggestTemplate, hasParams } from '../../shared/templates';
import { fmtDate, sourceLabel } from '../lib/format';

export function execSpecFor(c: CommandRecord, command?: string, sessionKey?: string): ExecSpec {
  const cmd = command ?? c.command;
  return {
    title: c.title,
    command: cmd,
    template: command ? null : c.template,
    kind: c.kind,
    platform: c.platform,
    risk: command ? classifyCommand(command, c.kind, c.platform).level : c.risk,
    source: 'reference',
    commandUid: c.uid,
    sessionKey
  };
}

function manLink(docs?: string): string | null {
  const m = /^man\s+(\d)\s+(\S+)$/.exec(docs ?? '');
  if (m) return `https://manpages.debian.org/${m[2]}.${m[1]}`;
  if (/^https?:\/\//.test(docs ?? '')) return docs!;
  return null;
}

export function CommandCard({ c, compact, sessionKey }: { c: CommandRecord; compact?: boolean; sessionKey?: string }) {
  const app = useApp();
  const [showRaw, setShowRaw] = useState(false);
  const lines = c.command.split('\n');
  const notes = new Map((c.details.lineNotes ?? []).map((n) => [n.index, n]));
  const d = c.details;
  const exec = (cmd?: string) => app.execute(execSpecFor(c, cmd, sessionKey));
  const toggleFav = async () => {
    await api.commands.setFlags(c.id, { favorite: !c.favorite });
    await app.refresh('commands');
  };
  const toggleVerified = async () => {
    await api.commands.setFlags(c.id, { verified: !c.verified });
    await app.refresh('commands');
  };
  const edit = () => app.openDialog((close) => <CommandEditor initial={c} onClose={close} />);
  const makeTemplate = () =>
    app.openDialog((close) => <CommandEditor initial={{ ...c, template: c.template || suggestTemplate(c.command, c.kind) || c.command }} focusTemplate onClose={close} />);
  const remove = async () => {
    const ok = await app.confirm({
      title: 'Удалить запись?',
      text: c.source === 'user' ? 'Запись будет удалена.' : 'Запись будет скрыта из справочника. Восстановить её можно в «Настройки → База данных».',
      okText: 'Удалить',
      danger: true
    });
    if (!ok) return;
    await api.commands.remove(c.id);
    await app.refresh('commands');
  };
  const doc = manLink(d.docs);

  return (
    <div className={compact ? '' : 'detail'} style={compact ? { padding: '12px 14px' } : undefined}>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        <RiskBadge risk={c.risk} />
        <span className="badge accent">{c.vendorLabel || getPlatform(c.platform).name}</span>
        <span className="badge outline">{categoryName(c.kind, c.category)}</span>
        {c.entryType === 'sequence' && <span className="badge outline">Последовательность</span>}
        {c.entryType === 'note' && <span className="badge outline">Заметка</span>}
        <FlagBadges c={c} />
      </div>
      <h2>{c.title}</h2>
      <div className="row wrap small muted" style={{ gap: 6 }}>
        <SourceBadge c={c} />
        {c.originLine && <span>строка {c.originLine}</span>}
        {c.userModified && <span className="badge outline">изменено вами</span>}
      </div>

      {c.entryType !== 'note' && (
        <div className="detail-section">
          <div className="row" style={{ marginBottom: 6 }}>
            <div className="label grow" style={{ margin: 0 }}>
              {lines.length > 1 ? `Команды (${lines.length})` : 'Команда'}
            </div>
            <Button size="sm" icon="copy" onClick={() => app.copy(c.command)}>
              Копировать
            </Button>
            <Button size="sm" variant="primary" icon="play" onClick={() => exec()}>
              Выполнить на устройстве
            </Button>
          </div>
          <div className="cmd-block">
            {lines.map((l, i) => {
              const n = notes.get(i);
              return (
                <div className="cmd-line" key={i}>
                  <div className="code">
                    {n?.prompt && <span className="prompt">{n.prompt} </span>}
                    {l}
                    {n?.note && <span className="note">{n.note}</span>}
                  </div>
                  {lines.length > 1 && (
                    <div className="actions">
                      <Button size="sm" variant="ghost" iconOnly icon="copy" title="Копировать строку" onClick={() => app.copy(l)} />
                      <Button size="sm" variant="ghost" iconOnly icon="play" title="Выполнить только эту строку" onClick={() => exec(l)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {c.mode === 'config' && <div className="small faint" style={{ marginTop: 4 }}>Требуется режим конфигурации (в исходной записи указано приглашение (config)).</div>}
        </div>
      )}

      {c.template && c.template !== c.command && (
        <div className="detail-section">
          <div className="row" style={{ marginBottom: 6 }}>
            <div className="label grow" style={{ margin: 0 }}>
              Шаблон
            </div>
            <Button size="sm" icon="template" onClick={() => app.execute({ ...execSpecFor(c, undefined, sessionKey) })}>
              Заполнить и выполнить
            </Button>
          </div>
          <div className="cmd-block">
            <div className="cmd-line">
              <div className="code">
                <CodeWithParams text={c.template} />
              </div>
            </div>
          </div>
        </div>
      )}

      {(c.description || c.entryType === 'note') && (
        <div className="detail-section">
          <div className="label">Описание</div>
          {c.sensitive && !app.settings.showSensitive ? (
            <Banner kind="crit" icon="lock">
              Запись содержит учётные данные ({c.reviewNote ?? 'пароли'}). Текст скрыт. Показ можно включить в настройках безопасности.
            </Banner>
          ) : (
            <div className="desc">{c.description}</div>
          )}
        </div>
      )}

      {d.assumption && <Banner kind="warn">{d.assumption}</Banner>}
      {c.needsReview && c.reviewNote && (
        <Banner kind="warn">
          <b>Требует проверки:</b> {c.reviewNote}
        </Banner>
      )}

      {d.syntax && (
        <div className="detail-section">
          <div className="label">Синтаксис</div>
          <code>{d.syntax}</code>
        </div>
      )}

      {d.params && d.params.length > 0 && (
        <div className="detail-section">
          <div className="label">Параметры</div>
          <dl className="kv">
            {d.params.map((p) => (
              <FragmentKV key={p.name} k={<code>{p.name}</code>} v={p.desc} />
            ))}
          </dl>
        </div>
      )}

      {d.examples && d.examples.length > 0 && (
        <div className="detail-section">
          <div className="label">Примеры</div>
          <div className="cmd-block">
            {d.examples.map((e, i) => (
              <div className="cmd-line" key={i}>
                <div className="code">
                  {e.cmd}
                  <span className="note">{e.desc}</span>
                </div>
                <div className="actions">
                  <Button size="sm" variant="ghost" iconOnly icon="copy" title="Копировать" onClick={() => app.copy(e.cmd)} />
                  <Button size="sm" variant="ghost" iconOnly icon="play" title="Выполнить на устройстве" onClick={() => exec(e.cmd)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {d.exampleOutput && (
        <div className="detail-section">
          <div className="label">Пример вывода (из исходного файла)</div>
          <pre className="output">{d.exampleOutput}</pre>
        </div>
      )}

      {d.output && (
        <div className="detail-section">
          <div className="label">Как читать результат</div>
          <div className="desc">{d.output}</div>
        </div>
      )}

      {d.warnings && d.warnings.length > 0 && (
        <div className="detail-section">
          {d.warnings.map((w, i) => (
            <Banner key={i} kind="danger">
              {w}
            </Banner>
          ))}
        </div>
      )}

      {(d.privileges || d.package !== undefined || d.compat || d.verify || d.related || d.docs || d.versionNotes) && c.kind !== 'switch' && (
        <div className="detail-section">
          <div className="label">Сведения</div>
          <dl className="kv">
            {d.privileges && <FragmentKV k="Права" v={d.privileges} />}
            <FragmentKV k="Установка" v={d.package ? <>требуется пакет <code>{d.package}</code></> : 'входит в базовую систему'} />
            {d.compat && <FragmentKV k="Совместимость" v={d.compat} />}
            {d.versionNotes && <FragmentKV k={c.kind === 'sql' ? 'Отличия СУБД и версий' : 'Версии'} v={d.versionNotes} />}
            {d.verify && <FragmentKV k="Проверка результата" v={<code>{d.verify}</code>} />}
            {d.related && <FragmentKV k="Связанные команды" v={d.related.map((r) => <code key={r} style={{ marginRight: 8 }}>{r}</code>)} />}
            {d.docs && (
              <FragmentKV
                k="Документация"
                v={
                  doc ? (
                    <a href="#" onClick={(e) => (e.preventDefault(), void api.app.openExternal(doc))}>
                      {d.docs}
                    </a>
                  ) : (
                    d.docs
                  )
                }
              />
            )}
          </dl>
        </div>
      )}

      {c.rawText && (
        <div className="detail-section">
          <button className="btn ghost sm" onClick={() => setShowRaw(!showRaw)}>
            <Icon name={showRaw ? 'chevronDown' : 'chevronRight'} size={14} /> Исходный текст ({c.originFile ?? sourceLabel(c)})
          </button>
          {showRaw && (c.sensitive && !app.settings.showSensitive ? <Banner kind="crit">Скрыто: чувствительные данные.</Banner> : <pre className="output" style={{ marginTop: 6 }}>{c.rawText}</pre>)}
        </div>
      )}

      <div className="detail-section">
        <div className="btn-row">
          <Button icon="star" onClick={toggleFav} variant={c.favorite ? 'primary' : 'default'}>
            {c.favorite ? 'В избранном' : 'В избранное'}
          </Button>
          <Button icon="edit" onClick={edit}>
            Редактировать
          </Button>
          <Button icon="template" onClick={makeTemplate}>
            {c.template ? 'Изменить шаблон' : 'Создать шаблон'}
          </Button>
          <Button icon="check" onClick={toggleVerified}>
            {c.verified ? 'Снять «Проверено»' : 'Отметить «Проверено мной»'}
          </Button>
          <Button icon="trash" variant="ghost" onClick={remove}>
            Удалить
          </Button>
        </div>
        <div className="small faint" style={{ marginTop: 8 }}>
          Обновлено: {fmtDate(c.updatedAt)}
        </div>
      </div>
    </div>
  );
}

function FragmentKV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

export function emptyCommand(kind: 'switch' | 'linux' | 'sql', platform?: string): CommandInput {
  const p = platform ?? (kind === 'linux' ? 'linux' : kind === 'sql' ? 'mysql' : 'cisco-ios');
  return {
    uid: '',
    kind,
    entryType: 'command',
    platform: p,
    vendorLabel: getPlatform(p).name,
    category: kind === 'linux' ? 'sysinfo' : kind === 'sql' ? 'sql-basics' : 'general',
    title: '',
    command: '',
    description: '',
    details: {},
    template: null,
    risk: 'info',
    riskManual: false,
    mode: kind === 'linux' ? 'shell' : kind === 'sql' ? 'any' : 'exec',
    source: 'user',
    verified: false,
    needsReview: false,
    vendorUnknown: false,
    sensitive: false,
    favorite: false,
    userModified: false,
    tags: []
  };
}

export function CommandEditor({ initial, onClose, focusTemplate }: { initial: CommandInput | CommandRecord; onClose: () => void; focusTemplate?: boolean }) {
  const app = useApp();
  const [c, setC] = useState<CommandInput>({ ...initial });
  const [tags, setTags] = useState((initial.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const auto = useMemo(() => classifyCommand(c.command, c.kind, c.platform), [c.command, c.kind, c.platform]);
  const cats = categoriesFor(c.kind);
  const platforms = c.kind === 'linux' ? PLATFORMS.filter((p) => p.kind === 'linux') : c.kind === 'sql' ? PLATFORMS.filter((p) => p.kind === 'db') : PLATFORMS.filter((p) => p.kind === 'switch' || p.kind === 'other');
  const set = <K extends keyof CommandInput>(k: K, v: CommandInput[K]) => setC((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!c.title.trim() && !c.command.trim()) return app.toast('Укажите название или команду', 'warn');
    setBusy(true);
    try {
      const risk: RiskLevel = c.riskManual ? c.risk : auto.level;
      const saved = await api.commands.save({
        ...c,
        title: c.title.trim() || c.command.split('\n')[0],
        risk,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        template: c.template?.trim() ? c.template : null,
        vendorLabel: c.source === 'user' ? getPlatform(c.platform).name : c.vendorLabel
      });
      await app.refresh('commands');
      app.openCommand(saved.id);
      app.toast('Запись сохранена', 'ok');
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const isNew = !('id' in initial) || !initial.id;
  return (
    <Modal
      title={isNew ? 'Новая команда' : 'Редактирование записи'}
      onClose={onClose}
      width="wide"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon="check" onClick={save} disabled={busy}>
            Сохранить
          </Button>
        </>
      }
    >
      {!isNew && c.source !== 'user' && (
        <Banner kind="info">
          Запись из источника «{sourceLabel(c)}». Изменения будут сохранены как ваши и не перезапишутся при обновлении справочника. Исходный текст сохраняется отдельно.
        </Banner>
      )}
      <div className="grid-3">
        <Field label="Тип">
          <select className="select" value={c.kind} onChange={(e) => setC({ ...emptyCommand(e.target.value as 'switch' | 'linux' | 'sql'), ...{ title: c.title, command: c.command, description: c.description, tags: c.tags } })} disabled={!isNew}>
            <option value="switch">Коммутаторы</option>
            <option value="linux">Linux</option>
            <option value="sql">Базы данных (SQL)</option>
          </select>
        </Field>
        <Field label="Платформа / производитель">
          <select className="select" value={c.platform} onChange={(e) => set('platform', e.target.value)}>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {!platforms.some((p) => p.id === c.platform) && <option value={c.platform}>{c.vendorLabel || c.platform}</option>}
          </select>
        </Field>
        <Field label="Категория">
          <select className="select" value={c.category} onChange={(e) => set('category', e.target.value)}>
            {cats.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Название">
        <input className="input" value={c.title} onChange={(e) => set('title', e.target.value)} placeholder="Например: Найти устройство по MAC" />
      </Field>
      <Field label="Команда (можно несколько строк)" hint={`Автоматическая оценка риска: ${RISK_LABELS[auto.level]}${auto.reasons.length ? ` — ${auto.reasons.join('; ')}` : ''}`}>
        <textarea className="textarea mono" rows={4} value={c.command} onChange={(e) => set('command', e.target.value)} spellCheck={false} autoFocus={!focusTemplate} />
      </Field>
      <Field
        label={
          <span className="row">
            <span className="grow">Шаблон с параметрами {'{{IP}} {{MAC}} {{VLAN}} {{INTERFACE}}'}…</span>
            <Button size="sm" variant="ghost" icon="zap" onClick={() => set('template', suggestTemplate(c.command, c.kind) ?? c.command)}>
              Предложить
            </Button>
          </span>
        }
        hint={c.template && !hasParams(c.template) ? 'В шаблоне нет параметров вида {{ИМЯ}}' : 'Исходная команда сохраняется отдельно. Свои параметры: {{ЛЮБОЕ_ИМЯ}} или {{ИМЯ:значение по умолчанию}}.'}
      >
        <textarea className="textarea mono" rows={3} value={c.template ?? ''} onChange={(e) => set('template', e.target.value)} spellCheck={false} autoFocus={focusTemplate} />
      </Field>
      <Field label="Описание">
        <textarea className="textarea" rows={3} value={c.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="grid-3">
        <Field label="Уровень риска">
          <select
            className="select"
            value={c.riskManual ? c.risk : 'auto'}
            onChange={(e) => (e.target.value === 'auto' ? setC({ ...c, riskManual: false, risk: auto.level }) : setC({ ...c, riskManual: true, risk: e.target.value as RiskLevel }))}
          >
            <option value="auto">Автоматически ({RISK_LABELS[auto.level]})</option>
            {RISK_ORDER.map((r) => (
              <option key={r} value={r}>
                {RISK_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Режим">
          <select className="select" value={c.mode} onChange={(e) => set('mode', e.target.value as CommandInput['mode'])}>
            <option value="exec">Просмотр (exec)</option>
            <option value="config">Конфигурация (config)</option>
            <option value="shell">Оболочка Linux</option>
            <option value="any">Любой</option>
          </select>
        </Field>
        <Field label="Теги (через запятую)">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>
      <div className="row wrap" style={{ gap: 18 }}>
        <Check checked={c.verified} onChange={(v) => set('verified', v)} label="Проверено мной" />
        <Check checked={c.needsReview} onChange={(v) => set('needsReview', v)} label="Требует проверки" />
        <Check checked={c.sensitive} onChange={(v) => set('sensitive', v)} label="Чувствительные данные" />
      </div>
    </Modal>
  );
}
