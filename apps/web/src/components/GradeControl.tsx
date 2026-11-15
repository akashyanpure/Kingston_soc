import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Condition, ConditionOption } from '@soc/shared';
import { Icon, tick } from './ui';

const WORD: Record<Condition, string> = { G: 'Good', F: 'Fair', P: 'Poor', U: 'Unaccept.', NA: 'Not pres.' };
const LONG_PRESS_MS = 550;

export interface GradeControlProps {
  /** Accessible name of the item being graded, e.g. "Kitchen, walls". */
  itemLabel: string;
  value: Condition | null;
  options: ConditionOption[];
  onChange: (code: Condition) => void;
  disabled?: boolean;
}

/**
 * G/F/P/U/N/A as a WAI-ARIA radiogroup: one tab stop (roving tabindex), arrow keys
 * move and select, Home/End jump, Space/Enter select. Letter + word + tick on the
 * selected option, so colour is never the only signal. Long-press (or the ⓘ button)
 * shows the grade definitions.
 */
export function GradeControl({ itemLabel, value, options, onChange, disabled }: GradeControlProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const [helpOpen, setHelpOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const helpId = useId();
  const selectedIndex = options.findIndex((o) => o.code === value);
  const tabIndexFor = (i: number) => (i === (selectedIndex >= 0 ? selectedIndex : 0) ? 0 : -1);

  const select = (i: number) => {
    const opt = options[i];
    if (!opt || disabled) return;
    refs.current[i]?.focus();
    if (opt.code !== value) {
      tick();
      onChange(opt.code);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    const from = current >= 0 ? current : Math.max(selectedIndex, 0);
    const n = options.length;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': next = (from + 1) % n; break;
      case 'ArrowLeft': case 'ArrowUp': next = (from - 1 + n) % n; break;
      case 'Home': next = 0; break;
      case 'End': next = n - 1; break;
      case ' ': case 'Enter': next = from; break;
      default: return;
    }
    e.preventDefault();
    select(next);
  };

  const startPress = (code: Condition) => (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    press.current.fired = false;
    press.current.timer = setTimeout(() => {
      press.current.fired = true;
      const opt = options.find((o) => o.code === code);
      if (opt) setAnnounce(`${opt.label}: ${opt.definition}`);
    }, LONG_PRESS_MS);
  };
  const endPress = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  };

  return (
    <div>
      <div className="row">
        <span className="small muted" id={`${helpId}-label`}>Condition</span>
        <button
          type="button" className="info-btn" aria-expanded={helpOpen} aria-controls={`${helpId}-help`}
          onClick={() => setHelpOpen((o) => !o)}
        >
          <Icon name="info" /><span className="visually-hidden">What the grades mean</span>
        </button>
      </div>
      {helpOpen && (
        <dl className="grade-help" id={`${helpId}-help`}>
          {options.map((o) => (
            <div key={o.code}><dt>{o.short} {o.label}:</dt> <dd>{o.definition}</dd></div>
          ))}
        </dl>
      )}
      <div
        role="radiogroup" aria-label={`Condition of ${itemLabel}`} aria-disabled={disabled || undefined}
        className="grades" onKeyDown={onKeyDown}
      >
        <span
          className="grades__thumb" aria-hidden="true" data-grade={value ?? undefined}
          style={{ ['--idx' as string]: Math.max(selectedIndex, 0), width: `calc((100% - 8px) / ${options.length})` }}
        />
        {options.map((o, i) => (
          <button
            key={o.code}
            ref={(el) => { refs.current[i] = el; }}
            type="button" role="radio" aria-checked={o.code === value}
            aria-label={`${o.short} ${o.label}`}
            title={o.definition}
            tabIndex={tabIndexFor(i)}
            disabled={disabled}
            className={`grade grade--${o.code}`}
            onClick={() => {
              if (press.current.fired) { press.current.fired = false; return; }
              select(i);
            }}
            onPointerDown={startPress(o.code)}
            onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="grade__letter" aria-hidden="true">{o.short}</span>
            <span className="grade__word" aria-hidden="true">{WORD[o.code]}</span>
          </button>
        ))}
      </div>
      {announce && (
        <div className="grade-help" role="status">
          {announce}{' '}
          <button type="button" className="btn btn--link btn--sm" onClick={() => setAnnounce('')}>Close</button>
        </div>
      )}
    </div>
  );
}
