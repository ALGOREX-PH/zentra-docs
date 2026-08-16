import type { Horizon } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stellar } from '@/config/stellar';
import { fundWithFriendbot, getXlmBalance } from '@/lib/stellar/account';
import { horizon } from '@/lib/stellar/client';

// The Horizon client is the module boundary: everything below it is the network.
vi.mock('@/lib/stellar/client', () => ({
  horizon: {
    loadAccount: vi.fn(),
  },
}));

const ADDRESS = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';

/** A Horizon account response carrying exactly these balance lines. */
function accountWith(
  balances: Array<{ asset_type: string; balance: string }>,
): Horizon.AccountResponse {
  return { balances } as unknown as Horizon.AccountResponse;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getXlmBalance', () => {
  it('returns the native balance when present', async () => {
    vi.mocked(horizon.loadAccount).mockResolvedValue(
      accountWith([
        { asset_type: 'credit_alphanum4', balance: '9.0000000' },
        { asset_type: 'native', balance: '12.5000000' },
      ]),
    );

    await expect(getXlmBalance(ADDRESS)).resolves.toBe('12.5000000');
  });

  it("returns '0' for an account that exists but has no native line", async () => {
    vi.mocked(horizon.loadAccount).mockResolvedValue(
      accountWith([{ asset_type: 'credit_alphanum4', balance: '9.0000000' }]),
    );

    await expect(getXlmBalance(ADDRESS)).resolves.toBe('0');
  });

  it('returns null — not "0" — for an account Horizon has never seen', async () => {
    vi.mocked(horizon.loadAccount).mockRejectedValue({ response: { status: 404 } });

    // "Not created yet" and "created with nothing in it" render differently.
    await expect(getXlmBalance(ADDRESS)).resolves.toBeNull();
  });

  it('rethrows anything that is not a 404', async () => {
    const outage = { response: { status: 503 } };
    vi.mocked(horizon.loadAccount).mockRejectedValue(outage);

    await expect(getXlmBalance(ADDRESS)).rejects.toBe(outage);
  });

  it('rethrows a network-level failure with no response at all', async () => {
    const network = new Error('Network Error');
    vi.mocked(horizon.loadAccount).mockRejectedValue(network);

    await expect(getXlmBalance(ADDRESS)).rejects.toBe(network);
  });
});

describe('fundWithFriendbot', () => {
  it('resolves on a successful funding and asks the configured Friendbot', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(fundWithFriendbot(ADDRESS)).resolves.toBeUndefined();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith(stellar.friendbotUrl)).toBe(true);
    expect(url).toContain(encodeURIComponent(ADDRESS));
  });

  it('treats an already-funded account as success', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"detail":"createAccountAlreadyExist (op_already_exists)"}', { status: 400 }),
    );

    await expect(fundWithFriendbot(ADDRESS)).resolves.toBeUndefined();
  });

  it("recognises Friendbot's AlreadyExist wording too", async () => {
    fetchMock.mockResolvedValue(new Response('account AlreadyExist', { status: 400 }));

    await expect(fundWithFriendbot(ADDRESS)).resolves.toBeUndefined();
  });

  it('throws a readable error for any other Friendbot failure', async () => {
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(fundWithFriendbot(ADDRESS)).rejects.toThrow(/could not fund/i);
  });
});
