import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { Report, Signature } from '@soc/shared';
import { api } from '../lib/api';
import { useLiveQuery } from 'dexie-react-hooks';
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
        if (signatures.length) await db.signatures.bulkPut(signatures);
        if (report.pdfReady && report.sha256) void syncEngine.syncNow(); // queued signatures can now be sent
      } catch { /* try again */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 3000);
    return () => { stop = true; clearInterval(t); };
  }, [reportId, ready, online]);

  if (data === undefined) return null;
  if (!data) return <Navigate to="/" replace />;
  const { visit, report, property, signatures } = data;
  const issued = visit.status === 'issued' && report;

  if (!issued) {
    return (
      <div>
        <Link to={`/visits/${visit.id}/review`} className="back-link">← Review</Link>
        <h1 className="title">Waiting to issue</h1>
        <div className="notice" role="status">
          {action?.status === 'failed'
            ? `The server did not issue the report: ${action.error ?? 'unknown error'}`
            : online ? 'Uploading the last changes and photos, then the report issues automatically.' : 'Offline. The report issues automatically when the phone is back online.'}
        </div>
        <button type="button" className="btn btn--block" onClick={() => void syncEngine.syncNow()}>TRY NOW</button>
      </div>
    );
  }

  const roleLabel = (role: string) => form?.signatureRoles.find((r) => r.role === role)?.label ?? role;
  const photos = data.photos.filter((p) => !p.deletedAt).length;
  return (
    <div>
      <div className="done-mark" aria-hidden="true">✓</div>
      <h1 className="title" style={{ marginBottom: 4 }}>{report.reportNumber} issued</h1>
      <p className="small muted">
        {addressOf(property)}{property ? `, ${property.postcode}` : ''} · {photos} photo{photos === 1 ? '' : 's'} ·{' '}
        {new Date(report.issuedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>

      <h2 className="section-label">Signatures</h2>
      {signatures.length === 0 ? (
        <p className="small muted">No signatures recorded yet.</p>
      ) : (
        signatures.map((s) => (
          <div key={s.id} className="card card--plain" style={{ marginBottom: 7, padding: 10 }}>
            <span className="small"><strong>{roleLabel(s.role)}</strong> — {s.name}, {new Date(s.signedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
        ))
      )}
      {report.sha256 && <p className="mono" style={{ wordBreak: 'break-all' }}>SHA-256 {report.sha256}</p>}
      {action && action.status === 'pending' && (
        <p className="small muted" role="status">Signatures captured on this phone are sent once the PDF is ready{online ? '' : ' and the phone is online'}.</p>
      )}
      {!ready && <p className="small muted" role="status">Generating the PDF…</p>}

      <div className="btn-grid" style={{ marginTop: 12 }}>
        <Link to="/" className="btn">BACK TO VISITS</Link>
        {online && ready ? (
          <a href={`/api/reports/${report.id}/pdf`} target="_blank" rel="noopener" className="btn btn--primary">OPEN THE PDF</a>
        ) : (
          <button type="button" className="btn btn--primary" disabled>{online ? 'PDF RENDERING…' : 'OPEN THE PDF'}</button>
        )}
      </div>
      {!online && <p className="small muted">The PDF opens when you are back online.</p>}
    </div>
  );
}
