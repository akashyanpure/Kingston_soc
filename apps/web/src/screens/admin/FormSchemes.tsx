import { useEffect, useState } from 'react';
import type { FormSummary } from '@soc/shared';
import { Icon, Skeleton, StatTile } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, fmtDay, useApi, usePageTitle } from '../../lib/portal';
import { fetchReference, useReference } from '../../lib/reference';

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bWc\b/, 'WC');

function SchemeRow({ code, name, onSaved }: { code: string; name: string; onSaved: () => void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => setValue(name), [name]);
  const dirty = value.trim() !== name;
  const save = async () => {
    if (!dirty || value.trim().length < 3) return;
    if (!confirm(`Change ${code} to “${value.trim()}”? Reports issued from now on print this name on the cover and in the declaration.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/admin/schemes/${code}`, { method: 'PATCH', json: { name: value.trim() } });
      await fetchReference();
      setMsg({ tone: 'ok', text: 'Saved.' });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'bad', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hairline)', alignItems: 'flex-end' }}>
      <span className="pill pill--outline" style={{ marginBottom: 14 }}>{code}</span>
      <div className="field" style={{ flex: 1, margin: 0 }}>
        <label className="field__label" htmlFor={`scheme-${code}`}>Display name</label>
        <input id={`scheme-${code}`} className="input" value={value} minLength={3} maxLength={80} onChange={(e) => setValue(e.target.value)} />
        {msg && <span className={msg.tone === 'bad' ? 'error-text' : 'small yes'} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</span>}
      </div>
      <button type="button" className="btn btn--sm" disabled={!dirty || busy || value.trim().length < 3} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

export function AdminFormSchemes() {
  usePageTitle('Form & schemes');
  const ref = useReference();
  const { data, error, loading } = useApi<FormSummary>('/admin/form');
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">Administration</div>
          <h1 className="title">Form &amp; schemes</h1>
        </div>
      </div>
      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <Skeleton lines={6} />}
      {data && (
        <>
          <div className="kpis">
            <StatTile value={`v${data.version}`} label="Published form" />
            <StatTile value={data.rooms.length} label="Rooms" />
            <StatTile value={data.totalItems} label="Item rows" />
            <StatTile value={data.conditionOptions.length} label="Condition options" />
          </div>
          <p className="small muted">Source: {data.source} · published {fmtDay(data.publishedAt, { day: 'numeric', month: 'long', year: 'numeric' })}. The template is read-only here — changes go through a new form version.</p>

          <div className="two-col" style={{ marginTop: 16 }}>
            <section className="panel" aria-labelledby="rooms-h">
              <div className="panel__head"><h2 id="rooms-h" className="panel__title"><Icon name="door" size={18} /> Rooms</h2></div>
              <div className="panel__body">
                {data.rooms.map((r) => {
                  const max = Math.max(...data.rooms.map((x) => x.items));
                  return (
                    <div key={r.code} className="hbar">
                      <span>{title(r.label)}</span>
                      <span className="hbar__track" aria-hidden="true"><span style={{ width: `${(r.items / max) * 100}%` }} /></span>
                      <span className="num muted" style={{ textAlign: 'right' }}>{r.items}</span>
                    </div>
                  );
                })}
              </div>
            </section>
            <div>
              <section className="panel" aria-labelledby="cond-h" style={{ marginBottom: 16 }}>
                <div className="panel__head"><h2 id="cond-h" className="panel__title">Condition options</h2></div>
                <div className="panel__body">
                  <dl className="def-list">
                    {data.conditionOptions.map((c) => (
                      <div key={c.code} style={{ display: 'contents' }}>
                        <dt><span className={`pill pill--${c.code}`}>{c.code === 'NA' ? 'N/A' : c.code} · {c.label}</span></dt>
                        <dd>{c.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </section>
              <section className="panel" aria-labelledby="cols-h">
                <div className="panel__head"><h2 id="cols-h" className="panel__title">Item columns</h2></div>
                <div className="panel__body chips">
                  {data.itemColumns.map((c) => <span key={c} className="chip chip--static">{c}</span>)}
                </div>
              </section>
            </div>
          </div>
        </>
      )}

      <section className="panel" aria-labelledby="schemes-h" style={{ marginTop: 16 }}>
        <div className="panel__head"><h2 id="schemes-h" className="panel__title"><Icon name="layers" size={18} /> Scheme display names</h2></div>
        <div className="panel__body">
          <div className="notice notice--brass" style={{ marginTop: 8 }}>
            These names print on the report cover (“Kingston Council’s …”) and in the declaration. Changes apply to reports issued after saving; issued reports never change.
          </div>
          {(ref?.schemes ?? []).map((s) => <SchemeRow key={s.code} code={s.code} name={s.name} onSaved={() => undefined} />)}
          {!ref && <Skeleton lines={4} card={false} />}
        </div>
      </section>
    </div>
  );
}
