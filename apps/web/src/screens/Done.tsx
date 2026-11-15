import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { Report, Signature } from '@soc/shared';
import { api } from '../lib/api';
import { useLiveQuery } from 'dexie-react-hooks';
import { ThamesLight } from '../components/ThamesLight';
import { Icon, ScreenSkeleton } from '../components/ui';
import { db } from '../lib/db';
import { useOnline } from '../lib/hooks';
import { formOf, useReference } from '../lib/reference';
import { syncEngine } from '../lib/sync';
import { addressOf, useVisit } from '../lib/visitData';

export function Done() {
  const { visitId } = useParams();
  const data = useVisit(visitId);
  const online = useOnline();
  const form = formOf(useReference());
  const action = useLiveQuery(
    () => (visitId ? db.pendingActions.where('visitId').equals(visitId).filter((a) => a.kind === 'issue').last() : undefined),
    [visitId],
  );

  // The PDF renders in the background: poll the report until its PDF (and SHA-256) exist.
  const reportId = data?.report?.id;
  const ready = !!data?.report?.pdfReady && !!data?.report?.sha256;
  useEffect(() => {
    if (!reportId || ready || !online) return;
    let stop = false;
    const poll = async () => {
      try {
        const { report, signatures } = await api<{ report: Report; signatures: Signature[] }>(`/reports/${reportId}`);
        if (stop) return;
        await db.reports.put(report);
        for (const sig of signatures) {
          const local = await db.signatures.get(sig.id);
          await db.signatures.put({ ...sig, ...(local?.imageDataUrl ? { imageDataUrl: local.imageDataUrl } : {}) });
        }
      } catch { /* try again */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 3000);
    return () => { stop = true; clearInterval(t); };
  }, [reportId, ready, online]);

  if (data === undefined) return <ScreenSkeleton cards={2} />;
  if (!data) return <Navigate to="/" replace />;
  const { visit, report, property, signatures } = data;
  const issued = visit.status === 'issued' && report;

  if (!issued) {
    return (
      <div>
        <Link to={`/visits/${visit.id}/review`} className="back-link"><Icon name="chevronLeft" size={18} /> Review</Link>
        <div className="kicker">Almost there</div>
        <h1 className="title">Waiting to issue</h1>
        <div className={`notice${action?.status === 'failed' ? ' notice--strong' : ' notice--brass'}`} role="status">
          {action?.status === 'failed'
            ? `The server did not issue the report: ${action.error ?? 'unknown error'}`
            : online ? 'Uploading the last changes, photos and signatures, then the report issues automatically.' : 'Offline. The report issues automatically when the phone is back online.'}
        </div>
        <button type="button" className="btn btn--block" onClick={() => void syncEngine.syncNow()}><Icon name="sync" size={18} /> Try now</button>
      </div>
    );
  }

  const roleLabel = (role: string) => form?.signatureRoles.find((r) => r.role === role)?.label ?? role;
  const photos = data.photos.filter((p) => !p.deletedAt).length;
  return (
    <div>
      <ThamesLight surge />
      <div className="on-light">
        <div className="seal-wrap">
          <div className="seal" aria-hidden="true">
            <div className="seal__inner"><Icon name="check" size={34} /><span>Issued</span></div>
          </div>
          <div className="kicker">Schedule of Condition</div>
          <h1 className="report-number">{report.reportNumber}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {addressOf(property)}{property ? `, ${property.postcode}` : ''}
          </p>
          <p className="small muted">
            Issued {new Date(report.issuedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })} · {photos} photo{photos === 1 ? '' : 's'}
          </p>
        </div>

        <div className="card">
          <h2 className="section-label" style={{ marginTop: 0 }}>Signed by</h2>
          {signatures.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No signatures recorded.</p>
          ) : (
            signatures.map((s) => (
              <div key={s.id} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--hairline)' }}>
                <span>
                  <span className="serif" style={{ fontSize: 17, fontWeight: 600 }}>{s.name}</span>
                  <span className="small muted" style={{ display: 'block' }}>{roleLabel(s.role)}</span>
                </span>
                <span className="small muted num" style={{ whiteSpace: 'nowrap' }}>{new Date(s.signedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
            ))
          )}
          {report.sha256 && <p className="mono muted" style={{ wordBreak: 'break-all', margin: '12px 0 0' }}>SHA-256 {report.sha256}</p>}
        </div>
        {!ready && <p className="small muted" role="status">Generating the PDF…</p>}

        <div className="btn-grid" style={{ marginTop: 16 }}>
          <Link to="/" className="btn btn--lg">Back to visits</Link>
          {online && ready ? (
            <a href={`/api/reports/${report.id}/pdf`} target="_blank" rel="noopener" className="btn btn--primary btn--lg"><Icon name="file" size={18} /> Open the PDF</a>
          ) : (
            <button type="button" className="btn btn--primary btn--lg" disabled>{online ? 'PDF rendering…' : 'Open the PDF'}</button>
          )}
        </div>
        {!online && <p className="small muted">The PDF opens when you are back online.</p>}
      </div>
    </div>
  );
}
