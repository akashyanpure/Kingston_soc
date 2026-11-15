import { describe, expect, it } from 'vitest';
import { normalisePostcode } from './address.js';

describe('normalisePostcode', () => {
  it('normalises spacing and case', () => {
    expect(normalisePostcode('kt26eu')).toBe('KT2 6EU');
    expect(normalisePostcode(' KT2   6EU ')).toBe('KT2 6EU');
    expect(normalisePostcode('sw1a1aa')).toBe('SW1A 1AA');
    expect(normalisePostcode('M1 1AE')).toBe('M1 1AE');
  });
  it('rejects things that cannot be full postcodes', () => {
    expect(normalisePostcode('KT2')).toBeNull();
    expect(normalisePostcode('hello world')).toBeNull();
    expect(normalisePostcode('12345')).toBeNull();
  });
});
