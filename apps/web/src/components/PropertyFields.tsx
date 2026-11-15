/**
 * Property address fields with postcode lookup (@soc/shared/address.ts).
 *
 * Postcode first: while typing (≥ 2 chars, debounced 250 ms, online only) a combobox offers
 * postcodes from GET /api/address/autocomplete. A full postcode (typed or picked) is looked up
 * with GET /api/address/postcode/:pc → fills Town and shows district · ward; outside Kingston
 * gets a gentle warning (never blocks). With OS Places the lookup includes addresses: a
 * pick-list fills the lines + UPRN. Offline / provider unavailable → a quiet note; manual entry
 * always works.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { normalisePostcode, type AddressCandidate, type PostcodeLookup } from '@soc/shared';
import { api, HttpError } from '../lib/api';
import { Icon } from './ui';

export interface PropertyDraft {
  postcode: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  uprn: string;
  /** UPRN came from the address provider (shown read-only). */
  uprnFromLookup: boolean;
}
export const emptyPropertyDraft = (): PropertyDraft => ({
  postcode: '', addressLine1: '', addressLine2: '', town: 'Kingston upon Thames', uprn: '', uprnFromLookup: false,
});
export const propertyDraftReady = (d: PropertyDraft) => d.addressLine1.trim().length > 0 && d.postcode.trim().length >= 5;

export const LOOKUP_DEBOUNCE_MS = 250;
type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; lookup: PostcodeLookup }
  | { kind: 'notfound' }
  | { kind: 'unavailable' };

const isUnavailable = (e: unknown) =>
  !(e instanceof HttpError) || e.status >= 500 || e.code === 'LOOKUP_UNAVAILABLE' || e.code === 'PROVIDER_DISABLED';

