/** Pure formatting helpers (no Node APIs — this package also runs in the browser). */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/** Escape any user-supplied text for use in HTML element content or a quoted attribute. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Escape text for a double-quoted CSS string (used in @page margin boxes). */
export function cssString(value: string): string {
  return (
    '"' +
    value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\r\n]+/g, ' ')
      .replace(/</g, '\\3C ')
      .replace(/>/g, '\\3E ') +
    '"'
  );
}

/** Only allow URL schemes that are safe in <img src>. Anything else becomes empty. */
export function safeSrc(src: string | null | undefined): string {
  if (!src) return '';
  const s = src.trim();
  if (/^(data:image\/(png|jpeg|jpg|webp|gif);base64,|blob:|https?:\/\/|\/|\.\/|\.\.\/)/i.test(s)) return esc(s);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return esc(s); // relative path without a scheme
  return '';
}

const TZ = 'Europe/London';

function parts(iso: string): Record<string, string> {
  const d = new Date(iso);
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: 'long', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)) out[p.type] = p.value;
  out.monthNum = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: '2-digit' }).format(d);
  return out;
}

/** "15 September 2026" */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = parts(iso);
  return `${p.day} ${p.month} ${p.year}`;
}

/** "15/09/2026" (accepts ISO date or datetime) */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  const p = parts(iso);
  return `${p.day}/${p.monthNum}/${p.year}`;
}

/** "09:34" */
export function time(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = parts(iso);
  return `${p.hour}:${p.minute}`;
}

/** "15/09/2026 10:44" */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return `${shortDate(iso)} ${time(iso)}`;
}

/** Inspection date as "DD Month YYYY, HH:MM–HH:MM" (or just the start time / date). */
export function inspectionWindow(start: string | null, end: string | null): string {
  if (!start) return '';
  const base = `${longDate(start)}, ${time(start)}`;
  if (end && shortDate(end) === shortDate(start)) return `${base}–${time(end)}`;
  return base;
}

/** Split a 64-char hex hash into readable groups of 4. */
export function groupHash(hex: string): string {
  return (hex.match(/.{1,4}/g) ?? []).join(' ');
}
