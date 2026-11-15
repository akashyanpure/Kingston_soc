import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { PropertyFields, emptyPropertyDraft, LOOKUP_DEBOUNCE_MS, type PropertyDraft } from '../components/PropertyFields';
import { installMockApi, resetMockApi } from '../dev/mockApi';
import { api, getFetch, setFetch } from '../lib/api';

let latest: PropertyDraft;
function Harness() {
  const [v, setV] = useState<PropertyDraft>(emptyPropertyDraft());
  latest = v;
  return <PropertyFields value={v} onChange={setV} idPrefix="t" />;
}
const pc = () => screen.getByRole('combobox', { name: 'Postcode' }) as HTMLInputElement;
const type = (text: string) => { pc().focus(); fireEvent.change(pc(), { target: { value: text } }); };

let calls: string[] = [];
beforeEach(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  resetMockApi();
  installMockApi({ delayMs: 0 });
  await api('/auth/dev-login', { method: 'POST', json: { userId: '0196f000-0000-7000-8000-0000000000a1' } });
  calls = [];
  const inner = getFetch();
  setFetch((url, init) => { calls.push(url); return inner(url, init); });
});
afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

describe('postcode lookup', () => {
  it('debounces, then offers postcode suggestions in an accessible listbox', async () => {
    render(<Harness />);
    type('KT2');
    expect(calls.filter((c) => c.includes('/address/'))).toHaveLength(0); // nothing before the debounce
    await act(() => new Promise((r) => setTimeout(r, LOOKUP_DEBOUNCE_MS + 60)));
    expect(calls.filter((c) => c.includes('/address/autocomplete?q=KT2'))).toHaveLength(1);
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent?.trim())).toContain('KT2 6EU');
    expect(pc().getAttribute('aria-expanded')).toBe('true');
    // Arrow keys move the active option; Escape closes.
    fireEvent.keyDown(pc(), { key: 'ArrowDown' });
    expect(pc().getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    fireEvent.keyDown(pc(), { key: 'Escape' });
    expect(pc().getAttribute('aria-expanded')).toBe('false');
  });

  it('fills the town from the lookup and shows district · ward', async () => {
    render(<Harness />);
    type('kt56 9aa'.replace('56 ', '5 '));
    expect(await screen.findByText(/Kingston upon Thames · Tolworth ward/)).toBeTruthy();
    expect(latest.town).toBe('Surbiton');
    expect(latest.postcode).toBe('KT5 9AA');
  });

  it('warns (without blocking) when the postcode is outside Kingston', async () => {
    render(<Harness />);
    type('SW1A 1AA');
    expect(await screen.findByText(/outside the Royal Borough/)).toBeTruthy();
    expect(latest.town).toBe('London');
  });

  it('says "couldn’t find" for an unknown postcode but keeps manual entry', async () => {
    render(<Harness />);
    type('KT9 9ZZ');
    expect(await screen.findByText(/couldn't find that postcode/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Address line 1'), { target: { value: '1 New Street' } });
    expect(latest.addressLine1).toBe('1 New Street');
  });

  it('offline: skips lookup quietly with a note', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    render(<Harness />);
    type('KT2 6EU');
    expect(await screen.findByText('Address lookup unavailable — enter manually.')).toBeTruthy();
    expect(calls.filter((c) => c.includes('/address/'))).toHaveLength(0);
  });

  it('provider unavailable (502 LOOKUP_UNAVAILABLE) falls back to manual entry', async () => {
    setFetch(async () => new Response(JSON.stringify({ error: { code: 'LOOKUP_UNAVAILABLE', message: 'Provider down' } }), { status: 502 }));
    render(<Harness />);
    type('KT2 6EU');
    expect(await screen.findByText('Address lookup unavailable — enter manually.')).toBeTruthy();
  });

  it('OS Places pick-list fills the address lines and a read-only UPRN', async () => {
    render(<Harness />);
    type('KT2 6EU');
    expect(await screen.findByText('Select the address')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /14 Acre Road/ }));
    await waitFor(() => expect(latest.addressLine1).toBe('14 Acre Road'));
    expect(latest).toMatchObject({ uprn: '128001236', uprnFromLookup: true, postcode: 'KT2 6EU', town: 'Kingston upon Thames' });
    const uprn = screen.getByLabelText(/UPRN/) as HTMLInputElement;
    expect(uprn.readOnly).toBe(true);
    expect(uprn.value).toBe('128001236');
    expect(screen.queryByText('Select the address')).toBeNull();
  });
});
