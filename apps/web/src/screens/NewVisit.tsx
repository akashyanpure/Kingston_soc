import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  PROPERTY_TYPES, SCHEMES, VISIT_TYPES,
  type CreatePropertyRequest, type CreateVisitRequest, type PropertyWithLandlord, type SchemeCode, type VisitBundle, type VisitType,
} from '@soc/shared';
import { api, HttpError, isTransient } from '../lib/api';
import { db } from '../lib/db';
import { useOnline } from '../lib/hooks';
import { newId } from '../lib/mutations';
import { useReference, formOf } from '../lib/reference';
import { roomsForPropertyType } from '../lib/roomPlans';
import { useSession } from '../lib/session';
import { mergeBundle, syncEngine } from '../lib/sync';
import { createVisitLocally } from '../lib/visitFactory';
import { VISIT_TYPE_LABEL, addressOf } from '../lib/visitData';
import { Icon } from '../components/ui';

type NewProp = Omit<CreatePropertyRequest, 'id' | 'landlord'> & { landlordName: string; landlordCompany: string; landlordEmail: string; landlordPhone: string };
const EMPTY_PROP: NewProp = {
  uprn: null, addressLine1: '', addressLine2: null, town: 'Kingston upon Thames', postcode: '', propertyType: '2-bed flat',
  bedrooms: null, landlordId: null, landlordName: '', landlordCompany: '', landlordEmail: '', landlordPhone: '',
};

