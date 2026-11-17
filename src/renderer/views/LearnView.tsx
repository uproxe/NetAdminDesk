// Раздел «Обучение»: встроенные руководства для начинающих и словарь терминов (работает без интернета).
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../lib/store';
import { Banner, Button, Empty, useDebounced } from '../components/ui';
import { Icon } from '../lib/icons';
import { GUIDES, GUIDE_SECTIONS } from '../../../data/guides/index';
import { splitRow } from '../../shared/guideText';
import { getPlatform } from '../../shared/platforms';
import { classifyCommand } from '../../shared/risk';
import type { Guide } from '../../shared/types';

const LEVEL_CLASS: Record<Guide['level'], string> = { новичок: 'ok', базовый: 'accent', опытный: 'warn' };

export function LearnView() {
  const app = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 80);
  const selected = GUIDES.find((g) => g.id === app.guideId) ?? GUIDES[0];
  const found = useMemo(() => {
    if (!dq.trim()) return null;
    return app.index
      .search(dq, { groups: ['guide'] }, 50)
      .map((h) => h.doc.ref)
      .filter((r): r is { type: 'guide'; item: Guide } => r.type === 'guide')
      .map((r) => r.item);
  }, [dq, app.index]);

  const item = (g: Guide) => (
    <button key={g.id} className={`list-item ${selected.id === g.id ? 'active' : ''}`} onClick={() => app.openGuide(g.id)}>
      <div className="row" style={{ gap: 6 }}>
        <span className="grow" style={{ fontWeight: 550, lineHeight: 1.3 }}>
          {g.title}
        </span>
        <span className={`badge ${LEVEL_CLASS[g.level]}`}>{g.level}</span>
      </div>
      <div className="small muted ellipsis">{g.summary}</div>
    </button>
  );

  return (
    <div className="columns">
      <div className="col col-list" style={{ width: 360, flex: '0 0 360px' }}>
        <div className="col-header">
          <input className="input" placeholder="Поиск в руководствах: vlan, поменять порт, место на диске…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="col-body">
          {found ? (
            found.length ? (
              found.map(item)
            ) : (
              <Empty title="Ничего не найдено">Попробуйте другое слово или поищите команду через Ctrl+K.</Empty>
            )
          ) : (
            GUIDE_SECTIONS.map((s) => (
              <Fragment key={s.id}>
                <div className="section-title" style={{ padding: '10px 14px 4px' }}>
                  {s.name}
                </div>
                {GUIDES.filter((g) => g.section === s.id).map(item)}
              </Fragment>
            ))
          )}
        </div>
      </div>
      <div className="col col-detail" style={{ flex: 1, width: "auto", maxWidth: "none" }}>
        <div className="col-body" style={{ padding: '18px 26px', maxWidth: 920 }}>
          <GuideReader g={selected} />
        </div>
      </div>
    </div>
  );
}

export function GuideReader({ g }: { g: Guide }) {
  return (
    <article className="guide">
      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <span className={`badge ${LEVEL_CLASS[g.level]}`}>{g.level}</span>
        <span className="small muted">{GUIDE_SECTIONS.find((s) => s.id === g.section)?.name}</span>
      </div>
      <h2 style={{ margin: '4px 0 6px' }}>{g.title}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {g.summary}
      </p>
      <GuideBody text={g.body} title={g.title} />
    </article>
  );
}

/** Упрощённая разметка руководств → элементы интерфейса. */
function GuideBody({ text, title }: { text: string; title: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const platform = line.slice(3).trim() || 'linux';
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<CodeBlock key={key++} platform={platform} code={code.join('\n')} title={title} />);
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push(<h3 key={key++}>{inline(line.slice(3))}</h3>);
      i++;
      continue;
    }
    if (line.startsWith('> ')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) parts.push(lines[i++].slice(2));
      blocks.push(
        <Banner key={key++} kind="warn">
          {inline(parts.join(' '))}
        </Banner>
      );
      continue;
    }
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      blocks.push(
        <ul key={key++}>
          {items.map((t, k) => (
            <li key={k}>{inline(t)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = splitRow(lines[i++]);
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      blocks.push(
        <div className="guide-table-wrap" key={key++}>
          <table className="guide-table">
            <thead>
              <tr>
                {head.map((c, k) => (
                  <th key={k}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, n) => (
                <tr key={n}>
                  {r.map((c, k) => (
                    <td key={k}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      const start = Number(/^(\d+)/.exec(line)![1]);
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''));
      blocks.push(
        <ol key={key++} start={start}>
          {items.map((t, k) => (
            <li key={k}>{inline(t)}</li>
          ))}
        </ol>
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(## |> |- |\d+\. |```|\|)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return <>{blocks}</>;
}

function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[\[[a-z0-9-]+(?:\|[^\]]+)?\]\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<b key={k++}>{t.slice(2, -2)}</b>);
    else {
      const [id, label] = t.slice(2, -2).split('|');
      out.push(<GuideLink key={k++} id={id} label={label} />);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function GuideLink({ id, label }: { id: string; label?: string }) {
  const app = useApp();
  const g = GUIDES.find((x) => x.id === id);
  if (!g) return <span>{label ?? id}</span>;
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        app.openGuide(id);
      }}
    >
      {label ?? g.title}
    </a>
  );
}

function CodeBlock({ platform, code, title }: { platform: string; code: string; title: string }) {
  const app = useApp();
  const kind: 'switch' | 'linux' | 'sql' = platform === 'linux' ? 'linux' : ['sql', 'mysql', 'postgresql'].includes(platform) ? 'sql' : 'switch';
  const p = getPlatform(platform);
  const run = () =>
    app.execute({
      title: `${title} (из руководства)`,
      command: code,
      template: /\{\{[A-Z_]+/.test(code) ? code : null,
      kind,
      platform: p.id,
      risk: classifyCommand(code, kind).level,
      source: 'reference'
    });
  return (
    <div className="guide-code">
      <div className="guide-code-bar">
        <Icon name={kind === 'linux' ? 'linux' : kind === 'sql' ? 'database' : 'switch'} size={13} />
        <span className="small muted grow">{p.name}</span>
        <Button size="sm" variant="ghost" icon="copy" onClick={() => void app.copy(code)}>
          Копировать
        </Button>
        <Button size="sm" variant="ghost" icon="play" onClick={run} title="Откроется окно выполнения: выбор устройства, проверка совместимости и подтверждение">
          Выполнить…
        </Button>
      </div>
      <pre className="mono">{code}</pre>
    </div>
  );
}
