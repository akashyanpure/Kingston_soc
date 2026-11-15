import { useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { DEFECT_CONDITIONS, type ItemRecord } from '@soc/shared';
import { AutoField, ProgressBar } from '../components/fields';
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
  const abbreviations = useMemo(() => (form ? parseAbbreviations(form.boilerplate.abbreviations) : []), [form]);
  const loc = useLocation();
  useHashTarget(!!data && !!form, loc.hash);

  if (data === undefined || ref === undefined) return null;
  if (data === null) {
    return (
      <div>
        <Link to="/" className="back-link">← My visits</Link>
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
      <Link to="/" className="back-link">← My visits</Link>
      <div className="kicker">{visit.schemeCode} · {VISIT_TYPE_LABEL[visit.visitType]} · {property?.propertyType}</div>
      <h1 className="title title--sm">{addressOf(property)}{property ? `, ${property.postcode}` : ''}</h1>

      <div className="row small muted"><span>{p.graded} of {p.total} items graded · {p.defects} below good</span><span>{p.pct}%</span></div>
      <ProgressBar pct={p.pct} label={`${p.pct}% of items graded`} large />

      <div className="btn-grid">
        <button type="button" className="btn btn--sm" onClick={() => void doMarkAll()}>MARK ALL AS GOOD</button>
        <Link to={`/visits/${visit.id}/review`} className="btn btn--sm">REVIEW &amp; SIGN OFF</Link>
      </div>
      {message && <div className="notice" role="status">{message}</div>}

      <h2 className="section-label">Rooms</h2>
      {present.length === 0 && <div className="notice notice--grey">No rooms marked present. Add rooms below.</div>}
      {present.map((r) => {
        const ri = items.filter((i) => i.roomInstanceId === r.id);
        const rp = progressOf(ri);
        const missingPhoto = ri.filter((i) => i.condition && DEFECT_CONDITIONS.includes(i.condition) && photosByItem(i.id).length === 0).length;
        const noWide = !r.widePhotoId || !photos.some((ph) => ph.id === r.widePhotoId && !ph.deletedAt);
        const flags = [
          rp.defects && `${rp.defects} below good`,
          missingPhoto && `${missingPhoto} photo${missingPhoto > 1 ? 's' : ''} missing`,
          noWide && 'wide photo needed',
        ].filter(Boolean);
        return (
          <Link key={r.id} to={`/visits/${visit.id}/rooms/${r.id}`} className="room-row">
            <span className="row">
              <span className="room-row__name">{r.label}</span>
              <span className="small muted">{rp.graded}/{rp.total}</span>
            </span>
            <ProgressBar pct={rp.pct} label={`${r.label}: ${rp.pct}% graded`} />
            {flags.length > 0 && <span className="room-row__flag" style={{ display: 'block' }}>{flags.join(' · ')}</span>}
          </Link>
        );
      })}

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
                  {photo.some((x) => !x.deletedAt) ? 'RETAKE METER PHOTO' : '+ METER PHOTO'}
                </button>
                <PhotoThumbs photos={photo} label={`${m.label} meter`} />
              </fieldset>
            );
          })}
        </div>
      </details>

      <details className="disclosure" id="misc">
        <summary>{form.miscellaneous.label} ({misc.length})</summary>
        <div className="disclosure__body">
          <p className="small muted">Items not in the room lists. Name each one.</p>
          {misc.map((i) => (
            <ItemCard key={i.id} item={i} form={form} roomLabel={form.miscellaneous.label} phrases={phrasesFor(ref, i.itemCode)}
              abbreviations={abbreviations} photos={photosByItem(i.id)} editableLabel />
          ))}
          <button type="button" className="btn btn--block" onClick={addMisc}>+ ADD MISCELLANEOUS ITEM</button>
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

      <Link to={`/visits/${visit.id}/review`} className="btn btn--primary btn--block" style={{ marginTop: 6 }}>REVIEW &amp; SIGN OFF →</Link>
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
      <button type="submit" className="btn btn--block" disabled={!note.trim() || !addedBy.trim()}>+ ADD NOTE</button>
    </form>
  );
}
