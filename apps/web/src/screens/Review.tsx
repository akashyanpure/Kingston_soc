import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { issueBlockers, SCHEMES, type Blocker, type SignatureRole, type VisitBundle } from '@soc/shared';
import { renderReportHtml } from '@soc/report';
import { Corners } from '../components/fields';
import { SignaturePad } from '../components/SignaturePad';
import { db, type SignatureDraft } from '../lib/db';
import { progressOf, relevantItems, useOnline } from '../lib/hooks';
import { formOf, useReference } from '../lib/reference';
import { useSession } from '../lib/session';
import { queueIssue, syncEngine } from '../lib/sync';
import { useVisit, type VisitData } from '../lib/visitData';

function blockerHref(visitId: string, b: Blocker): string {
  if (b.code === 'GENERAL_MISSING') return `/visits/${visitId}#general`;
  if (b.code === 'NO_ROOMS_PRESENT') return `/visits/${visitId}`;
  if (b.code === 'ROOM_NO_WIDE_PHOTO' && b.roomInstanceId) return `/visits/${visitId}/rooms/${b.roomInstanceId}#wide`;
  if (b.roomInstanceId && b.itemRecordId) return `/visits/${visitId}/rooms/${b.roomInstanceId}#item-${b.itemRecordId}`;
  if (b.itemRecordId) return `/visits/${visitId}#item-${b.itemRecordId}`; // miscellaneous
  return `/visits/${visitId}`;
}

export function Review() {
  const { visitId } = useParams();
  const nav = useNavigate();
  const online = useOnline();
  const data = useVisit(visitId);
  const ref = useReference();
  const session = useSession();
  const form = formOf(ref);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const drafts = useLiveQuery(() => (visitId ? db.signatureDrafts.where('visitId').equals(visitId).toArray() : []), [visitId]);
  const action = useLiveQuery(
    () => (visitId ? db.pendingActions.where('visitId').equals(visitId).filter((a) => a.kind === 'issue' && a.status !== 'done').first() : undefined),
    [visitId],
  );

  const blockers = useMemo(() => (data ? issueBlockers({ rooms: data.rooms, items: data.items, photos: data.photos, general: data.general }) : []), [data]);

  // Once the queued issue completes (now or after reconnecting), go to the Done screen.
  useEffect(() => {
    if (data?.visit.status === 'issued') nav(`/visits/${data.visit.id}/done`, { replace: true });
  }, [data?.visit.status, data?.visit.id, nav]);

  if (data === undefined || ref === undefined || session === undefined) return null;
  if (!data || !form) return <Navigate to="/" replace />;

  const { visit } = data;
  const items = relevantItems(data.rooms, data.items);
  const p = progressOf(items);
  const livePhotos = data.photos.filter((ph) => !ph.deletedAt).length;
  const uploading = data.photos.filter((ph) => !ph.deletedAt && !ph.uploaded).length;
  const draftFor = (role: SignatureRole): SignatureDraft =>
    drafts?.find((d) => d.role === role) ?? {
      key: `${visit.id}:${role}`, visitId: visit.id, role, name: role === 'officer' ? session?.name ?? '' : '', imageDataUrl: null, signedAt: null,
    };
  const saveDraft = (role: SignatureRole, patch: Partial<SignatureDraft>) => {
    const cur = draftFor(role);
    void db.signatureDrafts.put({ ...cur, ...patch, signedAt: patch.imageDataUrl ? new Date().toISOString() : patch.imageDataUrl === null ? null : cur.signedAt });
  };

  const generate = async () => {
    if (blockers.length) return;
    setBusy(true);
    setMessage(null);
    await queueIssue(visit.id);
    if (!navigator.onLine) {
      setMessage('You are offline. The report is queued and will issue automatically, with these signatures, as soon as the phone is back online.');
      setBusy(false);
      return;
    }
    const res = await syncEngine.syncNow();
    const after = await db.pendingActions.where('visitId').equals(visit.id).filter((a) => a.kind === 'issue').last();
    setBusy(false);
    if (after?.status === 'done' || (await db.visits.get(visit.id))?.status === 'issued') return; // effect navigates
    if (after?.status === 'failed') setMessage(`The server would not issue the report:\n${after.error ?? ''}`);
    else setMessage(res.error
      ? `Could not reach the server (${res.error}). The report is queued and will issue automatically when the connection is back.`
      : 'Still uploading changes and photos. The report will issue automatically as soon as they are all on the server.');
  };

  return (
    <div>
      <Link to={`/visits/${visit.id}`} className="back-link">← All rooms</Link>
      <h1 className="title">Review &amp; sign off</h1>

      <div className="tiles">
        {[
          { v: data.rooms.filter((r) => r.present).length, l: 'Rooms' },
          { v: `${p.graded}/${p.total}`, l: 'Items graded' },
          { v: p.defects, l: 'Below good' },
          { v: livePhotos, l: 'Photos' },
        ].map((t) => (
          <div key={t.l} className="tile"><Corners /><div className="tile__value">{t.v}</div><div className="tile__label">{t.l}</div></div>
        ))}
      </div>

      {blockers.length > 0 ? (
        <section aria-labelledby="blockers-h">
          <div className="notice notice--strong" id="blockers-h">
            <span><strong>{blockers.length} thing{blockers.length > 1 ? 's' : ''} to fix before the report can issue.</strong> Every item needs a grade; Fair, Poor or Unacceptable needs a comment and a photo; N/A needs a reason; each room needs a wide photo.</span>
          </div>
          <ul className="blockers">
            {blockers.slice(0, 60).map((b, i) => (
              <li key={`${b.code}-${b.itemRecordId ?? b.roomInstanceId ?? i}`}><Link to={blockerHref(visit.id, b)}>{b.message}</Link></li>
            ))}
            {blockers.length > 60 && <li className="small muted" style={{ padding: 10 }}>…and {blockers.length - 60} more. Try MARK ALL AS GOOD on the rooms list.</li>}
          </ul>
        </section>
      ) : (
        <div className="notice" role="status">Everything required is captured. Collect signatures, then generate the report.</div>
      )}

      {uploading > 0 && (
        <div className="notice notice--grey" role="status">
          {uploading} photo{uploading > 1 ? 's' : ''} still uploading{online ? '' : ' (waiting for signal)'}. The server issues the report only once every photo is on it — this happens automatically.
        </div>
      )}

      <DraftPreview data={data} />

      <h2 className="section-label">Signatures</h2>
      {form.signatureRoles.map(({ role, label }) => {
        const d = draftFor(role);
        return (
          <fieldset key={role} className="card" style={{ margin: '0 0 16px' }}>
            <Corners />
            <legend className="item__name" style={{ padding: '0 4px' }}>{label}</legend>
            <div className="field">
              <label className="field__label" htmlFor={`sig-${role}`}>Print name</label>
              <input id={`sig-${role}`} className="input" autoComplete="name" value={d.name}
                onChange={(e) => saveDraft(role, { name: e.target.value })} />
            </div>
            <SignaturePad label={`${label} signature`} value={d.imageDataUrl} onChange={(img) => saveDraft(role, { imageDataUrl: img })} />
          </fieldset>
        );
      })}
      <p className="small muted">Signatures are sent with the report when it issues. Roles left unsigned can sign later.</p>

      {action?.status === 'pending' && (
        <div className="notice" role="status">
          {online ? 'Issuing — waiting for every change and photo to reach the server.' : 'Queued: the report will issue automatically when the phone is back online.'}
        </div>
      )}
      {action?.status === 'failed' && <div className="notice notice--strong" role="alert" style={{ whiteSpace: 'pre-line' }}>Not issued: {action.error}</div>}
      {message && <div className="notice" role="status" style={{ whiteSpace: 'pre-line' }}>{message}</div>}

      <button type="button" className="btn btn--primary btn--block" disabled={blockers.length > 0 || busy} onClick={() => void generate()}>
        {blockers.length ? `FIX ${blockers.length} ISSUE${blockers.length > 1 ? 'S' : ''} FIRST` : busy ? 'ISSUING…' : 'GENERATE THE SOC REPORT →'}
      </button>
    </div>
  );
}

