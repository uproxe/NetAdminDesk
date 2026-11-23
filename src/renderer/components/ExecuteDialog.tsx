// Выполнение команды из справочника: выбор устройства, проверка совместимости, шаблон, предпросмотр, подтверждение.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, errMsg, type ExecSpec } from '../lib/store';
import { Banner, Button, Check, Field, Modal, RiskBadge } from './ui';
import { checkCompat, getPlatform } from '../../shared/platforms';
import { classifyCommand, isChanging, RISK_LABELS } from '../../shared/risk';
import { parseTemplate, renderTemplate, hasParams, validateParam } from '../../shared/templates';
import { MAC_FORMAT_LABELS } from '../../shared/mac';
import type { TemplateParamDef } from '../../shared/types';

export function TemplateFill({
  template,
  values,
  onChange,
  custom,
  platform
}: {
  template: string;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  custom: TemplateParamDef[];
  platform?: string;
}) {
  const params = parseTemplate(template, custom);
  if (!params.length) return null;
  return (
    <div className="grid-2">
      {params.map((p) => {
        const v = values[p.name] ?? p.defaultValue ?? '';
        const err = v ? validateParam(p.def, v) : null;
        return (
          <Field
            key={p.name}
            label={
              <>
                {p.def.label} <span className="faint mono">{`{{${p.name}}}`}</span>
              </>
            }
            error={err}
            hint={p.def.type === 'mac' && platform ? `Будет приведён к формату ${MAC_FORMAT_LABELS[getPlatform(platform).macFormat]}` : p.def.description}
          >
            <input
              className={`input mono ${err ? 'invalid' : ''}`}
              type={p.name === 'PASSWORD' ? 'password' : 'text'}
              value={v}
              placeholder={p.def.type === 'ip' ? '192.168.1.1' : p.def.type === 'mac' ? '0011.2233.4455' : p.def.type === 'vlan' ? '10' : ''}
              onChange={(e) => onChange({ ...values, [p.name]: e.target.value })}
              spellCheck={false}
            />
          </Field>
        );
      })}
    </div>
  );
}

