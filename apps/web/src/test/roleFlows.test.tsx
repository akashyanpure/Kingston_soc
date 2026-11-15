/**
 * Each role sees a different app (acceptance criteria 2026-11-15):
 * landing route + heading, the exact nav items, and forbidden routes redirecting home.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import type { Role } from '@soc/shared';
import { AppRoutes } from '../App';
import { installMockApi, resetMockApi } from '../dev/mockApi';
import { api } from '../lib/api';
import { setMeta } from '../lib/db';
import { fetchReference } from '../lib/reference';
import { freshDb } from './helpers';

const USERS: Record<Role, { id: string; email: string; name: string; role: Role }> = {
  officer: { id: '0196f000-0000-7000-8000-0000000000a1', email: 'p.dekaate@kingston.test', name: 'P. Dekaate', role: 'officer' },
  manager: { id: '0196f000-0000-7000-8000-0000000000a2', email: 'manager@kingston.test', name: 'R. Okafor', role: 'manager' },
  admin: { id: '0196f000-0000-7000-8000-0000000000a5', email: 'admin@kingston.test', name: 'J. Whitfield', role: 'admin' },
};

let path = '';
function Where() {
  path = useLocation().pathname;
  return null;
}

async function as(role: Role, at: string) {
  await freshDb();
  resetMockApi();
  installMockApi({ delayMs: 0 });
  await api('/auth/dev-login', { method: 'POST', json: { userId: USERS[role].id } });
  await setMeta('session', USERS[role]);
  await fetchReference();
  return render(<MemoryRouter initialEntries={[at]}><AppRoutes /><Where /></MemoryRouter>);
}
const navLabels = (name: string) => within(screen.getByRole('navigation', { name })).getAllByRole('link').map((a) => a.textContent?.trim());

beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => {}); });

describe('officer', () => {
  it('lands on My visits with Visits · New visit · Account', async () => {
    await as('officer', '/');
    expect(await screen.findByText('My visits')).toBeTruthy();
    expect(path).toBe('/visits');
    expect(navLabels('Main')).toEqual(['Visits', 'New visit', 'Account']);
  });
  it('is sent home from /manage and /admin', async () => {
    const { unmount } = await as('officer', '/manage');
    await waitFor(() => expect(path).toBe('/visits'));
    unmount();
    await as('officer', '/admin/users');
    await waitFor(() => expect(path).toBe('/visits'));
  });
});

describe('manager', () => {
  it('lands on Inventory operations with Inventory operations · Schedule · Reports · Account', async () => {
    await as('manager', '/');
    expect(await screen.findByRole('heading', { name: 'Inventory operations' })).toBeTruthy();
    expect(path).toBe('/manage');
    expect(screen.getByText(/Private Sector Schemes · week \d+/)).toBeTruthy();
    expect(navLabels('Portal')).toEqual(['Inventory operations', 'Schedule', 'Reports', 'Account']);
    expect(screen.queryByText('My visits')).toBeNull();
    expect(screen.queryByRole('link', { name: /New visit/ })).toBeNull();
  });
  it('is sent home from /visits, /visits/new and /admin', async () => {
    for (const p of ['/visits', '/visits/new', '/admin']) {
      const { unmount } = await as('manager', p);
      await waitFor(() => expect(path).toBe('/manage'));
      expect(await screen.findByRole('heading', { name: 'Inventory operations' })).toBeTruthy();
      unmount();
    }
  });
});

describe('admin', () => {
  it('lands on Administration with its nav plus Oversight → Inventory operations', async () => {
    await as('admin', '/');
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeTruthy();
    expect(path).toBe('/admin');
    expect(navLabels('Portal')).toEqual(['Administration', 'Users', 'Description library', 'Form & schemes', 'System', 'Inventory operations']);
    expect(await screen.findByRole('heading', { name: /Recent activity/ })).toBeTruthy();
  });
  it('can open /manage (oversight) but is sent home from /visits', async () => {
    const { unmount } = await as('admin', '/manage');
    expect(await screen.findByRole('heading', { name: 'Inventory operations' })).toBeTruthy();
    expect(path).toBe('/manage');
    unmount();
    await as('admin', '/visits');
    await waitFor(() => expect(path).toBe('/admin'));
  });
});
