import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@soc/shared';
import { AppRoutes } from '../App';
import { installMockApi, resetMockApi } from '../dev/mockApi';
import { api, getFetch, setFetch } from '../lib/api';
import { setMeta } from '../lib/db';
import { canAccess, homeFor } from '../lib/portal';
import { fetchReference } from '../lib/reference';
import { freshDb } from './helpers';

const USERS: Record<Role, { id: string; email: string; name: string; role: Role }> = {
  officer: { id: '0196f000-0000-7000-8000-0000000000a1', email: 'p.dekaate@kingston.test', name: 'P. Dekaate', role: 'officer' },
  manager: { id: '0196f000-0000-7000-8000-0000000000a2', email: 'manager@kingston.test', name: 'R. Okafor', role: 'manager' },
  admin: { id: '0196f000-0000-7000-8000-0000000000a5', email: 'admin@kingston.test', name: 'J. Whitfield', role: 'admin' },
};

async function signInAs(role: Role) {
  await freshDb();
  resetMockApi();
  installMockApi({ delayMs: 0 });
  await api('/auth/dev-login', { method: 'POST', json: { userId: USERS[role].id } });
  await setMeta('session', USERS[role]);
  await fetchReference();
}

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('role homes and guards', () => {
  it('maps roles to ROLE_HOME and areas', () => {
    expect(homeFor('officer')).toBe('/visits');
    expect(homeFor('manager')).toBe('/manage');
    expect(homeFor('admin')).toBe('/admin');
    expect(canAccess('officer', 'manage')).toBe(false);
    expect(canAccess('manager', 'admin')).toBe(false);
    expect(canAccess('admin', 'manage')).toBe(true);
    expect(canAccess('manager', 'officer')).toBe(false);
    expect(canAccess('admin', 'officer')).toBe(false);
    expect(canAccess('officer', 'officer')).toBe(true);
  });

  it('sends each role from / to its home', async () => {
    await signInAs('manager');
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Inventory operations' })).toBeTruthy();
  });

  it('after sign-in, /login redirects to the role home', async () => {
    await signInAs('admin');
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeTruthy();
  });

  it('an officer cannot open /manage or /admin', async () => {
    await signInAs('officer');
    renderAt('/manage');
    expect(await screen.findByText('My visits')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Inventory operations' })).toBeNull();
  });

  it('a manager cannot open /admin; an admin can open /manage', async () => {
    await signInAs('manager');
    const { unmount } = renderAt('/admin/system');
    expect(await screen.findByRole('heading', { name: 'Inventory operations' })).toBeTruthy();
    unmount();
    await signInAs('admin');
    renderAt('/manage/reports');
    expect(await screen.findByRole('heading', { name: 'Reports archive' })).toBeTruthy();
  });
});

describe('portal screens on the dev mock', () => {
  it('manager dashboard shows KPIs, workload and the action lists', async () => {
    await signInAs('manager');
    renderAt('/manage');
    expect((await screen.findAllByText('Unacceptable items')).length).toBe(2); // KPI tile + panel heading
    expect(await screen.findByRole('heading', { name: /Officer workload/ })).toBeTruthy();
    const workload = screen.getByRole('list', { name: /Visits per officer/ });
    expect(within(workload).getByText('S. Ahmed')).toBeTruthy(); // workload list
    expect(screen.getByRole('heading', { name: /Issued without landlord signature/ })).toBeTruthy();
  });

  it('admin users lists every account with role pills', async () => {
    await signInAs('admin');
    renderAt('/admin/users');
    const table = await screen.findByRole('table', { name: 'Users' });
    expect(within(table).getByText('P. Dekaate')).toBeTruthy();
    expect(within(table).getByText('manager@kingston.test')).toBeTruthy();
    expect(within(table).getAllByText('Admin').length).toBeGreaterThan(0);
  });

  it('admin users explains the self-lockout guard', async () => {
    await signInAs('admin');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/admin/users');
    const table = await screen.findByRole('table', { name: 'Users' });
    const me = within(table).getByText('J. Whitfield').closest('tr')!;
    fireEvent.click(within(me).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText(/can’t remove your own admin access/)).toBeTruthy();
  });

  it('description library groups phrases by item and adds a phrase', async () => {
    await signInAs('admin');
    renderAt('/admin/library');
    expect(await screen.findByText('Emulsion, magnolia')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Walls' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Phrase'), { target: { value: 'Stencilled border' } });
    fireEvent.click(screen.getByRole('button', { name: /Add phrase/ }));
    expect(await screen.findByText('Stencilled border')).toBeTruthy();
  });

  it('assigning a visit calls PATCH /visits/:id/assign with the chosen officer', async () => {
    await signInAs('manager');
    const calls: { url: string; method: string; body?: string }[] = [];
    const inner = getFetch();
    setFetch((url, init) => { calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined }); return inner(url, init); });
    renderAt('/manage/visits');
    const table = await screen.findByRole('table', { name: /Visits/ });
    const assignButtons = within(table).getAllByRole('button', { name: /^Assign / });
    fireEvent.click(assignButtons[0]!);
    const select = await screen.findByLabelText('Officer', { selector: '#assign-officer' });
    const target = USERS.officer.id === (select as HTMLSelectElement).value ? '0196f000-0000-7000-8000-0000000000a4' : USERS.officer.id;
    fireEvent.change(select, { target: { value: target } });
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && /\/api\/visits\/[^/]+\/assign$/.test(c.url))).toBe(true));
    const call = calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(call.body!)).toMatchObject({ officerId: target });
    expect(JSON.parse(call.body!).scheduledAt).toMatch(/Z$/);
  });
});
