// Запросы во время подключения: ключ хоста, keyboard-interactive, пароли и мастер-пароль.
import { useState } from 'react';
import { useApp } from '../lib/store';
import { Banner, Button, Check, Field, Modal } from './ui';
import type { AnyPrompt } from '../../shared/ipc';

export function PromptHost() {
  const app = useApp();
  const p = app.prompts[0];
  if (!p) return null;
  if (p.kind === 'hostKey') return <HostKeyDialog key={p.requestId} p={p} />;
  if (p.kind === 'kbd') return <KbdDialog key={p.requestId} p={p} />;
  return <CredentialsDialog key={p.requestId} p={p} />;
}

function HostKeyDialog({ p }: { p: Extract<AnyPrompt, { kind: 'hostKey' }> }) {
  const app = useApp();
  const [checked, setChecked] = useState(false);
  const answer = (a: 'accept' | 'reject' | 'replace') => app.respondPrompt(p.requestId, a);
  if (p.mismatch) {
    return (
      <Modal
        title="ВНИМАНИЕ: ключ хоста изменился"
        onClose={() => answer('reject')}
        footer={
          <>
            <Button variant="primary" onClick={() => answer('reject')}>
              Отклонить и прервать подключение
            </Button>
            <Button variant="danger" disabled={!checked} onClick={() => answer('replace')}>
              Заменить сохранённый ключ
            </Button>
          </>
        }
      >
        <Banner kind="crit">
          Ключ SSH-сервера <b>{p.deviceName}</b> ({p.host}:{p.port}) отличается от сохранённого ранее. Это может означать атаку «человек посередине» либо легитимную замену
          (переустановка ПО, замена оборудования, новый ключ). Подключение заблокировано до вашего решения.
        </Banner>
        <Field label={`Сохранённый ключ (${p.knownKeyType})`}>
          <div className="fingerprint">{p.knownFingerprint}</div>
        </Field>
        <Field label={`Новый ключ (${p.keyType})`}>
          <div className="fingerprint">{p.fingerprint}</div>
        </Field>
        <Check checked={checked} onChange={setChecked} label="Я сверил новый отпечаток с устройством по независимому каналу (консоль, администратор) и подтверждаю замену" />
      </Modal>
    );
  }
  return (
    <Modal
      title="Новый SSH-сервер"
      onClose={() => answer('reject')}
      footer={
        <>
          <Button onClick={() => answer('reject')}>Отклонить</Button>
          <Button variant="primary" onClick={() => answer('accept')}>
            Доверять и подключиться
          </Button>
        </>
      }
    >
      <p>
        Первое подключение к <b>{p.deviceName}</b> ({p.host}:{p.port}). Убедитесь, что отпечаток ключа совпадает с ключом устройства.
      </p>
      <Field label={`Отпечаток ключа (${p.keyType})`} hint="На Linux-сервере: ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub. На Cisco: show crypto key mypubkey rsa (формат может отличаться).">
        <div className="fingerprint">{p.fingerprint}</div>
      </Field>
      <div className="small muted">После подтверждения ключ будет сохранён. При его изменении подключение будет заблокировано с предупреждением.</div>
    </Modal>
  );
}

function KbdDialog({ p }: { p: Extract<AnyPrompt, { kind: 'kbd' }> }) {
  const app = useApp();
  const [answers, setAnswers] = useState<string[]>(p.prompts.map(() => ''));
  const submit = () => app.respondPrompt(p.requestId, answers);
  return (
    <Modal
      title={`Аутентификация: ${p.deviceName}`}
      onClose={() => app.respondPrompt(p.requestId, null)}
      footer={
        <>
          <Button onClick={() => app.respondPrompt(p.requestId, null)}>Отмена</Button>
          <Button variant="primary" onClick={submit}>
            Отправить
          </Button>
        </>
      }
    >
      {(p.name || p.instructions) && (
        <p className="muted">
          {p.name} {p.instructions}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {p.prompts.map((q, i) => (
          <Field key={i} label={q.prompt}>
            <input
              className="input"
              type={q.echo ? 'text' : 'password'}
              autoFocus={i === 0}
              value={answers[i]}
              onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
            />
          </Field>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function CredentialsDialog({ p }: { p: Extract<AnyPrompt, { kind: 'credentials' }> }) {
  const app = useApp();
  const [v, setV] = useState('');
  const isVault = p.secretKind === 'vaultUnlock';
  const submit = () => {
    app.respondPrompt(p.requestId, v);
    if (isVault) setTimeout(() => void app.refresh('vault'), 300);
  };
  return (
    <Modal
      title={isVault ? 'Мастер-пароль хранилища' : `Пароль: ${p.deviceName}`}
      onClose={() => app.respondPrompt(p.requestId, null)}
      footer={
        <>
          <Button onClick={() => app.respondPrompt(p.requestId, null)}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={!v}>
            {isVault ? 'Разблокировать' : 'Подключиться'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (v) submit();
        }}
      >
        <Field label={p.message} hint={isVault ? undefined : 'Пароль используется только для этого подключения и не сохраняется. Сохранить его можно в карточке устройства.'}>
          <input className="input" type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
