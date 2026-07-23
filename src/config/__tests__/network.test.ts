import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  PROFILES,
  activeNetwork,
  activeProfile,
  isMainnet,
  resolveNetwork,
} from '@/config/network';

describe('resolveNetwork', () => {
  it('accepts the canonical network names', () => {
    expect(resolveNetwork('testnet')).toBe('testnet');
    expect(resolveNetwork('public')).toBe('public');
  });

  it('accepts mainnet and pubnet as aliases for public', () => {
    expect(resolveNetwork('mainnet')).toBe('public');
    expect(resolveNetwork('pubnet')).toBe('public');
  });

  it('ignores case', () => {
    expect(resolveNetwork('TESTNET')).toBe('testnet');
    expect(resolveNetwork('Public')).toBe('public');
    expect(resolveNetwork('MainNet')).toBe('public');
    expect(resolveNetwork('PubNet')).toBe('public');
  });

  it('ignores surrounding whitespace', () => {
    expect(resolveNetwork('  testnet  ')).toBe('testnet');
    expect(resolveNetwork('\tpublic\n')).toBe('public');
    expect(resolveNetwork(' Mainnet ')).toBe('public');
  });

  it('falls back to testnet when the value is absent', () => {
    expect(resolveNetwork(undefined)).toBe('testnet');
    expect(resolveNetwork('')).toBe('testnet');
    expect(resolveNetwork('   ')).toBe('testnet');
  });

  it('falls back to testnet for anything unrecognised', () => {
    expect(resolveNetwork('futurenet')).toBe('testnet');
    expect(resolveNetwork('main')).toBe('testnet');
    expect(resolveNetwork('not-a-network')).toBe('testnet');
  });

  it('never throws, whatever it is handed', () => {
    expect(() => resolveNetwork('💥')).not.toThrow();
    expect(resolveNetwork('💥')).toBe('testnet');
  });
});

describe('PROFILES', () => {
  it('carries the passphrase constants from the SDK', () => {
    expect(PROFILES.testnet.networkPassphrase).toBe(Networks.TESTNET);
    expect(PROFILES.public.networkPassphrase).toBe(Networks.PUBLIC);
    expect(PROFILES.testnet.networkPassphrase).not.toBe(
      PROFILES.public.networkPassphrase,
    );
  });

  it('has a friendbot on testnet and none on mainnet', () => {
    expect(PROFILES.testnet.friendbotUrl).toBe('https://friendbot.stellar.org');
    expect(PROFILES.public.friendbotUrl).toBeNull();
  });

  it('uses the right stellar.expert path segment for each chain', () => {
    expect(PROFILES.testnet.explorerSegment).toBe('testnet');
    expect(PROFILES.public.explorerSegment).toBe('public');
  });

  it('points each chain at its own endpoints', () => {
    expect(PROFILES.testnet.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(PROFILES.testnet.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(PROFILES.public.horizonUrl).toBe('https://horizon.stellar.org');
    expect(PROFILES.public.rpcUrl).toBe('https://mainnet.sorobanrpc.com');
  });

  it('labels the chains for display', () => {
    expect(PROFILES.testnet.label).toBe('Testnet');
    expect(PROFILES.public.label).toBe('Mainnet');
  });

  it('keys each profile by its own network name', () => {
    expect(PROFILES.testnet.network).toBe('testnet');
    expect(PROFILES.public.network).toBe('public');
  });
});

describe('the active profile', () => {
  it('resolves from the environment and defaults to testnet', () => {
    expect(activeNetwork).toBe(resolveNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK));
    expect(activeProfile).toBe(PROFILES[activeNetwork]);
  });

  it('reports mainnet only when the public network is selected', () => {
    expect(isMainnet).toBe(activeNetwork === 'public');
  });
});
