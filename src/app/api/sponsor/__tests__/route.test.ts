import {
  Account,
  Asset,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/sponsor/route';
import { actionLog } from '@/config/contract';
import { stellar } from '@/config/stellar';
import { resetRateLimiter } from '@/lib/api/rate-limit';
import { MAX_SPONSORED_FEE_STROOPS, SPONSOR_SECRET_ENV } from '@/lib/api/sponsor';
import { reserveSponsorBudget, sponsorBudgetEnforced } from '@/lib/api/sponsor-budget';

vi.mock('@/lib/api/sponsor-budget', () => ({
  reserveSponsorBudget: vi.fn(),
  sponsorBudgetEnforced: vi.fn(),
}));

const reserveMock = vi.mocked(reserveSponsorBudget);
const enforcedMock = vi.mocked(sponsorBudgetEnforced);

/** A funded-looking, checksum-valid source for the inner transactions. */
const SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();

/** A stable sponsor secret, stubbed into the environment per test. */
const SPONSOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11));

/** An unsigned inner transaction invoking the feedback contract we deployed. */
const ALLOWED_XDR = new TransactionBuilder(new Account(SOURCE, '1'), {
  fee: BASE_FEE,
  networkPassphrase: stellar.networkPassphrase,
})
  .addOperation(new Contract(actionLog.feedbackId).call('submit'))
  .setTimeout(0)
  .build()
  .toXDR();

/** A perfectly valid transaction we must still refuse to pay for. */
const PAYMENT_XDR = new TransactionBuilder(new Account(SOURCE, '1'), {
  fee: BASE_FEE,
  networkPassphrase: stellar.networkPassphrase,
})
  .addOperation(Operation.payment({ destination: SOURCE, asset: Asset.native(), amount: '1' }))
  .setTimeout(0)
  .build()
  .toXDR();

let ipCounter = 0;

/** A JSON POST from a fresh address, so tests never share a rate bucket. */
function post(body: unknown, headers: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request('https://docs.zentra.dev/api/sponsor', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-real-ip': `10.5.${Math.floor(ipCounter / 200)}.${ipCounter % 200}`,
      ...headers,
    },
  });
}

beforeEach(() => {
  resetRateLimiter();
  vi.stubEnv(SPONSOR_SECRET_ENV, SPONSOR.secret());
  reserveMock.mockResolvedValue({ ok: true });
  enforcedMock.mockReturnValue(false);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  reserveMock.mockReset();
  enforcedMock.mockReset();
});

