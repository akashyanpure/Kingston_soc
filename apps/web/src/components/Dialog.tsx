import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './ui';

/**
 * Modal dialog on the native <dialog> element (focus is trapped and restored by the browser,
 * Escape closes). Falls back to an `open` attribute where showModal is missing (jsdom).
 */
export function Dialog({ open, title, onClose, children, wide, side }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean; side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref} className={`dialog${wide ? ' dialog--wide' : ''}${side ? ' dialog--side' : ''}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="dialog__inner">
          <header className="dialog__head">
            <h2 id={titleId} className="dialog__title">{title}</h2>
            <button type="button" className="info-btn" onClick={onClose} aria-label="Close"><Icon name="plus" style={{ transform: 'rotate(45deg)' }} /></button>
          </header>
          <div className="dialog__body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
