import { useEffect, useState } from 'react';
import type { SignatureRole } from '@soc/shared';
import type { LocalSignature } from '../lib/db';
import { signVisit } from '../lib/signatures';
import { syncEngine } from '../lib/sync';
import { Corners } from './fields';
import { SignaturePad } from './SignaturePad';

export interface SignatureBlockProps {
  visitId: string;
  role: SignatureRole;
  label: string;
  required: boolean;
  signature: LocalSignature | null;
  /** Content changed since this person signed. */
  stale: boolean;
  /** Content blockers are clear, so the draft is final enough to sign. */
  enabled: boolean;
  defaultName: string;
}

/**
 * One signer: print name + finger signature, confirmed with a button so a single row
 * (and one outbox mutation) is written per signing. Signing again updates the same row.
 */
export function SignatureBlock({ visitId, role, label, required, signature, stale, enabled, defaultName }: SignatureBlockProps) {
  const [editing, setEditing] = useState(!signature);
  const [name, setName] = useState(signature?.name ?? defaultName);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `sig-${role}`;

  useEffect(() => { if (!signature) setEditing(true); }, [signature]);
  useEffect(() => { if (!signature && !name && defaultName) setName(defaultName); }, [defaultName]); // eslint-disable-line

  const confirm = async () => {
    if (!image || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signVisit(visitId, role, name, image);
      syncEngine.notifyChange();
      setEditing(false);
      setImage(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status = !signature ? (required ? 'Required' : 'Not signed') : stale ? 'Needs re-signing' : 'Signed';
  const pill = !signature ? '' : stale ? ' pill--dark' : ' pill--teal';
  const src = signature?.imageDataUrl ?? (signature?.hasImage ? `/api/signatures/${signature.id}/image` : null);

  return (
    <fieldset className="card" style={{ margin: '0 0 16px' }} aria-describedby={`${id}-status`}>
      <Corners />
      <legend className="item__name" style={{ padding: '0 4px' }}>{label}</legend>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small muted">{required ? 'Must sign' : 'Optional'}</span>
        <span id={`${id}-status`} className={`pill${pill}`}>{status}</span>
      </div>

      {signature && !editing ? (
        <>
          {src && <img src={src} alt={`Signature of ${signature.name}`} style={{ width: '100%', height: 120, objectFit: 'contain', background: '#fff', border: '1px solid var(--divider)' }} />}
          <p className="small" style={{ margin: '6px 0' }}>
            {signature.name} · {new Date(signature.signedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
          </p>
          {stale && (
            <div className="notice notice--strong" role="alert">
              The report changed after {signature.name} signed. They need to check the draft again and re-sign.
            </div>
          )}
          <button type="button" className={`btn btn--sm${stale ? ' btn--primary' : ''}`} disabled={!enabled} onClick={() => { setName(signature.name); setEditing(true); }}>
            SIGN AGAIN
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor={id}>Print name</label>
            <input id={id} className="input" autoComplete="name" value={name} disabled={!enabled} onChange={(e) => setName(e.target.value)} />
          </div>
          {enabled ? (
            <SignaturePad label={`${label} signature`} value={image} onChange={setImage} />
          ) : (
            <div className="sigpad stripe" aria-hidden="true" />
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="btn-grid" style={{ marginTop: 8, marginBottom: 0 }}>
            {signature ? (
              <button type="button" className="btn btn--sm" onClick={() => { setEditing(false); setImage(null); }}>CANCEL</button>
            ) : <span />}
            <button type="button" className="btn btn--sm btn--primary" disabled={!enabled || !image || !name.trim() || busy} onClick={() => void confirm()}>
              {busy ? 'SAVING…' : 'CONFIRM SIGNATURE'}
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}
