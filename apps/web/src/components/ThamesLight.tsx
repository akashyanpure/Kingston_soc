import { useEffect, useState } from 'react';

/**
 * "Thames light": barely-there light on water behind the Login and Issued screens.
 * Pure CSS: pre-blurred radial-gradient washes drifting on 20–40 s loops, plus two thin
 * river lines (after the wavy lines beneath the crest). Only transform/opacity animate.
 * Paused while the page is hidden; static under prefers-reduced-motion (see app.css).
 * `surge` plays a one-off ~1.2 s brightening (used when the issued seal stamps in).
 */
export function ThamesLight({ surge = false }: { surge?: boolean }) {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return (
    <div className={`thames${hidden ? ' thames--paused' : ''}${surge ? ' thames--surge' : ''}`} aria-hidden="true">
      <div className="thames__wash thames__wash--teal" />
      <div className="thames__wash thames__wash--brass" />
      <div className="thames__wash thames__wash--river" />
      <svg className="thames__river" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path className="thames__line thames__line--a" d="M0 60 C 150 30, 300 90, 450 60 S 750 30, 900 60 S 1200 90, 1350 60 S 1650 30, 1800 60 S 2100 90, 2400 60" />
        <path className="thames__line thames__line--b" d="M0 88 C 150 64, 300 112, 450 88 S 750 64, 900 88 S 1200 112, 1350 88 S 1650 64, 1800 88 S 2100 112, 2400 88" />
      </svg>
    </div>
  );
}
