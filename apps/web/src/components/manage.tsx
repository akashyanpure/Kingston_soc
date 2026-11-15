/** Manager widgets: visit preview, property history, assign and schedule dialogs. */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PROPERTY_TYPES, SCHEMES, VISIT_TYPES, normalisePostcode, roomDisplayName,
  type CreatePropertyRequest, type CreateVisitRequest, type PropertyWithLandlord, type SchemeCode, type VisitStatus, type VisitSummary, type VisitType,
} from '@soc/shared';
import { api, apiRaw } from '../lib/api';
import { newId } from '../lib/mutations';
import { errorMessage, fmtDateTime, fmtDay, fromLocalInput, toLocalInput, useApi } from '../lib/portal';
import { formOf, useReference } from '../lib/reference';
import { roomsForPropertyType } from '../lib/roomPlans';
import { STATUS_LABEL, VISIT_TYPE_LABEL } from '../lib/visitData';
import { Dialog } from './Dialog';
import { PropertyFields, emptyPropertyDraft, propertyDraftReady, type PropertyDraft } from './PropertyFields';
import { Icon, Skeleton } from './ui';

export function StatusPill({ status }: { status: VisitStatus }) {
  const tone = status === 'issued' ? ' pill--brass' : status === 'in_progress' ? ' pill--teal' : status === 'completed' ? ' pill--G' : status === 'cancelled' ? ' pill--NA' : '';
  return <span className={`pill${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function useOfficers() {
  const ref = useReference();
  return useMemo(() => (ref?.officers ?? []).filter((o) => o.role === 'officer'), [ref]);
}

/** Read-only report preview (server-rendered HTML, GET /visits/:id/preview) in a sandboxed iframe. */
export function VisitPreviewDialog({ visitId, title, onClose }: { visitId: string | null; title: string; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setHtml(null);
    setError(null);
    if (!visitId) return;
    let live = true;
    apiRaw(`/visits/${visitId}/preview`).then((r) => r.text()).then((t) => { if (live) setHtml(t); }).catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [visitId]);
  return (
    <Dialog open={!!visitId} title={title} onClose={onClose} wide>
      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {!html && !error && <Skeleton lines={6} />}
      {html && <iframe title={`Preview: ${title}`} className="preview-frame preview-frame--dialog" sandbox="" srcDoc={html} />}
      <p className="small muted" style={{ marginTop: 8 }}>Read-only preview rendered by the server.</p>
    </Dialog>
  );
}

/** Side panel: every visit to a property, newest first. */
export function PropertyHistoryDialog({ propertyId, address, onClose, onPreview }: {
  propertyId: string | null; address: string; onClose: () => void; onPreview?: (visitId: string, title: string) => void;
}) {
  const { data, error, loading } = useApi<{ visits: VisitSummary[] }>(propertyId ? `/properties/${propertyId}/visits` : null);
  return (
    <Dialog open={!!propertyId} title={`History · ${address}`} onClose={onClose} side>
      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <Skeleton lines={4} />}
      {data && data.visits.length === 0 && <p className="muted">No visits recorded for this property yet.</p>}
      {data && data.visits.length > 0 && (
        <ol className="timeline">
          {data.visits.map((v) => (
            <li key={v.id} className={v.status === 'issued' ? 'is-issued' : undefined}>
              <div className="timeline__date">{fmtDay(v.scheduledAt, { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <div className="timeline__title">{v.reportNumber ?? VISIT_TYPE_LABEL[v.visitType]}</div>
              <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                <span className="pill pill--outline">{v.schemeCode}</span>
                <span className="pill">{VISIT_TYPE_LABEL[v.visitType]}</span>
                <StatusPill status={v.status} />
                {v.defects > 0 && <span className="pill pill--P">{v.defects} below good</span>}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>{v.officerName} · {v.itemsGraded}/{v.itemsTotal} graded</div>
              {onPreview && (
                <button type="button" className="btn btn--link btn--sm" style={{ paddingLeft: 0 }} onClick={() => onPreview(v.id, v.reportNumber ?? v.address)}>
                  <Icon name="eye" size={16} /> View
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

/** Assign / reassign: PATCH /visits/:id/assign { officerId, scheduledAt }. */
export function AssignDialog({ visit, onClose, onDone }: { visit: VisitSummary | null; onClose: () => void; onDone: () => void }) {
  const officers = useOfficers();
  const [officerId, setOfficerId] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visit) { setOfficerId(visit.officerId); setWhen(toLocalInput(visit.scheduledAt)); setError(null); }
  }, [visit]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!visit) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/visits/${visit.id}/assign`, { method: 'PATCH', json: { officerId, scheduledAt: fromLocalInput(when) } });
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!visit} title={visit?.officerId ? 'Assign visit' : 'Assign visit'} onClose={onClose}>
      {visit && (
        <form onSubmit={(e) => void submit(e)}>
          <p className="serif" style={{ fontSize: 18, margin: '0 0 2px' }}>{visit.address}</p>
          <p className="small muted">{visit.postcode} · {visit.schemeCode} · {VISIT_TYPE_LABEL[visit.visitType]}</p>
          <div className="field">
            <label className="field__label" htmlFor="assign-officer">Officer</label>
            <select id="assign-officer" className="select" value={officerId} onChange={(e) => setOfficerId(e.target.value)} required>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="assign-when">Date and time</label>
            <input id="assign-when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy || !officerId || !when}>{busy ? 'Saving…' : 'Save assignment'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Schedule a visit for an officer: property (search or create) + officer + time + scheme/type/rooms → POST /visits. */
export function ScheduleVisitDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const ref = useReference();
  const form = formOf(ref);
  const officers = useOfficers();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PropertyWithLandlord[]>([]);
  const [selected, setSelected] = useState<PropertyWithLandlord | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<PropertyDraft>(emptyPropertyDraft());
  const [officerId, setOfficerId] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(null));
  const [scheme, setScheme] = useState<SchemeCode>('PLS');
  const [visitType, setVisitType] = useState<VisitType>('check_in');
  const [propType, setPropType] = useState<string>('2-bed flat');
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setResults([]); setSelected(null); setCreating(false); setDraft(emptyPropertyDraft()); setError(null);
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0);
    setWhen(toLocalInput(t.toISOString()));
  }, [open]);
  useEffect(() => { if (!officerId && officers[0]) setOfficerId(officers[0].id); }, [officers, officerId]);
  useEffect(() => { if (form) setPresent(new Set(roomsForPropertyType(form, propType))); }, [form, propType]);
  useEffect(() => { if (selected && (PROPERTY_TYPES as readonly string[]).includes(selected.propertyType)) setPropType(selected.propertyType); }, [selected]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api<{ properties: PropertyWithLandlord[] }>(`/properties?q=${encodeURIComponent(q)}`).then((r) => setResults(r.properties)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const schemes = ref?.schemes?.length ? ref.schemes : SCHEMES.map((s) => ({ code: s.code, name: s.name }));
  const ready = (selected || (creating && propertyDraftReady(draft))) && officerId && when && present.size > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !form) return;
    setBusy(true);
    setError(null);
    try {
      let propertyId = selected?.id;
      if (!propertyId) {
        const req: CreatePropertyRequest = {
          id: newId(), uprn: draft.uprn || null, addressLine1: draft.addressLine1.trim(), addressLine2: draft.addressLine2.trim() || null,
          town: draft.town.trim(), postcode: (normalisePostcode(draft.postcode) ?? draft.postcode.trim()).toUpperCase(), propertyType: propType as CreatePropertyRequest['propertyType'],
          bedrooms: null, landlordId: null, landlord: null,
        };
        await api('/properties', { method: 'POST', json: req });
        propertyId = req.id;
      }
      const req: CreateVisitRequest = {
        id: newId(), propertyId, tenancyId: null, schemeCode: scheme, visitType, officerId,
        presentRoomCodes: form.rooms.filter((r) => present.has(r.code)).map((r) => r.code), scheduledAt: fromLocalInput(when),
      };
      await api('/visits', { method: 'POST', json: req });
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Schedule a visit" onClose={onClose} wide>
      {!form ? <Skeleton lines={4} /> : (
        <form onSubmit={(e) => void submit(e)}>
          <div className="two-col">
            <div>
              <h3 className="section-label" style={{ marginTop: 0 }}>Property</h3>
              {selected ? (
                <div className="card card--sunken">
                  <div className="serif" style={{ fontSize: 18, fontWeight: 600 }}>{selected.addressLine1}</div>
                  <div className="small muted">{selected.postcode} · {selected.propertyType}{selected.landlord ? ` · ${selected.landlord.company ?? selected.landlord.name}` : ''}</div>
                  <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => setSelected(null)}>Change property</button>
                </div>
              ) : creating ? (
                <div className="card card--sunken">
                  <PropertyFields value={draft} onChange={setDraft} idPrefix="sched" />
                  <button type="button" className="btn btn--sm" onClick={() => setCreating(false)}>Search instead</button>
                </div>
              ) : (
                <>
                  <label className="field__label" htmlFor="sched-search">Search address, postcode or UPRN</label>
                  <input id="sched-search" className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
                  {results.length > 0 && (
                    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }} aria-label="Matching properties">
                      {results.slice(0, 6).map((p) => (
                        <li key={p.id}>
                          <button type="button" className="room-row room-row--simple" onClick={() => setSelected(p)}>
                            <span className="room-row__name">{p.addressLine1}</span>
                            <span className="room-row__meta">{p.postcode}{p.landlord ? ` · ${p.landlord.company ?? p.landlord.name}` : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" className="btn btn--block" style={{ marginTop: 8 }} onClick={() => { setCreating(true); setDraft({ ...emptyPropertyDraft(), addressLine1: query }); }}>
                    <Icon name="plus" size={18} /> Add a new property
                  </button>
                </>
              )}

              <h3 className="section-label">Officer and time</h3>
              <div className="field-grid">
                <div className="field">
                  <label className="field__label" htmlFor="sched-officer">Officer</label>
                  <select id="sched-officer" className="select" value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
                    {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="sched-when">Date and time</label>
                  <input id="sched-when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </div>
              </div>
            </div>
            <div>
              <h3 className="section-label" style={{ marginTop: 0 }}>Visit</h3>
              <div className="field-grid">
                <div className="field">
                  <label className="field__label" htmlFor="sched-scheme">Scheme</label>
                  <select id="sched-scheme" className="select" value={scheme} onChange={(e) => setScheme(e.target.value as SchemeCode)}>
                    {schemes.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="sched-type">Visit type</label>
                  <select id="sched-type" className="select" value={visitType} onChange={(e) => setVisitType(e.target.value as VisitType)}>
                    {VISIT_TYPES.map((t) => <option key={t} value={t}>{VISIT_TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="sched-ptype">Property type — preselects the rooms</label>
                <select id="sched-ptype" className="select" value={propType} onChange={(e) => setPropType(e.target.value)}>
                  {PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field__label">Rooms ({present.size})</legend>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {form.rooms.map((r) => (
                    <label key={r.code} className="checkrow" style={{ marginBottom: 0, minHeight: 44 }}>
                      <input type="checkbox" checked={present.has(r.code)} onChange={() => setPresent((s) => { const n = new Set(s); if (n.has(r.code)) n.delete(r.code); else n.add(r.code); return n; })} />
                      <span style={{ fontSize: 14 }}>{roomDisplayName(r.label)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy || !ready}>{busy ? 'Scheduling…' : 'Schedule visit'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export { fmtDateTime };
