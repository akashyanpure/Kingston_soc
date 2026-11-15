import { useMemo, useState, type FormEvent } from 'react';
import type { CreatePhraseRequest, DescriptionPhrase } from '@soc/shared';
import { EmptyState, Icon, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useApi, usePageTitle } from '../../lib/portal';
import { fetchReference, formOf, useReference } from '../../lib/reference';

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bWc\b/, 'WC');

/** Phrase targets: '*' (any item), general-schedule fields, then every template item code (deduplicated across rooms). */
function useTargets() {
  const form = formOf(useReference());
  return useMemo(() => {
    const out: { code: string; label: string; where: string }[] = [{ code: '*', label: 'Any item', where: 'Offered on every item' }];
    if (!form) return out;
    for (const g of form.general) out.push({ code: g.code, label: title(g.label), where: 'General schedule' });
    const seen = new Map<string, { label: string; rooms: string[] }>();
    for (const r of form.rooms) for (const it of r.items) {
      const cur = seen.get(it.code) ?? { label: it.label, rooms: [] };
      cur.rooms.push(title(r.label));
      seen.set(it.code, cur);
    }
    for (const [code, v] of [...seen].sort((a, b) => a[1].label.localeCompare(b[1].label))) {
      out.push({ code, label: title(v.label), where: v.rooms.length > 3 ? `${v.rooms.length} rooms` : v.rooms.join(', ') });
    }
    return out;
  }, [form]);
}

export function AdminLibrary() {
  usePageTitle('Description library');
  const targets = useTargets();
  const { data, error, loading, reload } = useApi<{ phrases: DescriptionPhrase[] }>('/admin/phrases');
  const [search, setSearch] = useState('');
  const [itemCode, setItemCode] = useState('*');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const groups = useMemo(() => {
    const by = new Map<string, DescriptionPhrase[]>();
    for (const p of data?.phrases ?? []) by.set(p.itemCode, [...(by.get(p.itemCode) ?? []), p]);
    const q = search.trim().toLowerCase();
    return targets
      .map((t) => ({ ...t, phrases: (by.get(t.code) ?? []).sort((a, b) => a.sortOrder - b.sortOrder) }))
      .filter((g) => g.phrases.length > 0 || (q && g.label.toLowerCase().includes(q)))
      .filter((g) => !q || g.label.toLowerCase().includes(q) || g.phrases.some((p) => p.phrase.toLowerCase().includes(q)));
  }, [data, targets, search]);

  const after = async (text: string) => {
    reload();
    setMsg({ tone: 'ok', text });
    try { await fetchReference(); } catch { /* officers get it on next sync */ }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!phrase.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const req: CreatePhraseRequest = { itemCode, phrase: phrase.trim() };
      await api('/admin/phrases', { method: 'POST', json: req });
      setPhrase('');
      await after(`Added “${req.phrase}”.`);
    } catch (err) {
      setMsg({ tone: 'bad', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: DescriptionPhrase) => {
    if (!confirm(`Remove “${p.phrase}”?`)) return;
    try {
      await api(`/admin/phrases/${p.id}`, { method: 'DELETE' });
      await after(`Removed “${p.phrase}”.`);
    } catch (err) {
      setMsg({ tone: 'bad', text: errorMessage(err) });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="kicker">Administration</div>
          <h1 className="title">Description library</h1>
        </div>
        {data && <span className="pill pill--outline num">{data.phrases.length} phrases</span>}
      </div>
      <p className="muted" style={{ maxWidth: '70ch' }}>One-tap descriptions officers see under each item. Keep them short and consistent — they print in the report exactly as written.</p>

      <form className="toolbar" onSubmit={(e) => void add(e)} aria-label="Add a phrase">
        <div className="field"><label className="field__label" htmlFor="lib-item">Item</label>
          <select id="lib-item" className="select" value={itemCode} onChange={(e) => setItemCode(e.target.value)}>
            {targets.map((t) => <option key={t.code} value={t.code}>{t.label}{t.code === '*' ? '' : ` — ${t.where}`}</option>)}
          </select></div>
        <div className="field" style={{ flex: 2 }}><label className="field__label" htmlFor="lib-phrase">Phrase</label>
          <input id="lib-phrase" className="input" value={phrase} maxLength={80} onChange={(e) => setPhrase(e.target.value)} placeholder="e.g. Emulsion, white" /></div>
        <button type="submit" className="btn btn--primary" disabled={busy || !phrase.trim()}><Icon name="plus" size={18} /> Add phrase</button>
      </form>
      {msg && <div className={`notice${msg.tone === 'bad' ? ' notice--strong' : ' notice--success'}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</div>}

      <div className="field" style={{ maxWidth: 420 }}>
        <label className="field__label" htmlFor="lib-search">Search items and phrases</label>
        <input id="lib-search" className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <div className="notice notice--strong" role="alert">{error}</div>}
      {loading && !data && <Skeleton lines={6} />}
      {data && groups.length === 0 && <EmptyState icon="book" title="No phrases match" />}
      <div className="two-col">
        {groups.map((g) => (
          <section key={g.code} className="card group-card" aria-labelledby={`g-${g.code}`}>
            <div className="row" style={{ marginBottom: 6 }}>
              <h2 id={`g-${g.code}`} className="item__name">{g.label}</h2>
              <span className="small muted">{g.where}</span>
            </div>
            {g.phrases.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No phrases yet.</p> : (
              <ul className="chips" style={{ listStyle: 'none', padding: 0 }}>
                {g.phrases.map((p) => (
                  <li key={p.id} className="chip chip--static chip--removable">
                    {p.phrase}
                    <button type="button" onClick={() => void remove(p)} aria-label={`Remove ${p.phrase} from ${g.label}`}><Icon name="plus" size={16} style={{ transform: 'rotate(45deg)' }} /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
