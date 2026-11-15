import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { ItemRecord } from '@soc/shared';
import { Corners, ProgressBar } from '../components/fields';
import { ItemCard } from '../components/ItemCard';
import { progressOf, useBlobUrl, useHashTarget } from '../lib/hooks';
import { createRow, markAllGood, newId } from '../lib/mutations';
import { deletePhoto, roomPosition } from '../lib/photo';
import { formOf, parseAbbreviations, phrasesFor, useReference } from '../lib/reference';
import { syncEngine } from '../lib/sync';
import { setRoomPresent } from '../lib/visitFactory';
import { useVisit } from '../lib/visitData';

export function Room() {
  const { visitId, roomId } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const data = useVisit(visitId);
  const ref = useReference();
  const form = formOf(ref);
  const abbreviations = useMemo(() => (form ? parseAbbreviations(form.boilerplate.abbreviations) : []), [form]);
  const [message, setMessage] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const target = useHashTarget(!!data && !!form, loc.hash);

  // Ask for GPS once when the room opens, so the fix is ready by the first photo.
  useEffect(() => { if (roomId) void roomPosition(roomId); }, [roomId]);
  useEffect(() => { setMessage(null); window.scrollTo?.(0, 0); }, [roomId]);

  const room = data?.rooms.find((r) => r.id === roomId);
  const wide = data?.photos.find((p) => p.id === room?.widePhotoId && !p.deletedAt);
  const wideUrl = useBlobUrl(wide?.blob);

  if (data === undefined || ref === undefined) return null;
  if (!data || !room || !form) return <Navigate to={visitId ? `/visits/${visitId}` : '/'} replace />;
  if (data.visit.status === 'issued') return <Navigate to={`/visits/${data.visit.id}/done`} replace />;

  const items = data.items.filter((i) => i.roomInstanceId === room.id);
  const p = progressOf(items);
  const presentRooms = data.rooms.filter((r) => r.present);
  const idx = presentRooms.findIndex((r) => r.id === room.id);
  const next = presentRooms[idx + 1];

  const allGood = async () => {
    const n = await markAllGood(data.visit.id, room.id);
    syncEngine.notifyChange();
    setMessage(n ? `${n} item${n === 1 ? '' : 's'} marked Good.` : 'Every item in this room is already graded.');
  };
  const notPresent = async () => {
    if (!confirm(`Leave ${room.label} out of the report?`)) return;
    await setRoomPresent(form, room, false, items.length);
    syncEngine.notifyChange();
    nav(`/visits/${data.visit.id}`);
  };
  const addItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    const row: Omit<ItemRecord, 'updatedAt' | 'updatedBy'> = {
      id: newId(), visitId: data.visit.id, roomInstanceId: room.id, itemCode: null, label: newLabel.trim().toUpperCase(),
      sortOrder: items.length ? Math.max(...items.map((i) => i.sortOrder)) + 1 : 0,
      qty: 1, description: null, condition: null, naReason: null, comment: null, dilapidation: null,
    };
    await createRow('item_record', row);
    syncEngine.notifyChange();
    setNewLabel('');
  };
  const takeWide = () =>
    nav(`/visits/${data.visit.id}/photo?kind=wide&room=${room.id}`, { state: { returnTo: `/visits/${data.visit.id}/rooms/${room.id}` } });

  return (
    <div>
      <Link to={`/visits/${data.visit.id}`} className="back-link">← All rooms</Link>
      <div className="row row--top" style={{ marginBottom: 10 }}>
        <h1 className="title" style={{ margin: 0 }}>{room.label}</h1>
        <div className="small muted" style={{ textAlign: 'right' }}>{p.graded}/{p.total} graded{p.defects ? <><br />{p.defects} below good</> : null}</div>
      </div>
      <ProgressBar pct={p.pct} label={`${room.label}: ${p.pct}% graded`} large />

      <section className="card" id="wide" aria-labelledby="wide-h">
        <Corners />
        <div className="row">
          <h2 id="wide-h" className="item__name">WIDE ROOM PHOTO</h2>
          <span className={`pill${wide ? ' pill--teal' : ''}`}>{wide ? 'Taken' : 'Required'}</span>
        </div>
        {wideUrl ? (
          <img src={wideUrl} className="wide-photo" alt={`Wide photo of ${room.label}`} style={{ marginTop: 8 }} />
        ) : wide ? (
          <div className="stripe wide-photo" role="img" aria-label="Wide photo stored on the server" style={{ marginTop: 8 }} />
        ) : (
          <p className="small muted" style={{ margin: '6px 0' }}>One photo of the whole room, taken from the doorway. Needed before the report can issue.</p>
        )}
        <div className="btn-grid" style={{ marginTop: 8, marginBottom: 0 }}>
          <button type="button" className={`btn btn--sm${wide ? '' : ' photo-btn--required'}`} onClick={takeWide}>{wide ? 'RETAKE' : 'TAKE WIDE PHOTO'}</button>
          {wide && <button type="button" className="btn btn--sm btn--danger" onClick={() => { if (confirm('Delete the wide photo?')) void deletePhoto(wide.id); }}>DELETE</button>}
        </div>
      </section>

      <div className="btn-grid">
        <button type="button" className="btn btn--sm" onClick={() => void allGood()}>ALL GOOD IN HERE</button>
        <button type="button" className="btn btn--sm" onClick={() => void notPresent()}>NOT IN THIS PROPERTY</button>
      </div>
      {message && <div className="notice" role="status">{message}</div>}

      {items.map((i) => (
        <ItemCard
          key={i.id} item={i} form={form} roomLabel={room.label} phrases={phrasesFor(ref, i.itemCode)} abbreviations={abbreviations}
          photos={data.photos.filter((ph) => ph.itemRecordId === i.id)} highlighted={target === `item-${i.id}`}
        />
      ))}

      <form className="card card--plain" onSubmit={(e) => void addItem(e)} aria-label="Add a one-off item">
        <label className="field__label" htmlFor="new-item">Add a one-off item to {room.label.toLowerCase()}</label>
        <div className="row">
          <input id="new-item" className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. CEILING FAN" />
          <button type="submit" className="btn" disabled={!newLabel.trim()}>ADD</button>
        </div>
      </form>

      <div className="btn-grid" style={{ marginTop: 4 }}>
        <Link to={`/visits/${data.visit.id}`} className="btn">ALL ROOMS</Link>
        {next ? (
          <Link to={`/visits/${data.visit.id}/rooms/${next.id}`} className="btn btn--primary">NEXT ROOM →</Link>
        ) : (
          <Link to={`/visits/${data.visit.id}/review`} className="btn btn--primary">REVIEW →</Link>
        )}
      </div>
    </div>
  );
}
