/** Small presentational pieces: line icons, progress ring, skeletons, stat tile. Decorative SVGs are aria-hidden. */
import type { CSSProperties, ReactNode } from 'react';

const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  camera: 'M4 8.5A2.5 2.5 0 016.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0120 8.5v8A2.5 2.5 0 0117.5 19h-11A2.5 2.5 0 014 16.5zM12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  cloudOff: 'M3 3l18 18M8.5 7.2A5.5 5.5 0 0117.4 10 4 4 0 0119 17.6M16 18H7a4 4 0 01-1.2-7.8',
  sync: 'M20 11a8 8 0 00-14.3-4.5L4 8M4 4v4h4M4 13a8 8 0 0014.3 4.5L20 16M20 20v-4h-4',
  plus: 'M12 5v14M5 12h14',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 7.5v.5',
  image: 'M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15.5 9.5h.01',
  pen: 'M4 20l4.5-1 10-10a2.1 2.1 0 00-3-3l-10 10zM13.5 7.5l3 3',
  file: 'M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M9 13h6M9 17h6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  home: 'M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  door: 'M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17M3 21h18M14 12h.01',
  calendar: 'M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM4 10h16M8 3v4M16 3v4',
  archive: 'M4 5h16v4H4zM5 9v10a1 1 0 001 1h12a1 1 0 001-1V9M10 13h4',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 6.5M18.5 14a6 6 0 013 6',
  book: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  logout: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H4',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  copy: 'M9 9h10v11H9zM5 15H4V4h11v1',
  history: 'M3 12a9 9 0 103-6.7L3 8M3 3v5h5M12 7v5l3 2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  key: 'M14 10a4 4 0 10-3.5 4L8 16.5V19H5.5v-2.5L10 12M17 7h.01',
  edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3zM13.5 6.5l3 3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/**
 * Circular progress. The percentage is printed in the middle (serif numerals) and exposed
 * to assistive tech through role="img" + label; the stroke is decoration.
 */
export function ProgressRing({ pct, size = 64, stroke = 6, label, children, tone = 'teal' }: {
  pct: number; size?: number; stroke?: number; label: string; children?: ReactNode; tone?: 'teal' | 'brass';
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`ring ring--${tone}${clamped === 100 ? ' ring--done' : ''}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle className="ring__value" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring__label" aria-hidden="true">{children ?? <>{clamped}<small>%</small></>}</span>
    </div>
  );
}

export function Skeleton({ lines = 3, card = true }: { lines?: number; card?: boolean }) {
  return (
    <div className={card ? 'skeleton-card' : undefined} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${[62, 88, 46, 74, 55][i % 5]}%`, height: i === 0 ? 22 : 14 }} />
      ))}
    </div>
  );
}

/** Loading placeholder for a whole screen. */
export function ScreenSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="visually-hidden">Loading…</span>
      <div className="skeleton" style={{ width: '40%', height: 12, marginBottom: 10 }} aria-hidden="true" />
      <div className="skeleton" style={{ width: '70%', height: 30, marginBottom: 22 }} aria-hidden="true" />
      {Array.from({ length: cards }, (_, i) => <Skeleton key={i} />)}
    </div>
  );
}

export function StatTile({ value, label, tone }: { value: ReactNode; label: string; tone?: 'brass' | 'alert' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__icon"><Icon name={icon} size={26} /></span>
      <p className="empty__title">{title}</p>
      {children && <div className="empty__body">{children}</div>}
    </div>
  );
}

/** Haptic tick where supported (Android Chrome); silent elsewhere. */
export function tick(ms = 8): void {
  try {
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
