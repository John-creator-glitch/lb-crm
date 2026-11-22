import { type ReactNode, useEffect, useState, Children, cloneElement, isValidElement, useId, type ReactElement } from 'react';
import { Loader2, Phone, MessageCircle } from 'lucide-react';
import { telUrl, whatsappUrl } from '@/lib/errors';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4 sm:mb-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, subtitle }: { icon: typeof Loader2; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  /** If onClick returns a promise (async handler) the button shows a spinner and ignores further clicks until it finishes, so a payment or status change cannot be submitted twice. */
  onClick?: () => void | Promise<unknown>;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Shows a spinner and blocks double clicks while a save is running. */
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const busy = !!loading || pending;
  const click = () => {
    if (!onClick || busy) return;
    const r = onClick();
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setPending(true);
      (r as Promise<unknown>).then(() => setPending(false), () => setPending(false));
    }
  };
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = { sm: 'px-3 py-2 min-h-[40px] text-sm', md: 'px-4 py-3 min-h-[44px] text-sm' };
  const variants = {
    primary: 'bg-amber-500 text-slate-900 hover:bg-amber-400 shadow-sm shadow-amber-500/20',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-rose-500 text-white hover:bg-rose-600',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  return (
    <button
      type={type}
      onClick={click}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  required,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
  /** Inline validation message shown under the field. */
  error?: string;
}) {
  const uid = useId();
  const id = `f${uid.replace(/:/g, '')}`;
  // Give the first form control inside the Field an id (unless it has one) so the label is read by screen readers and clicking it focuses the control.
  let controlId = id; let wired = false;
  const kids = Children.map(children, (c) => {
    if (wired || !isValidElement(c)) return c;
    const el = c as ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
    if (typeof el.type === 'string' && !['input', 'select', 'textarea'].includes(el.type)) return c;
    wired = true; controlId = el.props.id ?? id;
    return cloneElement(el, { id: controlId, 'aria-invalid': error ? true : el.props['aria-invalid'], 'aria-describedby': error ? `${id}-err` : el.props['aria-describedby'] });
  });
  return (
    <div>
      <label htmlFor={wired ? controlId : undefined} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-rose-600 ml-0.5" aria-hidden>*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {kids}
      {error && <p id={`${id}-err`} role="alert" className="text-xs text-rose-600 mt-1">{error}</p>}
      {hint && !error && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-3 sm:py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 text-base sm:text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-3 sm:py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition ${props.className ?? ''}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full px-3 py-3 sm:py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 text-base sm:text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition ${props.className ?? ''}`}
    />
  );
}

/** Trail like "Clients › Ali Khan". Earlier items are clickable and go back; the last is the current page. */
export function Breadcrumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span aria-hidden>›</span>}
              {last || !it.onClick
                ? <span aria-current={last ? 'page' : undefined} className={`truncate max-w-[60vw] ${last ? 'text-slate-800 font-medium' : ''}`}>{it.label}</span>
                : <button onClick={it.onClick} className="underline-offset-2 hover:underline hover:text-slate-800 py-1">{it.label}</button>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Pager for long lists. Page size is fixed; shows "21–40 of 135". */
export const PAGE_SIZE = 25;
export function Pager({ page, pageSize = PAGE_SIZE, total, onPage, resetKey }: { page: number; pageSize?: number; total: number; onPage: (p: number) => void; /** When this changes (a filter or search changed the result), go back to page 1. */ resetKey?: unknown }) {
  useEffect(() => { onPage(0); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  const from = page * pageSize + 1; const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 mt-4 text-sm text-slate-600">
      <span>{from}–{to} of {total}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="self-center px-1">Page {page + 1} / {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  );
}

/** Call / WhatsApp links from a stored phone number: nobody has to retype it. */
export function ContactActions({ phone, whatsappText, className = '' }: { phone?: string | null; whatsappText?: string; className?: string }) {
  const tel = telUrl(phone); const wa = whatsappUrl(phone, whatsappText);
  if (!tel && !wa) return null;
  const cls = 'inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50';
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {tel && <a href={tel} className={cls}><Phone className="w-4 h-4" aria-hidden />Call</a>}
      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className={cls}><MessageCircle className="w-4 h-4" aria-hidden />WhatsApp</a>}
    </div>
  );
}
