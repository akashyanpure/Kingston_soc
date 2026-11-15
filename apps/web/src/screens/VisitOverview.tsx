import { useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { DEFECT_CONDITIONS, roomDisplayName, type ItemRecord } from '@soc/shared';
import { AutoField } from '../components/fields';
import { Icon, ProgressRing, ScreenSkeleton } from '../components/ui';
import { ItemCard } from '../components/ItemCard';
import { PhotoThumbs } from '../components/PhotoThumbs';
import { progressOf, relevantItems, useHashTarget } from '../lib/hooks';
import { createRow, markAllGood, newId, saveEdit } from '../lib/mutations';
import { formOf, parseAbbreviations, phrasesFor, useReference } from '../lib/reference';
import { useSession } from '../lib/session';
import { syncEngine } from '../lib/sync';
import { setRoomPresent } from '../lib/visitFactory';
import { VISIT_TYPE_LABEL, addressOf, useVisit } from '../lib/visitData';

const after = (p: Promise<unknown>) => void p.then(() => syncEngine.notifyChange());
const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function VisitOverview() {
  const { visitId } = useParams();
  const nav = useNavigate();
  const data = useVisit(visitId);
  const ref = useReference();
  const session = useSession();
  const form = formOf(ref);
  const [message, setMessage] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const abbreviations = useMemo(() => (form ? parseAbbreviations(form.boilerplate.abbreviations) : []), [form]);
  const loc = useLocation();
  useHashTarget(!!data && !!form, loc.hash);

  if (data === undefined || ref === undefined) return <ScreenSkeleton cards={4} />;
  if (data === null) {
    return (
      <div>
        <Link to="/" className="back-link"><Icon name="chevronLeft" size={18} /> My visits</Link>
        <div className="notice notice--strong">This visit is not on this phone. Connect to download it.</div>
      </div>
    );
  }
  if (data.visit.status === 'issued') return <Navigate to={`/visits/${data.visit.id}/done`} replace />;
  if (!form) return <div className="notice notice--strong">The form has not been downloaded yet. Connect once to fetch it.</div>;

  const { visit, property, rooms, items, photos, general, appliances, meters, notes } = data;
  const present = rooms.filter((r) => r.present);
  const absent = rooms.filter((r) => !r.present);
  const p = progressOf(relevantItems(rooms, items));
  const misc = items.filter((i) => i.roomInstanceId === null);
  const photosByItem = (id: string) => photos.filter((ph) => ph.itemRecordId === id && !ph.deletedAt);

  const doMarkAll = async () => {
    const n = await markAllGood(visit.id);
    syncEngine.notifyChange();
    if (n) setCelebrate((c) => c + 1);
    setMessage(n ? `${n} ungraded item${n === 1 ? '' : 's'} marked Good. Now change only what is wrong.` : 'Nothing left to mark — every item in the present rooms is graded.');
  };

  const toggleRoom = async (roomId: string, on: boolean) => {
    const room = rooms.find((r) => r.id === roomId)!;
    const roomItems = items.filter((i) => i.roomInstanceId === roomId);
    if (!on && roomItems.some((i) => i.condition !== null) && !confirm(`${room.label} has graded items. Leave it out of the report?`)) return;
    await setRoomPresent(form, room, on, roomItems.length);
    syncEngine.notifyChange();
  };

  const saveGeneral = (fieldCode: string, value: string) => {
    const row = general.find((g) => g.fieldCode === fieldCode);
    if (row) after(saveEdit('visit_general', row.id, { value }));
    else after(createRow('visit_general', { id: newId(), visitId: visit.id, fieldCode, value }));
  };
  const saveAppliance = (code: string, field: 'make' | 'model' | 'serial', v: string) => {
    const row = appliances.find((a) => a.applianceCode === code);
    if (row) after(saveEdit('appliance', row.id, { [field]: orNull(v) }));
    else after(createRow('appliance', { id: newId(), visitId: visit.id, applianceCode: code, make: null, model: null, serial: null, [field]: orNull(v) }));
  };
  const saveMeter = (service: string, field: 'location' | 'readingIn' | 'readingOut', v: string) => {
    const row = meters.find((m) => m.service === service);
    if (row) after(saveEdit('meter_reading', row.id, { [field]: orNull(v) }));
    else after(createRow('meter_reading', { id: newId(), visitId: visit.id, service, location: null, readingIn: null, readingOut: null, photoId: null, [field]: orNull(v) }));
  };
  const meterPhoto = async (service: string) => {
    let meterId = meters.find((m) => m.service === service)?.id;
    if (!meterId) {
      meterId = newId();
      await createRow('meter_reading', { id: meterId, visitId: visit.id, service, location: null, readingIn: null, readingOut: null, photoId: null });
    }
    nav(`/visits/${visit.id}/photo?kind=meter&meter=${meterId}`, { state: { returnTo: `/visits/${visit.id}#meters` } });
  };
  const addMisc = () => {
    const row: Omit<ItemRecord, 'updatedAt' | 'updatedBy'> = {
      id: newId(), visitId: visit.id, roomInstanceId: null, itemCode: null, label: 'New item', sortOrder: misc.length,
      qty: 1, description: null, condition: null, naReason: null, comment: null, dilapidation: null,
    };
    after(createRow('item_record', row));
  };

  return (
    <div>
      <Link to="/" className="back-link"><Icon name="chevronLeft" size={18} /> My visits</Link>
      <section className="card hero" aria-labelledby="visit-h">
        <div>
          <div className="chiprow">
            <span className="pill pill--outline">{visit.schemeCode}</span>
            <span className="pill">{VISIT_TYPE_LABEL[visit.visitType]}</span>
            {property?.propertyType && <span className="pill">{property.propertyType}</span>}
          </div>
          <h1 id="visit-h" className="hero__addr">{addressOf(property)}</h1>
          <div className="hero__meta">{property?.postcode}{property?.town ? ` · ${property.town}` : ''}</div>
        </div>
        <ProgressRing pct={p.pct} size={92} stroke={8} label={`${p.pct}% of items graded`}>
          <span style={{ fontSize: 24 }}>{p.pct}<small>%</small></span>
        </ProgressRing>
        <div className="hero__stats">
          <span><strong>{p.graded}</strong>of {p.total} graded</span>
          <span><strong style={p.defects ? { color: 'var(--p-ink)' } : undefined}>{p.defects}</strong>below good</span>
          <span><strong>{present.length}</strong>rooms</span>
        </div>
      </section>

      <div className="btn-grid">
        <button key={celebrate} type="button" className={`btn btn--primary${celebrate ? ' btn--celebrate' : ''}`} onClick={() => void doMarkAll()}>
          <Icon name={celebrate ? 'check' : 'sparkle'} size={18} /> Mark all as good
        </button>
        <Link to={`/visits/${visit.id}/review`} className="btn">Review &amp; sign <Icon name="chevronRight" size={18} /></Link>
      </div>
      {message && <div className={`notice${celebrate ? ' notice--success' : ''}`} role="status">{message}</div>}

      <h2 className="section-label">Rooms</h2>
      {present.length === 0 && <div className="notice notice--grey">No rooms marked present. Add rooms below.</div>}
      <div className="room-grid">
      {present.map((r) => {
        const ri = items.filter((i) => i.roomInstanceId === r.id);
        const rp = progressOf(ri);
        const missingPhoto = ri.filter((i) => i.condition && DEFECT_CONDITIONS.includes(i.condition) && photosByItem(i.id).length === 0).length;
        const noWide = !r.widePhotoId || !photos.some((ph) => ph.id === r.widePhotoId && !ph.deletedAt);
        const done = rp.total > 0 && rp.graded === rp.total && !noWide && !missingPhoto;
        return (
          <Link key={r.id} to={`/visits/${visit.id}/rooms/${r.id}`} className="room-row">
            <ProgressRing pct={rp.pct} size={46} stroke={4} label={`${rp.pct}% graded`}>
              {done ? <Icon name="check" size={18} style={{ color: 'var(--brass-ink)' }} /> : <span style={{ fontSize: 13 }}>{rp.pct}</span>}
            </ProgressRing>
            <span>
              <span className="room-row__name">{roomDisplayName(r.label)}</span>
              <span className="room-row__meta num">{rp.graded}/{rp.total} graded</span>
              {(rp.defects > 0 || missingPhoto > 0 || noWide) && (
                <span className="room-row__flag">
                  {rp.defects > 0 && <span className="pill pill--P num">{rp.defects} below good</span>}
                  {missingPhoto > 0 && <span className="pill pill--alert num">{missingPhoto} photo{missingPhoto > 1 ? 's' : ''} missing</span>}
                  {noWide && <span className="pill pill--F"><Icon name="camera" size={13} /> wide photo</span>}
                </span>
              )}
            </span>
            <Icon name="chevronRight" size={18} className="room-row__chev" />
          </Link>
        );
      })}
      </div>
      <div style={{ height: 12 }} />

      <details className="disclosure">
        <summary>Rooms in this property ({present.length}/{rooms.length})</summary>
        <div className="disclosure__body">
          <p className="small muted">Rooms not present are left out of the report.</p>
          {[...present, ...absent].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => (
            <label key={r.id} className="checkrow">
              <input type="checkbox" checked={r.present} onChange={(e) => void toggleRoom(r.id, e.target.checked)} />
              <span className="checkrow__label">{r.label}</span>
            </label>
          ))}
        </div>
      </details>

      <details className="disclosure" id="general">
        <summary>Schedule of condition (general)</summary>
        <div className="disclosure__body">
          {form.general.map((g) => {
            const row = general.find((x) => x.fieldCode === g.code);
            const multiline = g.code === 'DESCRIPTION_OF_PROPERTY' || g.code === 'GENERAL_CONDITION';
            return (
              <AutoField key={g.code} label={g.label} capsLabel multiline={multiline} value={row?.value ?? g.defaultValue ?? ''}
                onSave={(v) => saveGeneral(g.code, v)} />
            );
          })}
        </div>
      </details>

      <details className="disclosure">
        <summary>Kitchen appliances</summary>
        <div className="disclosure__body">
          {form.appliances.map((a) => {
            const row = appliances.find((x) => x.applianceCode === a.code);
            return (
              <fieldset key={a.code} style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
                <legend className="section-label" style={{ marginTop: 6 }}>{a.label}</legend>
                <div className="field-grid">
                  <AutoField label="Make" value={row?.make} onSave={(v) => saveAppliance(a.code, 'make', v)} />
                  <AutoField label="Model" value={row?.model} onSave={(v) => saveAppliance(a.code, 'model', v)} />
                </div>
                <AutoField label="Serial number" value={row?.serial} onSave={(v) => saveAppliance(a.code, 'serial', v)} />
              </fieldset>
            );
          })}
        </div>
      </details>

      <details className="disclosure" id="meters">
        <summary>Meter readings</summary>
        <div className="disclosure__body">
          {form.meters.map((m) => {
            const row = meters.find((x) => x.service === m.code);
            const photo = row?.photoId ? photos.filter((ph) => ph.id === row.photoId) : [];
            return (
              <fieldset key={m.code} style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
                <legend className="section-label" style={{ marginTop: 6 }}>{m.label}</legend>
                <AutoField label="Location" value={row?.location} onSave={(v) => saveMeter(m.code, 'location', v)} />
                {m.code !== 'STOPCOCK' && (
                  <div className="field-grid">
                    <AutoField label="Reading in" inputMode="decimal" value={row?.readingIn} onSave={(v) => saveMeter(m.code, 'readingIn', v)} />
                    <AutoField label="Reading out" inputMode="decimal" value={row?.readingOut} onSave={(v) => saveMeter(m.code, 'readingOut', v)} />
                  </div>
                )}
                <button type="button" className="btn btn--sm" onClick={() => void meterPhoto(m.code)}>
                  {photo.some((x) => !x.deletedAt) ? 'Retake meter photo' : '+ Meter photo'}
                </button>
                <PhotoThumbs photos={photo} label={`${m.label} meter`} />
              </fieldset>
            );
          })}
        </div>
      </details>

      <details className="disclosure" id="misc">
        <summary>{roomDisplayName(form.miscellaneous.label)} ({misc.length})</summary>
        <div className="disclosure__body">
          <p className="small muted">Items not in the room lists. Name each one.</p>
          {misc.map((i) => (
            <ItemCard key={i.id} item={i} form={form} roomLabel={form.miscellaneous.label} phrases={phrasesFor(ref, i.itemCode)}
              abbreviations={abbreviations} photos={photosByItem(i.id)} editableLabel />
          ))}
          <button type="button" className="btn btn--block" onClick={addMisc}><Icon name="plus" size={18} /> Add miscellaneous item</button>
        </div>
      </details>

      <details className="disclosure" id="notes">
        <summary>Additional notes ({notes.length})</summary>
        <div className="disclosure__body">
          <p className="small muted">{form.additionalNotes.rule}</p>
          {notes.map((n) => (
            <div key={n.id} className="card card--plain" style={{ marginBottom: 8 }}>
              <div className="small muted">{n.noteDate} · {n.addedBy}{n.signed ? ` · signed ${n.signed}` : ''}</div>
              <div>{n.note}</div>
            </div>
          ))}
          <NoteForm visitId={visit.id} defaultAddedBy={session?.name ?? ''} />
        </div>
      </details>

      <Link to={`/visits/${visit.id}/review`} className="btn btn--primary btn--block btn--lg" style={{ marginTop: 8 }}>Review &amp; sign off <Icon name="chevronRight" size={18} /></Link>
    </div>
  );
}

