import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { roomDisplayName, type ItemRecord } from '@soc/shared';
import { Icon, ProgressRing, ScreenSkeleton } from '../components/ui';
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

  if (data === undefined || ref === undefined) return <ScreenSkeleton cards={3} />;
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
      <Link to={`/visits/${data.visit.id}`} className="back-link"><Icon name="chevronLeft" size={18} /> All rooms</Link>
      <div className="row row--top" style={{ marginBottom: 14 }}>
        <div>
          <div className="kicker">Room {idx + 1} of {presentRooms.length}</div>
          <h1 className="title" style={{ margin: '4px 0 6px' }}>{roomDisplayName(room.label)}</h1>
          <div className="chiprow">
            <span className="pill pill--teal num">{p.graded}/{p.total} graded</span>
            {p.defects > 0 && <span className="pill pill--P num">{p.defects} below good</span>}
          </div>
        </div>
        <ProgressRing pct={p.pct} size={64} label={`${room.label}: ${p.pct}% graded`} />
      </div>

      <section className="card" id="wide" aria-labelledby="wide-h">
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 id="wide-h" className="item__name">Wide room photo</h2>
          <span className={`pill${wide ? ' pill--G' : ' pill--F'}`}>{wide ? <><Icon name="check" size={13} /> Taken</> : 'Required'}</span>
        </div>
        {wideUrl ? (
          <img src={wideUrl} className="wide-photo" alt={`Wide photo of ${room.label}`} />
        ) : wide ? (
          <div className="stripe wide-photo" role="img" aria-label="Wide photo stored on the server" />
        ) : (
          <button type="button" className="placeholder-photo" style={{ width: '100%', cursor: 'pointer' }} onClick={takeWide}>
            <Icon name="camera" size={28} style={{ color: 'var(--teal)' }} />
            <span>One photo of the whole room, from the doorway.<br />Needed before the report can issue.</span>
          </button>
        )}
        <div className="btn-grid" style={{ marginTop: 12, marginBottom: 0 }}>
          <button type="button" className={`btn btn--sm${wide ? '' : ' photo-btn--required'}`} onClick={takeWide}>
            <Icon name="camera" size={18} /> {wide ? 'Retake' : 'Take wide photo'}
          </button>
          {wide && <button type="button" className="btn btn--sm btn--danger" onClick={() => { if (confirm('Delete the wide photo?')) void deletePhoto(wide.id); }}><Icon name="trash" size={16} /> Delete</button>}
        </div>
      </section>

      <div className="btn-grid">
        <button type="button" className="btn btn--primary" onClick={() => void allGood()}><Icon name="sparkle" size={18} /> All good in here</button>
        <button type="button" className="btn" onClick={() => void notPresent()}>Not in property</button>
      </div>
      {message && <div className="notice notice--success" role="status">{message}</div>}

      {items.map((i) => (
        <ItemCard
          key={i.id} item={i} form={form} roomLabel={room.label} phrases={phrasesFor(ref, i.itemCode)} abbreviations={abbreviations}
          photos={data.photos.filter((ph) => ph.itemRecordId === i.id)} highlighted={target === `item-${i.id}`}
        />
      ))}

      <form className="card card--sunken" onSubmit={(e) => void addItem(e)} aria-label="Add a one-off item">
        <label className="field__label" htmlFor="new-item">Add a one-off item to {roomDisplayName(room.label)}</label>
        <div className="row">
          <input id="new-item" className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Ceiling fan" />
          <button type="submit" className="btn" disabled={!newLabel.trim()}><Icon name="plus" size={18} /> Add</button>
        </div>
      </form>

      <div className="btn-grid" style={{ marginTop: 8 }}>
        <Link to={`/visits/${data.visit.id}`} className="btn">All rooms</Link>
        {next ? (
          <Link to={`/visits/${data.visit.id}/rooms/${next.id}`} className="btn btn--primary">Next room <Icon name="chevronRight" size={18} /></Link>
        ) : (
          <Link to={`/visits/${data.visit.id}/review`} className="btn btn--primary">Review <Icon name="chevronRight" size={18} /></Link>
        )}
      </div>
    </div>
  );
}
