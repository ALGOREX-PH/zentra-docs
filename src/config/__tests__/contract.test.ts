import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `@/config/contract` resolves its deployment set from `activeNetwork` at
 * module load, so each case stubs the selector variable and re-imports the
 * module fresh instead of reading whatever the ambient environment happens
 * to say.
 */
async function loadContract(network: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', network);
  return await import('@/config/contract');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Soroban contract ids: C + 55 base32 chars. */
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
/** Stellar account ids: G + 55 base32 chars. */
const ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

describe('the testnet deployment set', () => {
  it('carries well-formed contract ids for every deployed contract', async () => {
    const { actionLog } = await loadContract('testnet');
    expect(actionLog.contractId).toMatch(CONTRACT_ID);
    expect(actionLog.reputationId).toMatch(CONTRACT_ID);
    expect(actionLog.feedbackId).toMatch(CONTRACT_ID);
    expect(actionLog.proofRegistryId).toMatch(CONTRACT_ID);
  });

  it('names four distinct contracts', async () => {
    const { actionLog } = await loadContract('testnet');
    const ids = [
      actionLog.contractId,
      actionLog.reputationId,
      actionLog.feedbackId,
      actionLog.proofRegistryId,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a positive deploy ledger and a well-formed read source', async () => {
    const { actionLog } = await loadContract('testnet');
    expect(actionLog.deployLedger).toBeGreaterThan(0);
    expect(actionLog.readSource).toMatch(ACCOUNT_ID);
  });

  it('reports the contracts as configured', async () => {
    const { contractsConfigured } = await loadContract('testnet');
    expect(contractsConfigured).toBe(true);
  });
});

describe('the mainnet deployment set', () => {
  // The invariant this module exists to guarantee: nothing is deployed to the
  // public network, and the config must say so honestly rather than carry a
  // speculative id that produces undiagnosable failing reads.
  it('is entirely unpopulated', async () => {
    const { actionLog } = await loadContract('public');
    expect(actionLog.contractId).toBe('');
    expect(actionLog.reputationId).toBe('');
    expect(actionLog.feedbackId).toBe('');
    expect(actionLog.proofRegistryId).toBe('');
    expect(actionLog.deployLedger).toBe(0);
    expect(actionLog.readSource).toBe('');
  });

  it('reports the contracts as not configured', async () => {
    const { contractsConfigured } = await loadContract('public');
    expect(contractsConfigured).toBe(false);
  });

  it('is selected by the mainnet alias too', async () => {
    const { contractsConfigured } = await loadContract('mainnet');
    expect(contractsConfigured).toBe(false);
  });
});

describe('the default deployment set', () => {
  it('falls back to testnet when the network variable is unset', async () => {
    const fallback = await loadContract(undefined);
    const testnet = await loadContract('testnet');
    expect(fallback.actionLog).toEqual(testnet.actionLog);
    expect(fallback.contractsConfigured).toBe(true);
  });
});