export function ExecuteDialog({ spec, onClose }: { spec: ExecSpec; onClose: () => void }) {
  const app = useApp();
  const openSessions = app.sessions.filter((s) => !s.pending && s.status === 'ready');
  const defaultTarget = spec.sessionKey ?? (openSessions.find((s) => s.key === app.activeSession) ?? openSessions[0])?.key ?? '';
  const [target, setTarget] = useState<string>(defaultTarget ? `s:${defaultTarget}` : '');
  const [useTemplate, setUseTemplate] = useState<boolean>(!!spec.template && hasParams(spec.template));
  const [values, setValues] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<string | null>(null);
  const [confirmChange, setConfirmChange] = useState(false);
  const [confirmCompat, setConfirmCompat] = useState(false);
  const [busy, setBusy] = useState(false);

  const session = target.startsWith('s:') ? app.sessionByKey(target.slice(2)) : undefined;
  const deviceForTarget = target.startsWith('d:') ? app.devices.find((d) => d.id === Number(target.slice(2))) : session ? app.devices.find((d) => d.id === session.deviceId) : undefined;
  const devicePlatform = session?.platform ?? deviceForTarget?.platform;
  const compat = devicePlatform ? checkCompat(spec.platform, spec.kind, devicePlatform) : null;

  const rendered = useMemo(() => {
    if (!useTemplate || !spec.template) return { text: spec.command, missing: [] as string[], errors: {} as Record<string, string> };
    return renderTemplate(spec.template, values, { platform: devicePlatform ?? spec.platform, custom: app.templateParams });
  }, [useTemplate, spec, values, devicePlatform, app.templateParams]);

  useEffect(() => setEdited(null), [rendered.text]);
  const finalCommand = edited ?? rendered.text;
  const risk = useMemo(() => {
    const auto = classifyCommand(finalCommand, spec.kind, devicePlatform ?? spec.platform);
    // Уровень риска записи (возможно, изменённый пользователем) не может быть ниже автоматического
    const order = ['info', 'change', 'danger', 'critical'];
    return order.indexOf(spec.risk) >= order.indexOf(auto.level) ? { level: spec.risk, reasons: auto.reasons } : auto;
  }, [finalCommand, spec.kind, spec.risk, devicePlatform, spec.platform]);
  const lines = finalCommand.split('\n').filter((l) => l.trim());
  const multi = lines.length > 1;
  const readOnly = app.settings.readOnlyMode || !!deviceForTarget?.readOnly;
  // Изменяющие команды и любые многострочные последовательности требуют отдельного подтверждения
  const needChangeConfirm = (isChanging(risk.level) && (app.settings.confirmChangeCommands || risk.level !== 'change')) || multi;
  const unfilled = useTemplate && (rendered.missing.length > 0 || Object.keys(rendered.errors).length > 0);
  const blockedByCompat = compat?.level === 'mismatch' && !confirmCompat;
  const maybeCompat = compat?.level === 'maybe' && !confirmCompat;
  const canSend =
    !!target && !!finalCommand.trim() && !unfilled && !blockedByCompat && !maybeCompat && (!needChangeConfirm || confirmChange) && !(readOnly && isChanging(risk.level));

  const targetName = session?.deviceName ?? deviceForTarget?.name ?? '';

  const send = async () => {
    setBusy(true);
    try {
      let key = session?.key;
      if (!key && deviceForTarget) {
        const id = await app.connect(deviceForTarget.id);
        if (!id) return;
        key = id;
        await new Promise((r) => setTimeout(r, 900));
      }
      const s = app.sessionByKey(key ?? null);
      if (!s) throw new Error('Сессия недоступна');
      await api.ssh.send(s.id, finalCommand, { source: spec.source, risk: risk.level, note: spec.title });
      app.setActiveSession(s.key);
      if (app.section !== 'sessions' && !app.splitOpen) app.setSection('sessions');
      onClose();
    } catch (e) {
      app.toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const switchDevices = app.devices.filter((d) => {
    const k = getPlatform(d.platform).kind;
    return spec.kind === 'switch' ? k !== 'linux' : k === 'linux' || (spec.kind === 'sql' && k === 'other');
  });
  // Оператор SQL (не команда оболочки) вводится в уже открытый клиент mysql / psql
  const sqlInClient = spec.kind === 'sql' && !/^\s*(sudo|mysql|mariadb|mysqladmin|mysqldump|mariadb-\w+|mysqlcheck|psql|pg_\w+|createdb|dropdb|createuser|vacuumdb|systemctl|journalctl|tail|nano|zcat|find|ss|du|apt)\b/.test(finalCommand);

  return (
    <Modal
      title="Выполнить на устройстве"
      onClose={onClose}
      width="wide"
      footer={
        <>
          <Button className="left" icon="copy" onClick={() => app.copy(finalCommand)} disabled={unfilled}>
            Копировать
          </Button>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant={isChanging(risk.level) ? 'danger' : 'primary'} icon="play" disabled={!canSend || busy} onClick={send}>
            {targetName ? `Выполнить на «${targetName}»` : 'Выполнить'}
          </Button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{spec.title}</div>
          <div className="small muted">
            Платформа команды: {getPlatform(spec.platform).name}
          </div>
        </div>
        <RiskBadge risk={risk.level} />
      </div>

      <Field label="Целевое устройство" hint="Команда будет отправлена только в выбранную сессию. Копирование не приводит к выполнению.">
        <select className="select" value={target} onChange={(e) => (setTarget(e.target.value), setConfirmCompat(false))}>
          <option value="">— выберите —</option>
          {openSessions.length > 0 && (
            <optgroup label="Открытые сессии">
              {openSessions.map((s) => (
                <option key={s.key} value={`s:${s.key}`}>
                  {s.deviceName} — {s.host} ({getPlatform(s.platform).name})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Подключиться к устройству и выполнить">
            {switchDevices.map((d) => (
              <option key={d.id} value={`d:${d.id}`}>
                {d.name} — {d.host} ({getPlatform(d.platform).name})
              </option>
            ))}
          </optgroup>
        </select>
      </Field>

      {compat && (
        <Banner kind={compat.level === 'ok' ? 'ok' : compat.level === 'maybe' ? 'warn' : 'crit'}>
          {compat.message}
          {compat.level !== 'ok' && (
            <Check
              checked={confirmCompat}
              onChange={setConfirmCompat}
              label={compat.level === 'mismatch' ? 'Я понимаю, что команда для другой платформы, и отправляю её осознанно' : 'Я проверил синтаксис для этого устройства'}
            />
          )}
        </Banner>
      )}

      {sqlInClient && (
        <Banner kind="info">
          Это оператор SQL — он выполняется внутри клиента базы данных. Сначала откройте клиент в выбранной сессии: <code>{spec.platform === 'postgresql' ? 'sudo -u postgres psql' : spec.platform === 'mysql' ? 'sudo mysql' : 'sudo mysql  или  sudo -u postgres psql'}</code> (раздел «Подключение к серверу БД»). Если клиент не открыт, оболочка Linux ответит «command not found» — это безопасно.
        </Banner>
      )}
      {spec.template && hasParams(spec.template) && (
        <div className="row" style={{ margin: '4px 0 10px' }}>
          <Check checked={useTemplate} onChange={setUseTemplate} label="Использовать шаблон с параметрами" />
        </div>
      )}
      {useTemplate && spec.template && (
        <TemplateFill template={spec.template} values={values} onChange={setValues} custom={app.templateParams} platform={devicePlatform ?? spec.platform} />
      )}

      <Field label={`Итоговая команда${multi ? ` (${lines.length} строк)` : ''}`} hint="Можно отредактировать перед отправкой. Риск пересчитывается автоматически.">
        <textarea className="textarea mono" rows={Math.min(12, Math.max(2, finalCommand.split('\n').length + 1))} value={finalCommand} onChange={(e) => setEdited(e.target.value)} spellCheck={false} />
      </Field>

      {risk.reasons.length > 0 && isChanging(risk.level) && (
        <Banner kind={risk.level === 'change' ? 'warn' : 'crit'}>
          <b>{RISK_LABELS[risk.level]}:</b> {risk.reasons.join('; ')}. Распознавание опасных команд не является гарантией — проверьте команду.
        </Banner>
      )}
      {readOnly && isChanging(risk.level) && <Banner kind="crit">Включён режим «Только чтение» — изменяющие команды не отправляются.</Banner>}
      {needChangeConfirm && !readOnly && (
        <Check checked={confirmChange} onChange={setConfirmChange} label={<>Подтверждаю выполнение {multi ? `${lines.length} строк` : 'команды'} на <b>{targetName || 'выбранном устройстве'}</b></>} />
      )}
    </Modal>
  );
}
