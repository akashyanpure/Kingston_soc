import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { issueBlockers, SCHEMES, type Blocker, type BlockerCode, type VisitBundle } from '@soc/shared';
import { renderReportHtml } from '@soc/report';
import { Icon, ScreenSkeleton, StatTile } from '../components/ui';
import { SignatureBlock } from '../components/SignatureBlock';
import { db } from '../lib/db';
import { progressOf, relevantItems, useOnline } from '../lib/hooks';
import { formOf, useReference } from '../lib/reference';
import { useSession } from '../lib/session';
import { contentHashOf, isStale, rolesFor } from '../lib/signatures';
import { queueIssue, syncEngine } from '../lib/sync';
import { useVisit, type VisitData } from '../lib/visitData';

const SIGNATURE_CODES: BlockerCode[] = ['OFFICER_SIGNATURE_MISSING', 'SIGNATURE_STALE', 'SIGNATURE_ROLE_INVALID'];

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
  const action = useLiveQuery(
    () => (visitId ? db.pendingActions.where('visitId').equals(visitId).filter((a) => a.kind === 'issue' && a.status !== 'done').first() : undefined),
    [visitId],
  );

  // Content fingerprint of the draft as it is now; signatures bind to it.
  const contentHash = useMemo(() => (data ? contentHashOf(data) : null), [data]);
  const blockers = useMemo(() => (data ? issueBlockers({
    rooms: data.rooms, items: data.items, photos: data.photos, general: data.general,
    signatures: data.signatures, visitType: data.visit.visitType, contentSha256: contentHash ?? '',
  }) : []), [data, contentHash]);
  const contentBlockers = blockers.filter((b) => !SIGNATURE_CODES.includes(b.code));
  const signatureBlockers = blockers.filter((b) => SIGNATURE_CODES.includes(b.code));

  // Once the queued issue completes (now or after reconnecting), go to the Done screen.
  useEffect(() => {
    if (data?.visit.status === 'issued') nav(`/visits/${data.visit.id}/done`, { replace: true });
  }, [data?.visit.status, data?.visit.id, nav]);

  if (data === undefined || ref === undefined || session === undefined) return <ScreenSkeleton cards={4} />;
  if (!data || !form) return <Navigate to="/visits" replace />;

  const { visit } = data;
  const items = relevantItems(data.rooms, data.items);
  const p = progressOf(items);
  const livePhotos = data.photos.filter((ph) => !ph.deletedAt).length;
  const uploading = data.photos.filter((ph) => !ph.deletedAt && !ph.uploaded).length;
  const roles = rolesFor(form, visit.visitType);
  const canSign = contentBlockers.length === 0 && !!contentHash;

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
      : 'Still uploading changes, photos and signatures. The report will issue automatically as soon as they are all on the server.');
  };

  return (
    <div>
      <Link to={`/visits/${visit.id}`} className="back-link"><Icon name="chevronLeft" size={18} /> All rooms</Link>
      <div className="kicker">Final step</div>
      <h1 className="title">Review &amp; sign off</h1>

      <div className="tiles">
        <StatTile value={data.rooms.filter((r) => r.present).length} label="Rooms" />
        <StatTile value={<>{p.graded}<span style={{ fontSize: 18, color: 'var(--muted)' }}>/{p.total}</span></>} label="Items graded" />
        <StatTile value={p.defects} label="Below good" tone={p.defects ? 'alert' : undefined} />
        <StatTile value={livePhotos} label="Photos" />
      </div>

      {contentBlockers.length > 0 ? (
        <section aria-labelledby="blockers-h">
          <div className="notice notice--strong" id="blockers-h">
            <span><strong>{contentBlockers.length} thing{contentBlockers.length > 1 ? 's' : ''} to fix before signing.</strong> Every item needs a grade; Fair, Poor or Unacceptable needs a comment and a photo; N/A needs a reason; each room needs a wide photo.</span>
          </div>
          <ul className="blockers">
            {contentBlockers.slice(0, 60).map((b, i) => (
              <li key={`${b.code}-${b.itemRecordId ?? b.roomInstanceId ?? i}`}><Link to={blockerHref(visit.id, b)}>{b.message}</Link></li>
            ))}
            {contentBlockers.length > 60 && <li className="more">…and {contentBlockers.length - 60} more. Try MARK ALL AS GOOD on the rooms list.</li>}
          </ul>
        </section>
      ) : (
        <div className="notice notice--success" role="status">Everything required is captured. Check the draft with each person, collect signatures, then generate the report.</div>
      )}

      {uploading > 0 && (
        <div className="notice notice--grey" role="status">
          {uploading} photo{uploading > 1 ? 's' : ''} still uploading{online ? '' : ' (waiting for signal)'}. The server issues the report only once every photo is on it — this happens automatically.
        </div>
      )}

      <DraftPreview data={data} />

      <h2 className="section-label" id="signatures">Signatures</h2>
      {!canSign && (
        <div className="notice notice--grey">Signing opens once everything above is fixed — each person signs the finished draft.</div>
      )}
      {signatureBlockers.filter((b) => b.code === 'SIGNATURE_ROLE_INVALID').map((b) => (
        <p key={b.signatureId} className="error-text" role="alert">{b.message}</p>
      ))}
      {roles.map(({ role, label }) => {
        const sig = data.signatures.find((x) => x.role === role && x.method === 'on_device') ?? null;
        return (
          <SignatureBlock
            key={role} visitId={visit.id} role={role} label={label} required={role === 'officer'}
            signature={sig} stale={!!sig && isStale(sig, contentHash)} enabled={canSign}
            defaultName={role === 'officer' ? session?.name ?? '' : role === 'landlord_agent' ? data.landlord?.name ?? '' : data.tenancy?.tenantName ?? ''}
          />
        );
      })}
      <p className="small muted">The officer must sign. Landlord/agent and tenant are optional — anyone who does not sign is shown as "Not signed". If anything changes after someone signs, they need to sign again.</p>

      {action?.status === 'pending' && (
        <div className="notice" role="status">
          {online ? 'Issuing — waiting for every change and photo to reach the server.' : 'Queued: the report will issue automatically when the phone is back online.'}
        </div>
      )}
      {action?.status === 'failed' && <div className="notice notice--strong" role="alert" style={{ whiteSpace: 'pre-line' }}>Not issued: {action.error}</div>}
      {message && <div className="notice" role="status" style={{ whiteSpace: 'pre-line' }}>{message}</div>}

      <button type="button" className="btn btn--primary btn--block btn--lg btn--shimmer" disabled={blockers.length > 0 || busy} onClick={() => void generate()}>
        {contentBlockers.length
          ? `Fix ${contentBlockers.length} issue${contentBlockers.length > 1 ? 's' : ''} first`
          : signatureBlockers.length
            ? signatureBlockers.some((b) => b.code === 'OFFICER_SIGNATURE_MISSING') ? 'Officer signature needed' : 'Signatures need re-signing'
            : busy ? 'Issuing…' : <><Icon name="file" size={20} /> Generate the SOC report</>}
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
      photos: data.photos.map(({ blob: _b, ...p }) => p), notes: data.notes, report: data.report,
      signatures: data.signatures.map(({ imageDataUrl: _i, ...sig }) => sig),
    };
    const schemeName = ref?.schemes.find((s) => s.code === data.visit.schemeCode)?.name ?? SCHEMES.find((s) => s.code === data.visit.schemeCode)?.name ?? data.visit.schemeCode;
    const officerName = ref?.officers.find((o) => o.id === data.visit.officerId)?.name ?? session?.name ?? '';
    try {
      setHtml(renderReportHtml({
        bundle, form, schemeName, officerName, mode: 'draft',
        photoSrc: (id) => urlFor.get(id) ?? `/api/photos/${id}/file`,
        signatureSrc: (id) => {
          const sig = data.signatures.find((x) => x.id === id);
          return sig?.imageDataUrl ?? (sig?.hasImage ? `/api/signatures/${id}/image` : null);
        },
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
