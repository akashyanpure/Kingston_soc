import { useEffect, useRef, type PointerEvent } from 'react';

export interface SignaturePadProps {
  label: string;
  value: string | null; // PNG data URL
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

/** Finger/stylus signature on a canvas; emits a PNG data URL when each stroke ends. */
export function SignaturePad({ label, value, onChange, disabled }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  // Size the backing store to the element (crisp on high-DPI) and paint any saved signature.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(rect.width * dpr));
    c.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#072932';
    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        ctx.restore();
      };
      img.src = value;
    }
    // Only on mount: later value changes come from this pad itself.
  }, []); // eslint-disable-line

  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext('2d');
    const p = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(p.x, p.y);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    const p = pos(e);
    ctx?.lineTo(p.x, p.y);
    ctx?.stroke();
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current && canvasRef.current) onChange(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    dirty.current = false;
    onChange(null);
  };

  return (
    <div>
      <div className={`sigpad${value ? ' sigpad--signed' : ''}`}>
        <canvas
          ref={canvasRef} role="img" aria-label={value ? `${label}: signed` : `${label}: signature pad, sign with your finger`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        />
        {!value && <div className="sigpad__hint" aria-hidden="true">Sign here with a finger</div>}
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        <span className="small muted">{value ? 'Signed on this device' : 'Not signed'}</span>
        <button type="button" className="btn btn--link btn--sm" onClick={clear} disabled={disabled || !value}>Clear signature</button>
      </div>
    </div>
  );
}
