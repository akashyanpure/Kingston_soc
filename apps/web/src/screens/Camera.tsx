import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { photoStamp, roomDisplayName } from '@soc/shared';
import { useBlobUrl } from '../lib/hooks';
import { attachPhoto, processPhoto, roomPosition, type Coords, type PhotoTarget, type ProcessedPhoto } from '../lib/photo';
import { useSession } from '../lib/session';
import { syncEngine } from '../lib/sync';
import { addressOf, useVisit } from '../lib/visitData';

const GPS_WAIT_MS = 3000;

export function Camera() {
  const { visitId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const data = useVisit(visitId);
  const session = useSession();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<'starting' | 'live' | 'file'>('starting');
  const [shot, setShot] = useState<{ processed: ProcessedPhoto; stamp: string; capturedAt: Date; coords: Coords | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const previewUrl = useBlobUrl(shot?.processed.blob);

  const kind = params.get('kind') ?? 'item';
  const roomId = params.get('room');
  const itemId = params.get('item');
  const meterId = params.get('meter');
  const returnTo = (loc.state as { returnTo?: string } | null)?.returnTo ?? `/visits/${visitId}`;

  // Live camera when we have a secure context; otherwise the native capture input.
  useEffect(() => {
    let cancelled = false;
    const canLive = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
    if (!canLive) { setMode('file'); return; }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setMode('live');
      })
      .catch(() => setMode('file'));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (roomId) void roomPosition(roomId); }, [roomId]);

  if (data === undefined || session === undefined) return null;
  if (!data || !session) return <p className="error-text">Visit not found on this phone.</p>;

  const { visit, property } = data;
  const room = data.rooms.find((r) => r.id === roomId) ?? null;
  const item = data.items.find((i) => i.id === itemId) ?? null;
  const meter = data.meters.find((m) => m.id === meterId) ?? null;
  const roomName = kind === 'meter' ? 'Meters' : room ? roomDisplayName(room.label) : 'Miscellaneous';
  const itemName = kind === 'wide' ? 'Wide' : kind === 'meter' ? `${meter?.service ?? ''} meter`.trim() : item?.label ?? null;
  const title = kind === 'wide' ? `${roomName} — wide photo` : `${roomName} / ${itemName ?? ''}`;

  let target: PhotoTarget | null = null;
  if (kind === 'wide' && room) target = { kind: 'wide', roomInstanceId: room.id };
  else if (kind === 'meter' && meter) target = { kind: 'meter', meterId: meter.id };
  else if (kind === 'item' && item) target = { kind: 'item', roomInstanceId: item.roomInstanceId, itemRecordId: item.id };

  const stampFor = (capturedAt: Date, coords: Coords | null) =>
    photoStamp({
      address: addressOf(property), postcode: property?.postcode ?? '', capturedAt, lat: coords?.lat ?? null, lng: coords?.lng ?? null,
      scheme: visit.schemeCode, reportRef: visit.reportNumber ?? 'DRAFT', room: roomName, item: itemName, officer: session.name,
    });

  const capture = async (source: Blob | HTMLVideoElement) => {
    setBusy(true);
    setError(null);
    try {
      const capturedAt = new Date();
      const coords = await Promise.race([
        roomPosition(roomId ?? `visit:${visit.id}`),
        new Promise<null>((r) => setTimeout(() => r(null), GPS_WAIT_MS)),
      ]);
      const stamp = stampFor(capturedAt, coords);
      const processed = await processPhoto(source, stamp);
      setShot({ processed, stamp, capturedAt, coords });
    } catch (e) {
      setError((e as Error).message || 'Could not take the photo.');
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    if (!shot || !target) return;
    setBusy(true);
    try {
      await attachPhoto(visit.id, target, shot.processed, { stampText: shot.stamp, capturedAt: shot.capturedAt, coords: shot.coords });
      syncEngine.notifyChange(2000);
      nav(returnTo, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="back-link" onClick={() => nav(returnTo, { replace: true })}>← Cancel</button>
      <div className="kicker">Evidence photo</div>
      <h1 className="title title--sm">{title}</h1>
      {!target && <p className="error-text" role="alert">Nothing to attach this photo to.</p>}

      <div className="viewfinder">
        {shot && previewUrl ? (
          <img src={previewUrl} alt={`Stamped photo: ${title}`} />
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay aria-label="Camera viewfinder" hidden={mode !== 'live'} />
            {mode !== 'live' && <span className="mono" style={{ color: '#f2f2f3' }}>{mode === 'starting' ? 'Starting camera…' : 'Use the button below to open the camera'}</span>}
            <div className="viewfinder__stamp" aria-hidden="true">{stampFor(now, null).replace('GPS unavailable', 'GPS on capture')}</div>
          </>
        )}
      </div>
      <p className="small muted" style={{ margin: '10px 0 12px' }}>
        The stamp is burned into the image, so the photo can't drift away from the item, the property or the date.
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}

      {shot ? (
        <div className="btn-grid">
          <button type="button" className="btn" onClick={() => setShot(null)} disabled={busy}>RETAKE</button>
          <button type="button" className="btn btn--primary" onClick={() => void attach()} disabled={busy || !target}>
            {kind === 'wide' ? 'USE AS WIDE PHOTO' : kind === 'meter' ? 'ATTACH TO METER' : 'ATTACH TO ITEM'}
          </button>
        </div>
      ) : mode === 'live' ? (
        <button type="button" className="shutter" aria-label="Take photo" disabled={busy}
          onClick={() => videoRef.current && void capture(videoRef.current)} />
      ) : (
        <>
          <input
            ref={fileRef} id="photo-file" type="file" accept="image/*" capture="environment" className="visually-hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void capture(f); }}
          />
          <label htmlFor="photo-file" className="btn btn--primary btn--block" aria-disabled={busy}>
            {busy ? 'PROCESSING…' : 'OPEN CAMERA'}
          </label>
        </>
      )}
      {mode === 'live' && !shot && (
        <button type="button" className="btn btn--link btn--block" onClick={() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setMode('file'); }}>
          Use the phone's camera app instead
        </button>
      )}
    </div>
  );
}
