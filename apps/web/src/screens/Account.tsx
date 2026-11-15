import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { useQueueCounts, useSyncStatus } from '../lib/hooks';
import { logout, useSession } from '../lib/session';
import { getDeviceId, syncEngine } from '../lib/sync';

export function Account() {
  const session = useSession();
  const nav = useNavigate();
  const status = useSyncStatus();
  const q = useQueueCounts();
  const [deviceId, setDeviceId] = useState('');
  const rejected = useLiveQuery(() => db.outbox.where('status').equals('rejected').toArray(), []);
  const failed = useLiveQuery(() => db.pendingActions.where('status').equals('failed').toArray(), []);
  useEffect(() => { void getDeviceId().then(setDeviceId); }, []);

  const signOut = async () => {
    if (q.total > 0 && !confirm(`${q.total} item(s) have not uploaded yet. They stay on this phone and upload after the next sign-in. Sign out?`)) return;
    await logout();
    nav('/login', { replace: true });
  };
  const retry = async () => {
    await db.outbox.where('status').equals('rejected').modify({ status: 'pending', error: undefined });
    await db.pendingActions.where('status').equals('failed').modify({ status: 'pending', error: undefined });
    void syncEngine.syncNow();
  };

  return (
    <div>
      <div className="kicker">Signed in</div>
      <h1 className="title">{session?.name}</h1>
      <p className="small muted">{session?.email} · {session?.role}</p>

      <h2 className="section-label">Sync</h2>
      <div className="card card--plain">
        <p className="small" style={{ margin: 0 }}>
          {status.online ? 'Online' : 'Offline'} · {q.mutations} change(s), {q.photos} photo(s), {q.actions} action(s) waiting
          <br />Last sync: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('en-GB') : 'not yet'}
          {status.lastError && <><br />Last error: {status.lastError}</>}
        </p>
      </div>
      <button type="button" className="btn btn--block" onClick={() => void syncEngine.syncNow({ pull: true })}>SYNC NOW</button>

      {((rejected?.length ?? 0) > 0 || (failed?.length ?? 0) > 0) && (
        <>
          <h2 className="section-label">Not accepted by the server</h2>
          <ul className="blockers">
            {rejected?.map((m) => <li key={m.seq} style={{ padding: 10 }} className="small">{m.entity} {m.id.slice(0, 8)}… — {m.error}</li>)}
            {failed?.map((a) => <li key={a.seq} style={{ padding: 10 }} className="small">{a.kind} — {a.error}</li>)}
          </ul>
          <button type="button" className="btn btn--block" onClick={() => void retry()}>RETRY ALL</button>
        </>
      )}

      <p className="mono muted" style={{ marginTop: 18 }}>Device {deviceId}</p>
      <button type="button" className="btn btn--block btn--danger" onClick={() => void signOut()}>SIGN OUT</button>
    </div>
  );
}
