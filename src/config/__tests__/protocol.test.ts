import { describe, expect, it } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { protocol, stellarExpertContractUrl } from '@/config/protocol';

/**
 * `src/config/protocol.ts` is deliberately import-free: it is inlined into
 * docs bundles and must not drag @stellar/stellar-sdk (or anything else) in
 * with it. That means its facts are hand-typed — so this test, which CAN
 * afford the SDK import, is where those facts are checked against the SDK
 * instead of trusting the transcription.
 */
describe('protocol facts stay honest', () => {
  it('hand-typed testnet passphrase matches the SDK exactly', () => {
    expect(protocol.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('contract id is a plausible Stellar contract address', () => {
    // C-addresses are 56 chars of RFC 4648 base32 starting with C.
    expect(protocol.contractId).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it('explorer link embeds the canonical contract id', () => {
    expect(stellarExpertContractUrl).toBe(
      `https://stellar.expert/explorer/testnet/contract/${protocol.contractId}`,
    );
  });
});