export function PropertyFields({ value, onChange, idPrefix = 'pf' }: { value: PropertyDraft; onChange: (d: PropertyDraft) => void; idPrefix?: string }) {
  const uid = useId();
  const ids = { pc: `${idPrefix}-pc`, list: `${idPrefix}-pc-list-${uid}`, a1: `${idPrefix}-a1`, a2: `${idPrefix}-a2`, town: `${idPrefix}-town`, uprn: `${idPrefix}-uprn`, status: `${idPrefix}-pc-status` };
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<LookupState>({ kind: 'idle' });
  const [pickList, setPickList] = useState<AddressCandidate[]>([]);
  const latest = useRef(value);
  latest.current = value;
  const lookedUp = useRef<string | null>(null);
  const skipAutocomplete = useRef(false);

  const set = (patch: Partial<PropertyDraft>) => onChange({ ...latest.current, ...patch });

  const lookup = async (pc: string) => {
    if (lookedUp.current === pc) return;
    lookedUp.current = pc;
    if (!navigator.onLine) { setState({ kind: 'unavailable' }); return; }
    setState({ kind: 'loading' });
    try {
      const res = await api<PostcodeLookup>(`/address/postcode/${encodeURIComponent(pc)}`);
      if (lookedUp.current !== pc) return;
      if (res.provider === 'none') { setState({ kind: 'unavailable' }); return; }
      setState({ kind: 'found', lookup: res });
      const town = res.town ?? res.district;
      set({ postcode: res.postcode, ...(town ? { town } : {}) });
      setPickList(res.addresses);
    } catch (e) {
      if (lookedUp.current !== pc) return;
      setPickList([]);
      setState(isUnavailable(e) ? { kind: 'unavailable' } : { kind: 'notfound' });
    }
  };

  // Debounced autocomplete + lookup when the postcode is complete.
  useEffect(() => {
    const raw = value.postcode.trim();
    if (skipAutocomplete.current) { skipAutocomplete.current = false; return; }
    const compact = raw.replace(/\s+/g, '');
    if (compact.length < 2) { setSuggestions([]); setOpen(false); if (!compact) { setState({ kind: 'idle' }); lookedUp.current = null; } return; }
    const t = setTimeout(() => {
      const full = normalisePostcode(raw);
      if (!navigator.onLine) { setSuggestions([]); setOpen(false); setState({ kind: 'unavailable' }); return; }
      // Keep the user's space ("KT2 6") — it tells the server where the outward code ends.
      api<{ postcodes: string[] }>(`/address/autocomplete?q=${encodeURIComponent(raw.replace(/\s+/g, ' '))}`)
        .then((r) => {
          const list = r.postcodes.filter((p) => p !== full);
          setSuggestions(list);
          setOpen(list.length > 0 && document.activeElement?.id === ids.pc);
          setActive(-1);
        })
        .catch((e) => { setSuggestions([]); setOpen(false); if (isUnavailable(e)) setState({ kind: 'unavailable' }); });
      if (full) void lookup(full);
      else if (state.kind !== 'unavailable') { setState({ kind: 'idle' }); lookedUp.current = null; setPickList([]); }
    }, LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value.postcode]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (pc: string) => {
    skipAutocomplete.current = true;
    setOpen(false);
    setSuggestions([]);
    set({ postcode: pc });
    void lookup(pc);
  };
  const pickAddress = (a: AddressCandidate) => {
    set({ addressLine1: a.addressLine1, addressLine2: a.addressLine2 ?? '', town: a.town, postcode: a.postcode, uprn: a.uprn ?? '', uprnFromLookup: !!a.uprn });
    setPickList([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (!suggestions.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && suggestions[active]) { e.preventDefault(); choose(suggestions[active]!); }
      else {
        const full = normalisePostcode(value.postcode);
        if (full) { e.preventDefault(); setOpen(false); void lookup(full); }
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); }
    }
  };

  const found = state.kind === 'found' ? state.lookup : null;
  const where = found ? [found.district, found.ward ? `${found.ward} ward` : null].filter(Boolean).join(' · ') : '';

  return (
    <div className="pfields">
      <div className="field combo">
        <label className="field__label" htmlFor={ids.pc}>Postcode</label>
        <div className="combo__wrap">
          <input
            id={ids.pc} className="input" value={value.postcode} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={ids.list}
            aria-activedescendant={open && active >= 0 ? `${ids.list}-${active}` : undefined} aria-describedby={ids.status}
            onChange={(e) => { set({ postcode: e.target.value, ...(latest.current.uprnFromLookup ? { uprnFromLookup: false } : {}) }); }}
            onKeyDown={onKeyDown}
            onFocus={() => { if (suggestions.length) setOpen(true); }}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder="e.g. KT2 6EU"
          />
          {state.kind === 'loading' && <span className="combo__spinner" aria-hidden="true" />}
          <ul id={ids.list} role="listbox" aria-label="Postcode suggestions" className="combo__list" hidden={!open}>
            {suggestions.map((s, i) => (
              <li key={s} id={`${ids.list}-${i}`} role="option" aria-selected={i === active} className="combo__option"
                onMouseDown={(e) => { e.preventDefault(); choose(s); }}>
                <Icon name="search" size={16} /> {s}
              </li>
            ))}
          </ul>
        </div>
        <div id={ids.status} className="combo__status" aria-live="polite">
          {found && !found.outsideKingston && where && <span className="pc-ok"><Icon name="check" size={14} /> {where}</span>}
          {found?.outsideKingston && (
            <span className="pc-warn">This postcode is outside the Royal Borough{where ? ` (${where})` : ''} — check it's right.</span>
          )}
          {state.kind === 'notfound' && <span className="pc-bad">We couldn't find that postcode — check it, or carry on and save anyway.</span>}
          {state.kind === 'unavailable' && <span className="muted">Address lookup unavailable — enter manually.</span>}
        </div>
      </div>

      {pickList.length > 0 && (
        <fieldset className="picklist">
          <legend className="field__label">Select the address</legend>
          <ul role="list">
            {pickList.map((a) => (
              <li key={`${a.uprn ?? a.label}`}>
                <button type="button" className="picklist__option" onClick={() => pickAddress(a)}>
                  <span>{a.label}</span>
                  {a.uprn && <span className="small muted" style={{ whiteSpace: 'nowrap' }}>UPRN {a.uprn}</span>}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--link btn--sm" onClick={() => setPickList([])}>Address not listed — enter manually</button>
        </fieldset>
      )}

      <div className="field">
        <label className="field__label" htmlFor={ids.a1}>Address line 1</label>
        <input id={ids.a1} className="input" value={value.addressLine1} autoComplete="address-line1" onChange={(e) => set({ addressLine1: e.target.value })} required />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.a2}>Address line 2 (optional)</label>
        <input id={ids.a2} className="input" value={value.addressLine2} autoComplete="address-line2" onChange={(e) => set({ addressLine2: e.target.value })} />
      </div>
      <div className="field-grid">
        <div className="field">
          <label className="field__label" htmlFor={ids.town}>Town</label>
          <input id={ids.town} className="input" value={value.town} autoComplete="address-level2" onChange={(e) => set({ town: e.target.value })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={ids.uprn}>UPRN{value.uprnFromLookup ? ' (from address lookup)' : ' (optional)'}</label>
          <input id={ids.uprn} className="input" inputMode="numeric" value={value.uprn} readOnly={value.uprnFromLookup}
            onChange={(e) => set({ uprn: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
