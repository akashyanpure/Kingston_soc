import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';

const SAVE_DELAY = 450;

export interface AutoFieldProps {
  label: string;
  value: string | null | undefined;
  /** Called with the trimmed-right text after a pause in typing and on blur. */
  onSave: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hideLabel?: boolean;
  capsLabel?: boolean;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  type?: string;
  disabled?: boolean;
  hint?: ReactNode;
  id?: string;
  soft?: boolean;
  autoComplete?: string;
}

/** Text field that saves itself (no save button): debounced while typing, flushed on blur/unmount. */
export function AutoField(p: AutoFieldProps) {
  const autoId = useId();
  const id = p.id ?? autoId;
  const [draft, setDraft] = useState(p.value ?? '');
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, value: p.value ?? '', onSave: p.onSave });
  latest.current = { draft, value: p.value ?? '', onSave: p.onSave };

  useEffect(() => {
    if (!focused.current) setDraft(p.value ?? '');
  }, [p.value]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { draft: d, value: v, onSave } = latest.current;
    if (d !== v) onSave(d);
  };
  useEffect(() => () => flush(), []);

  const common = {
    id,
    value: draft,
    placeholder: p.placeholder,
    disabled: p.disabled,
    'aria-describedby': p.hint ? `${id}-hint` : undefined,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; flush(); },
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
  };
  return (
    <div className="field">
      <label htmlFor={id} className={`field__label${p.capsLabel ? ' field__label--caps' : ''}${p.hideLabel ? ' visually-hidden' : ''}`}>{p.label}</label>
      {p.multiline ? (
        <textarea className={`textarea${p.soft ? ' input--soft' : ''}`} {...common} />
      ) : (
        <input className={`input${p.soft ? ' input--soft' : ''}`} type={p.type ?? 'text'} inputMode={p.inputMode} autoComplete={p.autoComplete ?? 'off'} {...common} />
      )}
      {p.hint && <div id={`${id}-hint`} className="small muted">{p.hint}</div>}
    </div>
  );
}

export function QtyStepper({ value, onChange, itemLabel, disabled }: { value: number | null; onChange: (n: number) => void; itemLabel: string; disabled?: boolean }) {
  const n = value ?? 0;
  return (
    <span className="stepper" role="group" aria-label={`Quantity of ${itemLabel}`}>
      <button type="button" disabled={disabled || n <= 0} onClick={() => onChange(Math.max(0, n - 1))} aria-label={`Fewer ${itemLabel}`}>−</button>
      <output aria-live="polite" aria-label="Quantity">{value ?? '–'}</output>
      <button type="button" disabled={disabled} onClick={() => onChange(n + 1)} aria-label={`More ${itemLabel}`}>+</button>
    </span>
  );
}

export function Corners() {
  return (
    <>
      <i className="corner tl" aria-hidden="true" /><i className="corner tr" aria-hidden="true" />
      <i className="corner bl" aria-hidden="true" /><i className="corner br" aria-hidden="true" />
    </>
  );
}

export function ProgressBar({ pct, label, large }: { pct: number; label: string; large?: boolean }) {
  return (
    <div className={`progress${large ? ' progress--lg' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function GradePill({ code, label }: { code: string | null; label?: string }) {
  if (!code) return <span className="pill">{label ?? 'Not graded'}</span>;
  return <span className={`pill pill--${code}`}>{label ?? (code === 'NA' ? 'N/A' : code)}</span>;
}
