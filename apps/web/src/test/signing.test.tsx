import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SendSigningLinkDialog } from '../components/signing';
import { installMockApi, resetMockApi } from '../dev/mockApi';
import { api, getFetch, setFetch } from '../lib/api';
import { exportVisitsCsv } from '../screens/manage/Dashboard';
import { SignPage } from '../screens/sign/SignPage';

let calls: { url: string; method: string; body?: string }[] = [];
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  resetMockApi();
  installMockApi({ delayMs: 0 });
  calls = [];
  const inner = getFetch();
  setFetch((url, init) => { calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined }); return inner(url, init); });
});

const openSign = (token: string) =>
  render(<MemoryRouter initialEntries={[`/sign/${token}`]}><Routes><Route path="/sign/:token" element={<SignPage />} /></Routes></MemoryRouter>);

describe('public signing page', () => {
  it('valid link: shows the report, items below Good and the sign section without any app nav', async () => {
    openSign('demo-valid');
    expect(await screen.findByRole('heading', { name: /Please check and sign the Schedule of Condition for/ })).toBeTruthy();
    expect(screen.getByText(/Secure link · expires in \d+ days?/)).toBeTruthy();
    expect(screen.getByText(/Nothing is charged to you by signing/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Items not marked Good' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Dispute' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Read the full report/ })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText(/wet/i)).toBeNull(); // e-signatures only
  });

  it('expired, used and revoked links show calm explanations', async () => {
    const { unmount } = openSign('demo-expired');
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeTruthy();
    unmount();
    const u2 = openSign('demo-used');
    expect(await screen.findByRole('heading', { name: 'This report has already been signed' })).toBeTruthy();
    u2.unmount();
    const u3 = openSign('demo-revoked');
    expect(await screen.findByRole('heading', { name: 'This link has been withdrawn' })).toBeTruthy();
    u3.unmount();
    openSign('nope');
    expect(await screen.findByRole('heading', { name: /couldn’t find this link/ })).toBeTruthy();
  });

  it('signing posts name + PNG + confirm and shows the seal', async () => {
    openSign('demo-valid');
    await screen.findByRole('heading', { name: /Please check and sign/ });
    const submit = screen.getByRole('button', { name: /I agree — sign now/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Print name'), { target: { value: 'Amelia Pemberton' } });
    // The canvas pad can't be drawn in jsdom: simulate the pad emitting its PNG.
    const canvas = screen.getByRole('img', { name: /Your signature/ }) as HTMLCanvasElement;
    canvas.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150, x: 0, y: 0, toJSON: () => ({}) });
    canvas.setPointerCapture = () => {};
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.click(screen.getByRole('checkbox', { name: /I have read the report and confirm it is a fair record/ }));
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    expect(await screen.findByRole('heading', { name: 'Signed — thank you' })).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/sign/demo-valid')!;
    expect(JSON.parse(post.body!)).toEqual({ name: 'Amelia Pemberton', imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', confirm: true });
  });

  it('dispute sheet posts the item + comment and marks the item disputed', async () => {
    openSign('demo-valid');
    await screen.findByRole('heading', { name: /Please check and sign/ });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dispute' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Dispute this item' });
    fireEvent.change(within(dialog).getByLabelText(/What is wrong/), { target: { value: 'The scuff was there before we moved in.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send dispute' }));
    expect(await screen.findByText(/Disputed — the officer has been told/)).toBeTruthy();
    const post = calls.find((c) => c.url === '/api/sign/demo-valid/disputes')!;
    expect(JSON.parse(post.body!)).toMatchObject({ comment: 'The scuff was there before we moved in.' });
    expect(JSON.parse(post.body!).itemRecordId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('staff: send signing link', () => {
  it('creates a link for the landlord (prefilled), shows the URL and lists it', async () => {
    await api('/auth/dev-login', { method: 'POST', json: { userId: '0196f000-0000-7000-8000-0000000000a2' } });
    const { reports } = await api<{ reports: { reportId: string; visitId: string; landlordSigned: boolean; reportNumber: string }[] }>('/manage/reports');
    const r = reports.find((x) => !x.landlordSigned)!;
    render(<SendSigningLinkDialog open reportId={r.reportId} visitId={r.visitId} reportNumber={r.reportNumber} onClose={() => {}} />);
    const name = await screen.findByLabelText('Recipient name') as HTMLInputElement;
    await waitFor(() => expect(name.value).not.toBe(''));
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe('lettings@example.org');
    fireEvent.click(screen.getByRole('button', { name: /Create signing link/ }));
    const url = await screen.findByLabelText('Signing link');
    expect(url.textContent).toMatch(/\/sign\/tok-/);
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe(url.textContent);
    const post = calls.find((c) => c.method === 'POST' && /\/signing-links$/.test(c.url))!;
    expect(JSON.parse(post.body!)).toMatchObject({ role: 'landlord_agent', recipientEmail: 'lettings@example.org' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getAllByText('Pending').length).toBeGreaterThan(0));
  });

  it('CSV export falls back to building the file in the browser when the endpoint is missing', async () => {
    const inner = getFetch();
    setFetch((url, init) => (url.includes('visits.csv') ? Promise.resolve(new Response('{"error":{"code":"NOT_FOUND","message":"x"}}', { status: 404 })) : inner(url, init)));
    await api('/auth/dev-login', { method: 'POST', json: { userId: '0196f000-0000-7000-8000-0000000000a2' } });
    const { blob, source } = await exportVisitsCsv('2000-01-01', '2100-01-01');
    expect(source).toBe('client');
    const text = await blob.text();
    expect(text.split('\r\n')[0]).toBe('Scheduled,Address,Postcode,Scheme,Type,Officer,Status,Graded,Items,Defects,Report');
    expect(text.split('\r\n').length).toBeGreaterThan(5);
  });
});