/** Draft report rendered on the device by @soc/report, photos straight from IndexedDB. */
function DraftPreview({ data }: { data: VisitData }) {
  const ref = useReference();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const form = formOf(ref);

  useEffect(() => {
    if (!open || !form || !data.property) return;
    const urls: string[] = [];
    const urlFor = new Map<string, string>();
    for (const p of data.photos) {
      if (p.blob) { const u = URL.createObjectURL(p.blob); urls.push(u); urlFor.set(p.id, u); }
    }
    const bundle: VisitBundle = {
      visit: data.visit, property: data.property, landlord: data.landlord, tenancy: data.tenancy, general: data.general,
      appliances: data.appliances, meters: data.meters, rooms: data.rooms, items: data.items,
      photos: data.photos.map(({ blob: _b, ...p }) => p), notes: data.notes, report: data.report, signatures: data.signatures,
    };
    const schemeName = ref?.schemes.find((s) => s.code === data.visit.schemeCode)?.name ?? SCHEMES.find((s) => s.code === data.visit.schemeCode)?.name ?? data.visit.schemeCode;
    const officerName = ref?.officers.find((o) => o.id === data.visit.officerId)?.name ?? session?.name ?? '';
    try {
      setHtml(renderReportHtml({
        bundle, form, schemeName, officerName, mode: 'draft',
        photoSrc: (id) => urlFor.get(id) ?? `/api/photos/${id}/file`,
      }));
    } catch (e) {
      setHtml(`<p style="font-family:sans-serif">Preview failed: ${String((e as Error).message).replace(/</g, '&lt;')}</p>`);
    }
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [open, data, form, ref, session]);

  return (
    <details className="disclosure" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Draft report preview</summary>
      <div className="disclosure__body">
        <p className="small muted">Rendered on this phone from what is saved so far — works offline. Watermarked DRAFT until issued.</p>
        {html && <iframe title="Draft SOC report" className="preview-frame" sandbox="allow-same-origin" srcDoc={html} />}
      </div>
    </details>
  );
}
