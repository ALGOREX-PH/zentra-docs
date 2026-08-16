import { describe, expect, it } from 'vitest';
import {
  inspectWallet,
  MAX_NAME,
  MAX_NOTE,
  normaliseWallet,
  validate,
  WALLET_LENGTH,
  walletMessage,
} from '@/lib/stellar/wallet-input';

/** A well-formed testnet account id: G plus 55 base32 characters. */
const VALID_KEY = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';

/** Values that pass every rule, for tests that break exactly one. */
const GOOD: Parameters<typeof validate>[0] = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  wallet: VALID_KEY,
  note: '',
};

describe('inspectWallet', () => {
  it('accepts a well-formed G-address', () => {
    expect(inspectWallet(VALID_KEY)).toEqual({ kind: 'valid' });
  });

  it('reports an empty value as empty, not invalid', () => {
    expect(inspectWallet('')).toEqual({ kind: 'empty' });
  });

  it('warns loudly on an S-prefix — a secret key must never be pasted', () => {
    const state = inspectWallet('SDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO');
    expect(state.kind).toBe('invalid');
    if (state.kind !== 'invalid') return;
    expect(state.reason).toMatch(/secret key/i);
    expect(state.reason).toMatch(/do not paste/i);
  });

  it('names a C-prefix as a contract id, not a generic mistake', () => {
    const state = inspectWallet('CDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO');
    expect(state.kind).toBe('invalid');
    if (state.kind !== 'invalid') return;
    expect(state.reason).toMatch(/contract id/i);
  });

  it('rejects any other leading character with the G rule', () => {
    const state = inspectWallet('XDUY4FYOA7C5');
    expect(state).toEqual({ kind: 'invalid', reason: 'A Stellar account id starts with G.' });
  });

  it('rejects characters outside the base32 alphabet (0, 1, 8, 9, lowercase)', () => {
    for (const value of ['G0AB', 'G1AB', 'G8AB', 'G9AB', 'Gabc']) {
      const state = inspectWallet(value);
      expect(state.kind).toBe('invalid');
      if (state.kind !== 'invalid') continue;
      expect(state.reason).toMatch(/A–Z and digits 2–7/);
    }
  });

  it('rejects an over-length value and reports the actual count', () => {
    const state = inspectWallet(`${VALID_KEY}AA`);
    expect(state.kind).toBe('invalid');
    if (state.kind !== 'invalid') return;
    expect(state.reason).toContain(`${WALLET_LENGTH + 2} characters`);
    expect(state.reason).toContain(`exactly ${WALLET_LENGTH}`);
  });

  it('treats an under-length value as typing in progress, with its length', () => {
    const partial = VALID_KEY.slice(0, 20);
    expect(inspectWallet(partial)).toEqual({ kind: 'typing', length: 20 });
  });
});

describe('walletMessage', () => {
  it('returns null for a valid state — nothing blocks submission', () => {
    expect(walletMessage({ kind: 'valid' })).toBeNull();
  });

  it('asks for the account id when the field is empty', () => {
    expect(walletMessage({ kind: 'empty' })).toBe('Enter your Stellar testnet account id.');
  });

  it('reports typing progress as a count, not a fault', () => {
    expect(walletMessage({ kind: 'typing', length: 12 })).toBe(
      `12 of ${WALLET_LENGTH} characters — paste the whole address.`,
    );
  });

  it('passes an invalid reason through untouched', () => {
    expect(walletMessage({ kind: 'invalid', reason: 'why' })).toBe('why');
  });
});

describe('normaliseWallet', () => {
  it('strips whitespace anywhere in the value — pastes arrive wrapped', () => {
    expect(normaliseWallet(`  ${VALID_KEY.slice(0, 28)}\n\t ${VALID_KEY.slice(28)}  `)).toBe(
      VALID_KEY,
    );
  });

  it('uppercases — a strkey has no lowercase letters, so case is transport damage', () => {
    expect(normaliseWallet(VALID_KEY.toLowerCase())).toBe(VALID_KEY);
  });

  it('leaves an already-clean value untouched', () => {
    expect(normaliseWallet(VALID_KEY)).toBe(VALID_KEY);
  });
});

describe('validate', () => {
  it('returns no errors for a fully valid form', () => {
    expect(validate(GOOD)).toEqual({});
  });

  it('requires a non-blank name and caps its length', () => {
    expect(validate({ ...GOOD, name: '   ' }).name).toBe('Enter your name.');
    expect(validate({ ...GOOD, name: 'a'.repeat(MAX_NAME + 1) }).name).toBe(
      `Name must be ${MAX_NAME} characters or fewer.`,
    );
  });

  it('rejects malformed email addresses', () => {
    for (const email of ['', 'nope', 'a@b', 'a b@c.d']) {
      expect(validate({ ...GOOD, email }).email).toBe('Enter a valid email address.');
    }
  });

  it('carries the wallet grading through as the field error', () => {
    expect(validate({ ...GOOD, wallet: '' }).wallet).toBe('Enter your Stellar testnet account id.');
    expect(validate({ ...GOOD, wallet: 'S' }).wallet).toMatch(/secret key/i);
  });

  it('tolerates surrounding whitespace on the wallet — the form trims before grading', () => {
    expect(validate({ ...GOOD, wallet: `  ${VALID_KEY}  ` }).wallet).toBeUndefined();
  });

  it('allows the note to be absent but caps its length', () => {
    expect(validate({ ...GOOD, note: '' }).note).toBeUndefined();
    expect(validate({ ...GOOD, note: 'a'.repeat(MAX_NOTE + 1) }).note).toBe(
      `Note must be ${MAX_NOTE} characters or fewer.`,
    );
  });
});