function NoteForm({ visitId, defaultAddedBy }: { visitId: string; defaultAddedBy: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [noteDate, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [addedBy, setAddedBy] = useState(defaultAddedBy);
  const [signed, setSigned] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim() || !addedBy.trim()) return;
    await createRow('additional_note', { id: newId(), visitId, noteDate, note: note.trim(), addedBy: addedBy.trim(), signed: signed.trim() || null });
    syncEngine.notifyChange();
    setNote('');
    setSigned('');
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Add a note">
      <div className="field-grid">
        <div className="field"><label className="field__label" htmlFor="nf-date">Date</label>
          <input id="nf-date" className="input" type="date" value={noteDate} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label className="field__label" htmlFor="nf-by">Added by</label>
          <input id="nf-by" className="input" value={addedBy} onChange={(e) => setAddedBy(e.target.value)} /></div>
      </div>
      <div className="field"><label className="field__label" htmlFor="nf-note">Note</label>
        <textarea id="nf-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="field"><label className="field__label" htmlFor="nf-signed">Signed (initials of both parties)</label>
        <input id="nf-signed" className="input" value={signed} onChange={(e) => setSigned(e.target.value)} /></div>
      <button type="submit" className="btn btn--block" disabled={!note.trim() || !addedBy.trim()}><Icon name="plus" size={18} /> Add note</button>
    </form>
  );
}
