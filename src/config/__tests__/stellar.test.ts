import { Networks } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILES } from '@/config/network';

/**
 * `@/config/stellar` derives everything from `activeProfile`, which is fixed
 * at module load — so each case stubs the network selector and re-imports the
 * module fresh rather than trusting the ambient environment.
 */
async function loadStellar(network: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', network);
  return (await import('@/config/stellar')).stellar;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the explorer URL builders', () => {
  it('embed the hash, address and contract id in the testnet URLs', async () => {
    const stellar = await loadStellar('testnet');
    const hash = 'ab'.repeat(32);
    const account = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';
    const contract = 'CCSXFTQTWVSHUMH2C64RJKY7JKCVHD5REFIW3P3YPVY6PWHVSJ7ZDDES';
    expect(stellar.explorerTxUrl(hash)).toBe(`https://stellar.expert/explorer/testnet/tx/${hash}`);
    expect(stellar.explorerAccountUrl(account)).toBe(
      `https://stellar.expert/explorer/testnet/account/${account}`,
    );
    expect(stellar.explorerContractUrl(contract)).toBe(
      `https://stellar.expert/explorer/testnet/contract/${contract}`,
    );
  });

  it('switch to the public segment on mainnet', async () => {
    const stellar = await loadStellar('public');
    expect(stellar.explorerTxUrl('deadbeef')).toBe(
      'https://stellar.expert/explorer/public/tx/deadbeef',
    );
    expect(stellar.explorerAccountUrl('GABC')).toBe(
      'https://stellar.expert/explorer/public/account/GABC',
    );
    expect(stellar.explorerContractUrl('CABC')).toBe(
      'https://stellar.expert/explorer/public/contract/CABC',
    );
  });
});

describe('friendbot', () => {
  it('is exposed with its profile URL on testnet', async () => {
    const stellar = await loadStellar('testnet');
    expect(stellar.hasFriendbot).toBe(true);
    expect(stellar.friendbotUrl).toBe(PROFILES.testnet.friendbotUrl);
  });

  it('maps the mainnet null to an empty string and reports no faucet', async () => {
    const stellar = await loadStellar('public');
    expect(PROFILES.public.friendbotUrl).toBeNull();
    expect(stellar.friendbotUrl).toBe('');
    expect(stellar.hasFriendbot).toBe(false);
  });
});

describe('profile passthrough', () => {
  it('mirrors the testnet profile endpoints and passphrase', async () => {
    const stellar = await loadStellar('testnet');
    expect(stellar.network).toBe('testnet');
    expect(stellar.horizonUrl).toBe(PROFILES.testnet.horizonUrl);
    expect(stellar.rpcUrl).toBe(PROFILES.testnet.rpcUrl);
    expect(stellar.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('mirrors the public profile endpoints and passphrase', async () => {
    const stellar = await loadStellar('public');
    expect(stellar.network).toBe('public');
    expect(stellar.horizonUrl).toBe(PROFILES.public.horizonUrl);
    expect(stellar.rpcUrl).toBe(PROFILES.public.rpcUrl);
    expect(stellar.networkPassphrase).toBe(Networks.PUBLIC);
  });
});
