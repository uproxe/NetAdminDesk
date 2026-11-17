// Базовые элементы интерфейса.
import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Icon } from '../lib/icons';
import type { RiskLevel, CommandRecord } from '../../shared/types';
import { RISK_HINTS, RISK_LABELS } from '../../shared/risk';
import { SOURCE_LABELS, SOURCE_SHORT, sourceLabel } from '../lib/format';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'ghost' | 'default';
  size?: 'sm' | 'md';
  icon?: string;
  iconOnly?: boolean;
};

export function Button({ variant = 'default', size = 'md', icon, iconOnly, children, className = '', ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' ? variant : '', size === 'sm' ? 'sm' : '', iconOnly ? 'icon' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {!iconOnly && children}
    </button>
  );
}

export function RiskBadge({ risk, title }: { risk: RiskLevel; title?: string }) {
  return (
    <span className={`badge risk-${risk}`} title={title ?? RISK_HINTS[risk]}>
      {risk !== 'info' && <Icon name={risk === 'change' ? 'edit' : 'alert'} size={11} />}
      {RISK_LABELS[risk]}
    </span>
  );
}

export function SourceBadge({ c, short }: { c: Pick<CommandRecord, 'source' | 'originFile' | 'verified'>; short?: boolean }) {
  return (
    <>
      <span className="badge outline" title={sourceLabel(c)}>
        {short ? SOURCE_SHORT[c.source] : sourceLabel(c)}
      </span>
      {c.verified && (
        <span className="badge ok" title={SOURCE_LABELS.verified}>
          <Icon name="check" size={11} />
          {short ? 'Проверено' : SOURCE_LABELS.verified}
        </span>
      )}
    </>
  );
}

export function FlagBadges({ c }: { c: Pick<CommandRecord, 'needsReview' | 'vendorUnknown' | 'sensitive' | 'reviewNote'> }) {
  return (
    <>
      {c.needsReview && (
        <span className="badge warn" title={c.reviewNote}>
          Требует проверки
        </span>
      )}
      {c.vendorUnknown && <span className="badge outline">Производитель не указан</span>}
      {c.sensitive && (
        <span className="badge crit">
          <Icon name="lock" size={11} />
          Чувствительные данные
        </span>
      )}
    </>
  );
}

export function Field({ label, hint, error, children }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {error ? <div className="error">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Toggle({ label, desc, checked, onChange, disabled }: { label: ReactNode; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="toggle">
      <div>
        <div className="label">{label}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <label className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="slider" />
      </label>
    </div>
  );
}

export function Check({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Banner({ kind = 'info', children, icon }: { kind?: 'info' | 'ok' | 'warn' | 'danger' | 'crit'; children: ReactNode; icon?: string }) {
  const ic = icon ?? (kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert');
  return (
    <div className={`banner ${kind === 'info' ? '' : kind}`}>
      <Icon name={ic} size={16} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function Empty({ icon = 'search', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <h4>{title}</h4>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
  closeOnBackdrop = false
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'normal' | 'wide' | 'xwide';
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}>
      <div className={`modal ${width && width !== 'normal' ? width : ''}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3>{title}</h3>
          <Button variant="ghost" iconOnly icon="x" size="sm" onClick={onClose} title="Закрыть (Esc)" />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs-inline">
      {items.map((i) => (
        <button key={i.id} className={value === i.id ? 'active' : ''} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Подсветка параметров {{NAME}} в тексте команды. */
export function CodeWithParams({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\{\{[^}]+\}\}$/.test(p) ? (
          <span key={i} className="param">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export function useDebounced<T>(value: T, ms = 120): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Вертикальный разделитель с перетаскиванием. ratio — доля левой панели. */
export function Splitter({ onRatio }: { onRatio: (ratio: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag) return;
    const parent = ref.current?.parentElement;
    const move = (e: MouseEvent) => {
      if (!parent) return;
      const r = parent.getBoundingClientRect();
      onRatio(Math.min(0.85, Math.max(0.25, (e.clientX - r.left) / r.width)));
    };
    const up = () => setDrag(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [drag, onRatio]);
  return <div ref={ref} className={`splitter ${drag ? 'dragging' : ''}`} onMouseDown={() => setDrag(true)} title="Изменить размер панелей" />;
}

export function StatusDot({ status }: { status: string }) {
  const cls = status === 'ready' || status === 'ok' ? 'ok' : status === 'error' ? 'err' : status === 'connecting' || status === 'authenticating' ? 'busy' : '';
  return <span className={`dot ${cls}`} />;
}

/** Диалог ввода строки (замена window.prompt, который не поддерживается в Electron). */
export function askText(
  openDialog: (render: (close: () => void) => ReactNode) => () => void,
  title: string,
  label: string,
  initial = ''
): Promise<string | null> {
  return new Promise((resolve) => {
    openDialog((close) => <TextPrompt title={title} label={label} initial={initial} onDone={(v) => (close(), resolve(v))} />);
  });
}

function TextPrompt({ title, label, initial, onDone }: { title: string; label: string; initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={() => onDone(null)}
      footer={
        <>
          <Button onClick={() => onDone(null)}>Отмена</Button>
          <Button variant="primary" disabled={!v.trim()} onClick={() => onDone(v.trim())}>
            OK
          </Button>
        </>
      }
    >
      <Field label={label}>
        <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && onDone(v.trim())} />
      </Field>
    </Modal>
  );
}

export interface MenuEntry {
  label?: ReactNode;
  icon?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Разделитель вместо пункта. */
  sep?: boolean;
  /** Подзаголовок группы пунктов. */
  header?: string;
  danger?: boolean;
  active?: boolean;
  title?: string;
}

/** Всплывающее меню (контекстное меню, «Ещё ▾»). Закрывается кликом вне меню или Esc. */
export function PopupMenu({ x, y, items, onClose, align = 'left' }: { x: number; y: number; items: MenuEntry[]; onClose: () => void; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = align === 'right' ? x - r.width : x;
    setPos({ left: Math.max(6, Math.min(left, window.innerWidth - r.width - 6)), top: Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) });
  }, [x, y, align]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 150 }} onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div ref={ref} className="context-menu" style={pos} role="menu">
        {items.map((it, i) =>
          it.sep ? (
            <div key={i} className="sep" />
          ) : it.header ? (
            <div key={i} className="menu-header">
              {it.header}
            </div>
          ) : (
            <button
              key={i}
              role="menuitem"
              disabled={it.disabled}
              title={it.title}
              className={`${it.danger ? 'danger' : ''} ${it.active ? 'on' : ''}`}
              onClick={() => {
                onClose();
                it.onClick?.();
              }}
            >
              {it.icon ? <Icon name={it.icon} size={14} /> : <span style={{ width: 14 }} />}
              <span className="grow">{it.label}</span>
              {it.active && <Icon name="check" size={13} />}
            </button>
          )
        )}
      </div>
    </>
  );
}
