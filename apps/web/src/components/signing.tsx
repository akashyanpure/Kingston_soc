/** Staff side of signing links: send a link, copy/open it, see existing links + disputes, revoke. */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  roomDisplayName, type CreateSigningLinkRequest, type Dispute, type LinkSignerRole, type SigningLink, type VisitBundle, type VisitType,
} from '@soc/shared';
import { api, HttpError } from '../lib/api';
import { errorMessage, fmtDay, relativeTime } from '../lib/portal';
import { Dialog } from './Dialog';
import { Icon, Skeleton } from './ui';

const ROLE_LABEL: Record<LinkSignerRole, string> = { landlord_agent: 'Landlord / agent', tenant_check_in: 'Tenant (check-in)', tenant_check_out: 'Tenant (check-out)' };

export function linkRolesFor(visitType: VisitType): LinkSignerRole[] {
  return ['landlord_agent', ...(visitType === 'check_in' ? ['tenant_check_in' as const] : visitType === 'check_out' ? ['tenant_check_out' as const] : [])];
}

function LinkStatusPill({ link }: { link: SigningLink }) {
  if (link.status === 'pending' && link.openedAt) return <span className="pill pill--opened">Opened {relativeTime(link.openedAt)}</span>;
  const tone = { pending: 'pill--teal', signed: 'pill--G', expired: 'pill--NA', revoked: 'pill--alert' }[link.status];
  const label = { pending: 'Pending', signed: 'Signed', expired: 'Expired', revoked: 'Revoked' }[link.status];
  return <span className={`pill ${tone}`}>{label}</span>;
}

function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="link-url">
        <code aria-label="Signing link">{url}</code>
      </div>
      <div className="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn--sm" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>
          <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy link'}
        </button>
        <a className="btn btn--sm" href={url} target="_blank" rel="noopener"><Icon name="external" size={16} /> Open</a>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>Share it by email, SMS or WhatsApp. It expires in 14 days and can be used to sign once.</p>
    </div>
  );
}

/**
 * "Send signing link" for an issued report. Context comes from the visit bundle (visit type,
 * landlord name/email, who has signed) unless the caller passes it.
 */
export function SendSigningLinkDialog({ open, reportId, visitId, reportNumber, onClose, onChanged }: {
  open: boolean; reportId: string | null; visitId: string | null; reportNumber?: string; onClose: () => void; onChanged?: () => void;
}) {
  const [bundle, setBundle] = useState<VisitBundle | null>(null);
  const [links, setLinks] = useState<SigningLink[] | null>(null);
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [role, setRole] = useState<LinkSignerRole>('landlord_agent');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const reload = () => {
    if (!reportId) return;
    api<{ links: SigningLink[] }>(`/reports/${reportId}/signing-links`).then((r) => setLinks(r.links)).catch((e) => setError(errorMessage(e)));
    api<{ disputes: Dispute[] }>(`/reports/${reportId}/disputes`).then((r) => setDisputes(r.disputes)).catch(() => setDisputes([]));
  };
  useEffect(() => {
    setCreated(null); setError(null); setLinks(null); setDisputes(null);
    if (!open || !reportId) return;
    reload();
    if (visitId) api<VisitBundle>(`/visits/${visitId}`).then(setBundle).catch(() => setBundle(null));
  }, [open, reportId, visitId]); // eslint-disable-line react-hooks/exhaustive-deps

  const signedRoles = useMemo(() => new Set((bundle?.signatures ?? []).map((s) => s.role)), [bundle]);
  const roles = useMemo(() => linkRolesFor(bundle?.visit.visitType ?? 'interim').filter((r) => !signedRoles.has(r)), [bundle, signedRoles]);
  useEffect(() => {
    if (!roles.includes(role) && roles[0]) setRole(roles[0]);
  }, [roles, role]);
  useEffect(() => {
    if (role === 'landlord_agent' && bundle?.landlord) {
      setName(bundle.landlord.name);
      setEmail(bundle.landlord.email ?? '');
    } else if (role !== 'landlord_agent') {
      setName(bundle?.tenancy?.tenantName ?? '');
      setEmail('');
    }
  }, [role, bundle]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reportId) return;
    setBusy(true);
    setError(null);
    try {
      const req: CreateSigningLinkRequest = { role, ...(name.trim() ? { recipientName: name.trim() } : {}), ...(email.trim() ? { recipientEmail: email.trim() } : {}) };
      const res = await api<{ link: SigningLink; url: string }>(`/reports/${reportId}/signing-links`, { method: 'POST', json: req });
      setCreated(res.url);
      reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof HttpError && err.code === 'ALREADY_SIGNED' ? 'That person has already signed this report.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (l: SigningLink) => {
    if (!confirm('Withdraw this link? It will stop working straight away.')) return;
    try {
      await api(`/signing-links/${l.id}/revoke`, { method: 'POST' });
      reload();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} title={`Signing links${reportNumber ? ` · ${reportNumber}` : ''}`} onClose={onClose}>
      {created ? (
        <div>
          <div className="notice notice--success" role="status">Link created{email ? ` and emailed to ${email}` : ''}.</div>
          <CopyUrl url={created} />
          <div className="dialog__actions"><button type="button" className="btn btn--primary" onClick={() => setCreated(null)}>Done</button></div>
        </div>
      ) : roles.length === 0 && bundle ? (
        <div className="notice notice--success">Everyone who can sign this report has signed.</div>
      ) : (
        <form onSubmit={(e) => void submit(e)} aria-label="Send a signing link">
          <div className="field">
            <label className="field__label" htmlFor="sl-role">Who should sign?</label>
            <select id="sl-role" className="select" value={role} onChange={(e) => setRole(e.target.value as LinkSignerRole)}>
              {(roles.length ? roles : (['landlord_agent'] as LinkSignerRole[])).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="sl-name">Recipient name</label>
            <input id="sl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="sl-email">Email (optional — we email the link if given)</label>
            <input id="sl-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}><Icon name="pen" size={18} /> {busy ? 'Creating…' : 'Create signing link'}</button>
        </form>
      )}

      <h3 className="section-label">Links sent</h3>
      {!links ? <Skeleton lines={2} card={false} /> : links.length === 0 ? <p className="small muted">No links sent yet.</p> : (
        <ul className="link-list">
          {links.map((l) => (
            <li key={l.id}>
              <div>
                <div style={{ fontWeight: 600 }}>{l.recipientName ?? ROLE_LABEL[l.role]} <span className="small muted">· {ROLE_LABEL[l.role]}</span></div>
                <div className="small muted">Sent {fmtDay(l.createdAt)} · expires {fmtDay(l.expiresAt)}{l.disputes ? ` · ${l.disputes} dispute${l.disputes === 1 ? '' : 's'}` : ''}</div>
              </div>
              <span className="row" style={{ gap: 6 }}>
                <LinkStatusPill link={l} />
                {l.status === 'pending' && <button type="button" className="btn btn--xs btn--danger" onClick={() => void revoke(l)} aria-label={`Revoke link for ${l.recipientName ?? ROLE_LABEL[l.role]}`}>Revoke</button>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {disputes && disputes.length > 0 && (
        <>
          <h3 className="section-label">Disputes ({disputes.length})</h3>
          <ul className="action-list">
            {disputes.map((d) => (
              <li key={d.id}>
                <div>
                  <div className="action-list__title">{roomDisplayName(d.item)} <span className="small muted">· {roomDisplayName(d.room)}</span></div>
                  <div className="action-list__quote">{d.comment}</div>
                  <div className="action-list__meta">{relativeTime(d.createdAt)}{d.resolvedAt ? ' · resolved' : ''}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
