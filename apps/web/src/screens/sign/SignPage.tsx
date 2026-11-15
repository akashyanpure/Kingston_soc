/**
 * Public signing page (/sign/:token) for a landlord/agent or tenant who was not at the visit.
 * No login and no app shell. They read the report, check every item not marked Good (with
 * photos), dispute individual items, and sign electronically. E-signatures only.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { KINGSTON_CREST, LOGO_ALT } from '@soc/report';
import { roomDisplayName, type PublicDisputeRequest, type PublicSignRequest, type SigningView } from '@soc/shared';
import { Dialog } from '../../components/Dialog';
import { SignaturePad } from '../../components/SignaturePad';
import { ThamesLight } from '../../components/ThamesLight';
import { Icon, Skeleton, StatTile } from '../../components/ui';
import { api, apiRaw, HttpError, NetworkError } from '../../lib/api';
import { fmtDay, usePageTitle } from '../../lib/portal';

type Gone = 'LINK_EXPIRED' | 'LINK_USED' | 'LINK_REVOKED' | 'NOT_FOUND' | 'OFFLINE' | 'ERROR';
const GRADE_WORD: Record<string, string> = { F: 'Fair', P: 'Poor', U: 'Unacceptable', NA: 'N/A', G: 'Good' };
const ROLE_LABEL: Record<string, string> = { landlord_agent: 'landlord / agent', tenant_check_in: 'tenant', tenant_check_out: 'tenant', officer: 'officer' };
const title = (s: string) => roomDisplayName(s);

/** Photo served to the token holder; fetched through the API client so it also works with the dev mock. */
function TokenPhoto({ token, photoId, alt, onOpen }: { token: string; photoId: string; alt: string; onOpen?: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    apiRaw(`/sign/${token}/photos/${photoId}`).then((r) => r.blob()).then((b) => {
      if (!live) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [token, photoId]);
  if (!url) return <span className="sign-thumb stripe" aria-hidden="true" />;
  return (
    <button type="button" className="sign-thumb" onClick={() => onOpen?.(url)} aria-label={`Enlarge photo: ${alt}`}>
      <img src={url} alt="" />
    </button>
  );
}

function Header({ view }: { view: Pick<SigningView, 'schemeName'> | null }) {
  return (
    <header className="sign-head">
      <img src={KINGSTON_CREST} alt={LOGO_ALT} />
      <div>
        <div className="sign-head__org">Kingston Council</div>
        <div className="sign-head__scheme">{view?.schemeName ?? 'Private Sector Schemes'}</div>
      </div>
    </header>
  );
}

const GONE_COPY: Record<Gone, { title: string; body: string }> = {
  LINK_EXPIRED: { title: 'This link has expired', body: 'Signing links last 14 days. Please contact the Private Sector Schemes officer who sent it and ask for a new one — nothing has been signed.' },
  LINK_USED: { title: 'This report has already been signed', body: 'Thank you — a signature has already been recorded with this link. If you think that is wrong, contact the Private Sector Schemes team.' },
  LINK_REVOKED: { title: 'This link has been withdrawn', body: 'The council has withdrawn this link, usually because a newer one was sent. Please use the most recent email or message you received.' },
  NOT_FOUND: { title: 'We couldn’t find this link', body: 'Check that the whole link was copied. If it still doesn’t work, contact the Private Sector Schemes team.' },
  OFFLINE: { title: 'Can’t reach the council right now', body: 'Check your connection and try again in a moment.' },
  ERROR: { title: 'Something went wrong', body: 'Please try again in a moment.' },
};

export function SignPage() {
  usePageTitle('Schedule of Condition — please check and sign');
  const { token = '' } = useParams();
  const [view, setView] = useState<SigningView | null>(null);
  const [gone, setGone] = useState<Gone | null>(null);
  const [enlarge, setEnlarge] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<SigningView['belowGood'][number] | null>(null);
  const [signed, setSigned] = useState<{ name: string; at: string } | null>(null);

  const load = () => {
    setGone(null);
    api<SigningView>(`/sign/${encodeURIComponent(token)}`)
      .then(setView)
      .catch((e) => {
        if (e instanceof NetworkError) setGone('OFFLINE');
        else if (e instanceof HttpError && (e.code === 'LINK_EXPIRED' || e.code === 'LINK_USED' || e.code === 'LINK_REVOKED')) setGone(e.code);
        else if (e instanceof HttpError && e.status === 404) setGone('NOT_FOUND');
        else setGone('ERROR');
      });
  };
  useEffect(load, [token]);

  if (gone) {
    const c = GONE_COPY[gone];
    return (
      <div className="sign-page">
        <ThamesLight />
        <div className="sign-wrap on-light">
          <Header view={null} />
          <div className="card sign-gone" role="status">
            <span className="empty__icon"><Icon name={gone === 'LINK_USED' ? 'check' : gone === 'OFFLINE' ? 'cloudOff' : 'clock'} size={26} /></span>
            <h1 className="sign-title" style={{ fontSize: 26 }}>{c.title}</h1>
            <p className="muted" style={{ margin: 0 }}>{c.body}</p>
            {(gone === 'OFFLINE' || gone === 'ERROR') && <button type="button" className="btn" style={{ marginTop: 16 }} onClick={load}>Try again</button>}
          </div>
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="sign-page"><div className="sign-wrap"><Header view={null} /><Skeleton lines={4} /><Skeleton lines={5} /></div></div>
    );
  }

  const days = Math.max(0, Math.ceil((Date.parse(view.expiresAt) - Date.now()) / 86_400_000));
  const markDisputed = (id: string) => setView((v) => v && { ...v, belowGood: v.belowGood.map((b) => (b.itemRecordId === id ? { ...b, disputed: true } : b)) });

  if (signed) {
    return (
      <div className="sign-page">
        <ThamesLight surge />
        <div className="sign-wrap on-light">
          <Header view={view} />
          <div className="seal-wrap">
            <div className="seal" aria-hidden="true"><div className="seal__inner"><Icon name="check" size={34} /><span>Signed</span></div></div>
            <h1 className="sign-title" style={{ textAlign: 'center' }}>Signed — thank you</h1>
            <p className="muted" style={{ textAlign: 'center', maxWidth: '36ch' }}>
              {signed.name}, your signature on {view.reportNumber} for {view.address} was recorded on {new Date(signed.at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}.
              The council has been notified. You can close this page.
            </p>
            <a className="btn" href={`/api/sign/${encodeURIComponent(token)}/pdf`} target="_blank" rel="noopener"><Icon name="file" size={18} /> Keep a copy of the report</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-page">
      <ThamesLight />
      <div className="sign-wrap on-light">
        <Header view={view} />
        <div className="row" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="pill pill--teal"><Icon name="key" size={13} /> Secure link · expires in {days} day{days === 1 ? '' : 's'}</span>
          <span className="pill pill--outline num">{view.reportNumber}</span>
        </div>
        {view.recipientName && <div className="kicker">For {view.recipientName}</div>}
        <h1 className="sign-title">Please check and sign the Schedule of Condition for {view.address}, {view.postcode}</h1>
        <p className="muted">Prepared by {view.officerName} on {fmtDay(view.inspectedAt ?? view.issuedAt, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
        <div className="card card--plain sign-reassure">
          Nothing is charged to you by signing — you are confirming the record is accurate. If something is wrong, raise it item by item and the officer is notified.
        </div>

        <div className="tiles" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <StatTile value={view.stats.items} label="Items" />
          <StatTile value={view.stats.belowGood} label="Below good" tone={view.stats.belowGood ? 'alert' : undefined} />
          <StatTile value={view.stats.photos} label="Photos" />
        </div>

        <h2 className="section-label">Items not marked Good</h2>
        {view.belowGood.length === 0 && <p className="muted">Every item was graded Good.</p>}
        <ul className="sign-items">
          {view.belowGood.map((b) => (
            <li key={b.itemRecordId} className="card sign-item">
              <div className="row row--top">
                <div>
                  <div className="sign-item__name">{title(b.item)}</div>
                  <div className="small muted">{title(b.room)}</div>
                </div>
                <span className={`pill pill--${b.condition}`}>{b.condition === 'NA' ? 'N/A' : b.condition} · {GRADE_WORD[b.condition]}</span>
              </div>
              {b.comment && <p className="sign-item__comment">{b.comment}</p>}
              {b.photoIds.length > 0 && (
                <div className="thumbs">
                  {b.photoIds.map((pid, i) => <TokenPhoto key={pid} token={token} photoId={pid} alt={`${title(b.item)}, photo ${i + 1}`} onOpen={setEnlarge} />)}
                </div>
              )}
              <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
                {b.disputed
                  ? <span className="pill pill--F"><Icon name="alert" size={13} /> Disputed — the officer has been told</span>
                  : <button type="button" className="btn btn--sm" onClick={() => setDisputing(b)}>Dispute</button>}
              </div>
            </li>
          ))}
        </ul>

        <a className="btn btn--block" href={`/api/sign/${encodeURIComponent(token)}/pdf`} target="_blank" rel="noopener" style={{ marginTop: 8 }}>
          <Icon name="file" size={18} /> Read the full report
        </a>

        {view.signedBy.length > 0 && (
          <p className="small muted" style={{ marginTop: 14 }}>Already signed by {view.signedBy.map((x) => `${x.name} (${ROLE_LABEL[x.role] ?? x.role})`).join(', ')}.</p>
        )}

        <SignSection token={token} view={view} onSigned={setSigned} />
      </div>

      <Dialog open={!!enlarge} title="Photo" onClose={() => setEnlarge(null)} wide>
        {enlarge && <img src={enlarge} alt="Evidence photo, enlarged" style={{ width: '100%', borderRadius: 12 }} />}
      </Dialog>
      <DisputeSheet token={token} item={disputing} onClose={() => setDisputing(null)} onDone={(id) => { markDisputed(id); setDisputing(null); }} />
    </div>
  );
}

function DisputeSheet({ token, item, onClose, onDone }: {
  token: string; item: SigningView['belowGood'][number] | null; onClose: () => void; onDone: (itemId: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setComment(''); setError(null); }, [item]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const req: PublicDisputeRequest = { itemRecordId: item.itemRecordId, comment: comment.trim() };
      await api(`/sign/${encodeURIComponent(token)}/disputes`, { method: 'POST', json: req });
      onDone(item.itemRecordId);
    } catch (err) {
      setError(err instanceof HttpError ? err.message : 'Could not send — please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!item} title="Dispute this item" onClose={onClose}>
      {item && (
        <form onSubmit={(e) => void submit(e)}>
          <p style={{ margin: '0 0 4px' }}><strong>{title(item.item)}</strong> · {title(item.room)}</p>
          <p className="small muted">Graded {GRADE_WORD[item.condition]}{item.comment ? ` — “${item.comment}”` : ''}</p>
          <div className="field">
            <label className="field__label" htmlFor="dispute-comment">What is wrong with this entry?</label>
            <textarea id="dispute-comment" className="textarea" value={comment} minLength={5} maxLength={1000} onChange={(e) => setComment(e.target.value)} required />
          </div>
          <p className="small muted">The officer is notified and will contact you. You can still sign the rest of the report.</p>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy || comment.trim().length < 5}>{busy ? 'Sending…' : 'Send dispute'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function SignSection({ token, view, onSigned }: { token: string; view: SigningView; onSigned: (s: { name: string; at: string }) => void }) {
  const [name, setName] = useState(view.recipientName ?? '');
  const [image, setImage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length >= 2 && !!image && confirm;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !image) return;
    setBusy(true);
    setError(null);
    try {
      const req: PublicSignRequest = { name: name.trim(), imageDataUrl: image, confirm: true };
      const res = await api<{ signature: { signedAt: string } }>(`/sign/${encodeURIComponent(token)}`, { method: 'POST', json: req });
      onSigned({ name: name.trim(), at: res.signature.signedAt });
    } catch (err) {
      setError(err instanceof HttpError && err.code === 'LINK_USED' ? 'This report has already been signed with this link.' : err instanceof HttpError ? err.message : 'Could not sign — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card sigcard sign-section" onSubmit={(e) => void submit(e)} aria-labelledby="sign-h">
      <h2 id="sign-h" className="sigcard__role" style={{ fontSize: 22 }}>Sign as {ROLE_LABEL[view.role]}</h2>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="field__label" htmlFor="sign-name">Print name</label>
        <input id="sign-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <SignaturePad label="Your signature" value={image} onChange={setImage} />
      <label className="checkrow" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        <span style={{ fontSize: 15 }}>I have read the report and confirm it is a fair record</span>
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="submit" className="btn btn--primary btn--block btn--lg btn--shimmer" disabled={busy || !ready}>
        {busy ? 'Signing…' : <><Icon name="pen" size={18} /> I agree — sign now</>}
      </button>
    </form>
  );
}
