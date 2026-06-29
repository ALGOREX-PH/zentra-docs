import { describe, it, expect } from 'vitest';
import {
  truncateAddress,
  isValidPublicKey,
  isValidAmount,
  formatXlm,
} from '@/lib/stellar/format';

const VALID_KEY = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';

describe('isValidPublicKey', () => {
  it('accepts a well-formed testnet G-address', () => {
    expect(isValidPublicKey(VALID_KEY)).toBe(true);
  });

  it('rejects malformed input and empty strings', () => {
    expect(isValidPublicKey('not-a-key')).toBe(false);
    expect(isValidPublicKey('')).toBe(false);
  });
});

describe('isValidAmount', () => {
  it('accepts positive decimals within 7 places', () => {
    expect(isValidAmount('1')).toBe(true);
    expect(isValidAmount('12.5')).toBe(true);
    expect(isValidAmount('0.0000001')).toBe(true);
  });

  it('rejects zero, negatives, non-numbers, and over-precise values', () => {
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('-1')).toBe(false);
    expect(isValidAmount('abc')).toBe(false);
    expect(isValidAmount('1.123456789')).toBe(false);
  });
});

describe('truncateAddress', () => {
  it('shortens a long address with an ellipsis', () => {
    const result = truncateAddress(VALID_KEY);
    expect(result).toContain('…');
    expect(result.startsWith('GDUY')).toBe(true);
  });
});

describe('formatXlm', () => {
  it('groups thousands and renders zero plainly', () => {
    expect(formatXlm('1234.5')).toBe('1,234.5');
    expect(formatXlm('0')).toBe('0');
  });
});
