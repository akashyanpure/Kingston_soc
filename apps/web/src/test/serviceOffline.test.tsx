import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setFetch } from '../lib/api';
import { db } from '../lib/db';
import { saveEdit } from '../lib/mutations';
import { SyncEngine } from '../lib/sync';
import { Login } from '../screens/Login';
import { form, freshDb, seedVisit } from './helpers';

/** What CloudFront answers for every /api/* call while the server is switched off. */
const switchedOff = async () => new Response(
  JSON.stringify({ error: { code: 'SERVICE_OFFLINE', message: 'Kingston SOC is switched off. Your work is kept on the device.' } }),
  { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '300' } },
);

beforeEach(async () => {
  await freshDb();
  setFetch(switchedOff);
});

describe('service switched off (503 SERVICE_OFFLINE)', () => {
  it('sync keeps the queue and goes to the calm "off" state, not an error', async () => {
    const visitId = await seedVisit(form(), ['KITCHEN']);
    await db.pendingActions.clear();
    const item = (await db.items.where('visitId').equals(visitId).first())!;
    await saveEdit('item_record', item.id, { condition: 'G' });

    const engine = new SyncEngine();
    engine.pullEnabled = false;
    await engine.runOnce();
    expect(engine.getStatus().phase).toBe('off');
    expect(engine.getStatus().lastError).toBeNull();
    expect(await db.outbox.count()).toBe(1); // nothing lost, nothing rejected
    expect((await db.outbox.toArray())[0]!.status).toBe('pending');
    engine.stop();
  });

  it('the login screen shows a friendly notice instead of an error', async () => {
    render(<Login />);
    expect(await screen.findByText('The service is switched off right now. Ask your administrator to start it.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