describe('POST /api/sponsor', () => {
  it('grants an approved transaction: 200 with a sponsor-signed fee-bump', async () => {
    const response = await POST(post({ xdr: ALLOWED_XDR }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.xdr).toBe('string');

    const bump = TransactionBuilder.fromXDR(body.xdr, stellar.networkPassphrase);
    expect(bump).toBeInstanceOf(FeeBumpTransaction);
    expect((bump as FeeBumpTransaction).feeSource).toBe(SPONSOR.publicKey());
    expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
  });

  it('charges the budget with the identity read from the signed envelope', async () => {
    await POST(post({ xdr: ALLOWED_XDR }));

    // One operation bidding BASE_FEE bumps at fee × (operations + 1).
    expect(reserveMock).toHaveBeenCalledWith({
      sourceAccount: SOURCE,
      feeStroops: Number(BASE_FEE) * 2,
    });
  });

  it('answers 503, not 403, when no sponsor is configured', async () => {
    vi.stubEnv(SPONSOR_SECRET_ENV, '');

    const response = await POST(post({ xdr: ALLOWED_XDR }));
    const body = await response.json();

    // The caller did nothing wrong and no change to the request can fix it.
    expect(response.status).toBe(503);
    expect(body.error.code).toBe('upstream_unavailable');
    expect(body.error.message).toBe('Fee sponsorship is not configured.');
  });

  it('refuses a disallowed operation with a 403 that never echoes the XDR', async () => {
    const response = await POST(post({ xdr: PAYMENT_XDR }));
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toBe('Fee sponsorship refused: operation_not_allowed.');
    expect(text).not.toContain(PAYMENT_XDR);
    expect(text).not.toContain(PAYMENT_XDR.slice(0, 24));
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it('refuses undecodable XDR as malformed rather than throwing', async () => {
    const response = await POST(post({ xdr: 'not-a-transaction-envelope' }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.message).toBe('Fee sponsorship refused: malformed.');
  });

  it('refuses a busted ceiling with a 403 when enforcement is on', async () => {
    enforcedMock.mockReturnValue(true);
    reserveMock.mockResolvedValue({ ok: false, reason: 'source_budget_exceeded' });

    const response = await POST(post({ xdr: ALLOWED_XDR }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toBe('Fee sponsorship refused: source_budget_exceeded.');
  });

  it('still grants past a busted ceiling in shadow mode', async () => {
    enforcedMock.mockReturnValue(false);
    reserveMock.mockResolvedValue({ ok: false, reason: 'global_budget_exceeded' });

    const response = await POST(post({ xdr: ALLOWED_XDR }));
    const body = await response.json();

    // Advisory mode: the verdict is recorded, never acted on.
    expect(response.status).toBe(200);
    expect(typeof body.xdr).toBe('string');
  });

  it('turns a ledger outage into a 503 only when enforcement is on', async () => {
    reserveMock.mockResolvedValue({
      ok: false,
      reason: 'ledger_unavailable',
      error: new Error('offline'),
    });

    enforcedMock.mockReturnValue(true);
    const enforced = await POST(post({ xdr: ALLOWED_XDR }));
    expect(enforced.status).toBe(503);
    expect((await enforced.json()).error.message).toBe(
      'Fee sponsorship accounting is unavailable.',
    );

    // In shadow mode the observability tooling must not take down the feature
    // it exists to watch: the outage is logged and the bump proceeds.
    enforcedMock.mockReturnValue(false);
    const shadow = await POST(post({ xdr: ALLOWED_XDR }));
    expect(shadow.status).toBe(200);
  });

  it('refuses an oversized XDR string with a 422 naming the field only', async () => {
    const response = await POST(post({ xdr: 'A'.repeat(64 * 1024 + 1) }));
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.xdr).toContain('64KB');
    expect(text).not.toContain('AAAAAAAA');
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it('refuses a non-JSON content type with a 415 before reading anything', async () => {
    const response = await POST(post(ALLOWED_XDR, { 'content-type': 'text/plain' }));
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body.error.code).toBe('unsupported_media_type');
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin request before any signing work', async () => {
    const response = await POST(
      post({ xdr: ALLOWED_XDR }, { origin: 'https://evil.test', host: 'docs.zentra.dev' }),
    );

    expect(response.status).toBe(403);
    expect(reserveMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/sponsor', () => {
  it('reports a configured sponsor by its public address only', async () => {
    ipCounter += 1;
    const response = await GET(
      new Request('https://docs.zentra.dev/api/sponsor', {
        headers: { 'x-real-ip': `10.6.0.${ipCounter % 200}` },
      }),
    );
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      configured: true,
      sponsor: SPONSOR.publicKey(),
      maxFeeStroops: MAX_SPONSORED_FEE_STROOPS,
    });
    expect(text).not.toContain(SPONSOR.secret());
  });

  it('reports an unconfigured deployment honestly', async () => {
    vi.stubEnv(SPONSOR_SECRET_ENV, '');
    ipCounter += 1;
    const response = await GET(
      new Request('https://docs.zentra.dev/api/sponsor', {
        headers: { 'x-real-ip': `10.6.1.${ipCounter % 200}` },
      }),
    );

    expect(await response.json()).toEqual({
      configured: false,
      sponsor: null,
      maxFeeStroops: MAX_SPONSORED_FEE_STROOPS,
    });
  });
});

describe('unsupported methods on /api/sponsor', () => {
  it('answers PUT, PATCH and DELETE with an enveloped 405 naming GET and POST', async () => {
    for (const handler of [PUT, PATCH, DELETE]) {
      const response = await handler(new Request('https://docs.zentra.dev/api/sponsor'));
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, POST');
      expect(body.error.code).toBe('method_not_allowed');
    }
  });
});