export function NewVisit() {
  const nav = useNavigate();
  const online = useOnline();
  const session = useSession();
  const ref = useReference();
  const form = formOf(ref);

  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<PropertyWithLandlord[]>([]);
  const [selected, setSelected] = useState<PropertyWithLandlord | null>(null);
  const [creating, setCreating] = useState(false);
  const [np, setNp] = useState<NewProp>(EMPTY_PROP);
  const [scheme, setScheme] = useState<SchemeCode>('PLS');
  const [visitType, setVisitType] = useState<VisitType>('check_in');
  const [propType, setPropType] = useState<string>('2-bed flat');
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local matches (works offline) + server search when online.
  const local = useLiveQuery(async () => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const props = await db.properties.filter((p) => `${p.addressLine1} ${p.addressLine2 ?? ''} ${p.postcode} ${p.uprn ?? ''}`.toLowerCase().includes(q)).limit(8).toArray();
    return Promise.all(props.map(async (p) => ({ ...p, landlord: p.landlordId ? (await db.landlords.get(p.landlordId)) ?? null : null })));
  }, [query]);
  useEffect(() => {
    const q = query.trim();
    if (!online || q.length < 2) { setRemote([]); return; }
    const t = setTimeout(() => {
      api<{ properties: PropertyWithLandlord[] }>(`/properties?q=${encodeURIComponent(q)}`)
        .then((r) => setRemote(r.properties)).catch(() => setRemote([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, online]);
  const results = useMemo(() => {
    const seen = new Set<string>();
    return [...remote, ...(local ?? [])].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }, [remote, local]);

  // Property type preselects the rooms; officer adjusts.
  useEffect(() => {
    if (form) setPresent(new Set(roomsForPropertyType(form, propType)));
  }, [form, propType]);
  useEffect(() => {
    if (selected && (PROPERTY_TYPES as readonly string[]).includes(selected.propertyType)) setPropType(selected.propertyType);
  }, [selected]);

  const roomCount = present.size;
  const itemCount = form?.rooms.filter((r) => present.has(r.code)).reduce((n, r) => n + r.items.length, 0) ?? 0;
  const propertyReady = selected !== null || (creating && np.addressLine1.trim() && np.postcode.trim().length >= 5);
  const schemes = ref?.schemes?.length ? ref.schemes : SCHEMES.map((s) => ({ code: s.code, name: s.name }));

  if (ref === undefined || session === undefined) return null;
  if (!form || !ref) {
    return (
      <div>
        <Link to="/" className="back-link">← My visits</Link>
        <h1 className="title">New visit</h1>
        <div className="notice notice--strong">The form has not been downloaded to this phone yet. Connect once to fetch it, then you can start visits offline.</div>
        <button type="button" className="btn btn--block" onClick={() => void syncEngine.syncNow({ pull: true })}>Try again</button>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!propertyReady || roomCount === 0 || !session) return;
    setBusy(true);
    setError(null);
    try {
      let propertyId: string;
      let propertyQueued = false;
      if (selected) {
        propertyId = selected.id;
        const { landlord, ...prop } = selected;
        await db.properties.put(prop);
        if (landlord) await db.landlords.put(landlord);
      } else {
        propertyId = newId();
        const landlord = np.landlordName.trim()
          ? { id: newId(), name: np.landlordName.trim(), company: np.landlordCompany.trim() || null, email: np.landlordEmail.trim() || null, phone: np.landlordPhone.trim() || null }
          : null;
        const req: CreatePropertyRequest = {
          id: propertyId, uprn: np.uprn?.trim() || null, addressLine1: np.addressLine1.trim(), addressLine2: np.addressLine2?.trim() || null,
          town: np.town.trim(), postcode: np.postcode.trim().toUpperCase(), propertyType: propType as CreatePropertyRequest['propertyType'],
          bedrooms: np.bedrooms, landlordId: landlord?.id ?? null, landlord,
        };
        const { landlord: _l, ...prop } = req;
        await db.properties.put(prop);
        if (landlord) await db.landlords.put(landlord);
        try {
          if (!online) throw new Error('offline');
          await api('/properties', { method: 'POST', json: req });
        } catch (err) {
          if (err instanceof HttpError && !isTransient(err)) throw err;
          propertyQueued = true;
          await db.pendingActions.add({ kind: 'createProperty', visitId: null, payload: req, status: 'pending', attempts: 0, createdAt: new Date().toISOString() });
        }
      }

      const visitId = newId();
      const req: CreateVisitRequest = {
        id: visitId, propertyId, tenancyId: null, schemeCode: scheme, visitType,
        presentRoomCodes: form.rooms.filter((r) => present.has(r.code)).map((r) => r.code),
        scheduledAt: new Date().toISOString(),
      };
      let created = false;
      if (online && !propertyQueued) {
        try {
          const bundle = await api<VisitBundle>('/visits', { method: 'POST', json: req });
          await mergeBundle(bundle);
          created = true;
        } catch (err) {
          if (err instanceof HttpError && !isTransient(err)) throw err;
        }
      }
      if (!created) {
        // Offline (or server unreachable): build rooms/items from the cached form and queue them.
        await createVisitLocally(form, { ...req, formVersionId: ref.formVersion.id, officerId: session.id });
        syncEngine.notifyChange();
      }
      nav(`/visits/${visitId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleRoom = (code: string) =>
    setPresent((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  return (
    <form onSubmit={(e) => void submit(e)}>
      <Link to="/" className="back-link"><Icon name="chevronLeft" size={18} /> My visits</Link>
      <div className="kicker">Start an inspection</div>
      <h1 className="title">New visit</h1>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-label">Property</legend>
        {selected ? (
          <div className="card">
            <div className="visit-card__addr">{addressOf(selected)}</div>
            <div className="small muted">{selected.postcode}{selected.uprn ? ` · UPRN ${selected.uprn}` : ''} · {selected.propertyType}</div>
            {selected.landlord && <div className="small">Landlord: {selected.landlord.company ?? selected.landlord.name}</div>}
            <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => setSelected(null)}>Change property</button>
          </div>
        ) : creating ? (
          <div className="card">
            <div className="field"><label className="field__label" htmlFor="np-a1">Address line 1</label>
              <input id="np-a1" className="input" value={np.addressLine1} onChange={(e) => setNp({ ...np, addressLine1: e.target.value })} required /></div>
            <div className="field"><label className="field__label" htmlFor="np-a2">Address line 2 (optional)</label>
              <input id="np-a2" className="input" value={np.addressLine2 ?? ''} onChange={(e) => setNp({ ...np, addressLine2: e.target.value })} /></div>
            <div className="field-grid">
              <div className="field"><label className="field__label" htmlFor="np-town">Town</label>
                <input id="np-town" className="input" value={np.town} onChange={(e) => setNp({ ...np, town: e.target.value })} /></div>
              <div className="field"><label className="field__label" htmlFor="np-pc">Postcode</label>
                <input id="np-pc" className="input" value={np.postcode} autoCapitalize="characters" onChange={(e) => setNp({ ...np, postcode: e.target.value })} required /></div>
            </div>
            <div className="field"><label className="field__label" htmlFor="np-uprn">UPRN (optional)</label>
              <input id="np-uprn" className="input" inputMode="numeric" value={np.uprn ?? ''} onChange={(e) => setNp({ ...np, uprn: e.target.value })} /></div>
            <div className="field"><label className="field__label" htmlFor="np-ll">Landlord / agent name (optional)</label>
              <input id="np-ll" className="input" value={np.landlordName} onChange={(e) => setNp({ ...np, landlordName: e.target.value })} /></div>
            {np.landlordName && (
              <>
                <div className="field"><label className="field__label" htmlFor="np-llc">Company</label>
                  <input id="np-llc" className="input" value={np.landlordCompany} onChange={(e) => setNp({ ...np, landlordCompany: e.target.value })} /></div>
                <div className="field-grid">
                  <div className="field"><label className="field__label" htmlFor="np-lle">Email</label>
                    <input id="np-lle" type="email" className="input" value={np.landlordEmail} onChange={(e) => setNp({ ...np, landlordEmail: e.target.value })} /></div>
                  <div className="field"><label className="field__label" htmlFor="np-llp">Phone</label>
                    <input id="np-llp" type="tel" className="input" value={np.landlordPhone} onChange={(e) => setNp({ ...np, landlordPhone: e.target.value })} /></div>
                </div>
              </>
            )}
            <button type="button" className="btn btn--sm" onClick={() => setCreating(false)}>Search instead</button>
          </div>
        ) : (
          <>
            <label className="visually-hidden" htmlFor="prop-search">Search address, postcode or UPRN</label>
            <input id="prop-search" className="input" type="search" placeholder="Search address, postcode or UPRN" value={query} onChange={(e) => setQuery(e.target.value)} />
            {results.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }} aria-label="Matching properties">
                {results.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="room-row room-row--simple" onClick={() => setSelected(p)}>
                      <span className="room-row__name">{addressOf(p)}</span>
                      <span className="small muted" style={{ display: 'block' }}>{p.postcode}{p.landlord ? ` · ${p.landlord.company ?? p.landlord.name}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length >= 2 && results.length === 0 && (
              <p className="small muted" style={{ marginTop: 6 }}>{online ? 'No matching property.' : 'No match on this phone (offline search only covers properties already downloaded).'}</p>
            )}
            <button type="button" className="btn btn--block" style={{ marginTop: 8 }} onClick={() => { setCreating(true); setNp({ ...EMPTY_PROP, addressLine1: query }); }}>
              <Icon name="plus" size={18} /> Add a new property
            </button>
          </>
        )}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-label">Scheme</legend>
        <div className="choice-grid">
          {schemes.map((s) => (
            <button key={s.code} type="button" className="choice" aria-pressed={scheme === s.code} onClick={() => setScheme(s.code)}>
              {s.code}<small>{s.name}</small>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-label">Visit type</legend>
        <div className="choice-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {VISIT_TYPES.map((t) => (
            <button key={t} type="button" className="choice" aria-pressed={visitType === t} onClick={() => setVisitType(t)}>{VISIT_TYPE_LABEL[t]}</button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-label">Property type — preselects the rooms</legend>
        <div className="choice-grid">
          {PROPERTY_TYPES.map((t) => (
            <button key={t} type="button" className="choice" aria-pressed={propType === t} onClick={() => setPropType(t)}>{t}</button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-label">Rooms in this property</legend>
        {form.rooms.map((r) => (
          <label key={r.code} className="checkrow">
            <input type="checkbox" checked={present.has(r.code)} onChange={() => toggleRoom(r.code)} />
            <span className="checkrow__label">{r.label}</span>
            <span className="small muted">{r.items.length} items</span>
          </label>
        ))}
      </fieldset>

      <div className="notice" style={{ marginTop: 16 }} aria-live="polite">
        Will build <strong>&nbsp;{roomCount} rooms&nbsp;</strong> / <strong>&nbsp;{itemCount} items&nbsp;</strong> from form v{ref.formVersion.version}.
        {!online && ' Offline: the visit is built on this phone and uploads later.'}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy || !propertyReady || roomCount === 0}>
        {busy ? 'Building…' : 'Build the inventory →'}
      </button>
    </form>
  );
}
