import { Buffer } from 'buffer';
import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc as SorobanRpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { log } from '@/lib/api/logger';
import { stellar } from '@/config/stellar';
import { actionLog } from '@/config/contract';
import { soroban } from './rpc';
import { isChainInt, simulateRead } from './action-log';
import type { ProofEntry } from './types';

const registry = new Contract(actionLog.proofRegistryId);

/**
 * SHA-256 commitment over the proof's public signals (each as 32-byte
 * big-endian). Anchoring this 32-byte commitment binds the on-chain record to
 * one specific proof without storing the whole proof on-chain.
 */
export async function commitProof(publicSignals: string[]): Promise<Uint8Array> {
  const buf = new Uint8Array(publicSignals.length * 32);
  publicSignals.forEach((sig, i) => {
    let n = BigInt(sig);
    for (let j = 31; j >= 0; j--) {
      buf[i * 32 + j] = Number(n & 0xffn);
      n >>= 8n;
    }
  });
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build the unsigned `anchor` invoke — records the proof commitment on-chain. */
export async function buildAnchorXdr(
  prover: string,
  commitment: Uint8Array,
  signals: number,
): Promise<string> {
  const account = await soroban.getAccount(prover);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.networkPassphrase,
  })
    .addOperation(
      registry.call(
        'anchor',
        Address.fromString(prover).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(commitment)),
        nativeToScVal(signals, { type: 'u32' }),
      ),
    )
    .setTimeout(60)
    .build();

  const sim = await soroban.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build().toXDR();
}

/** Total proofs anchored on-chain. */
export async function getProofCount(): Promise<number> {
  const value = await simulateRead(registry, 'get_count', []);
  return Number(value ?? 0);
}

interface RawProof {
  index: bigint | number;
  prover: string;
  commitment: Uint8Array;
  signals: bigint | number;
  ledger: bigint | number;
}

/**
 * Runtime guard for one decoded proof entry. The simulation result crosses an
 * API boundary — whatever the deployed registry emitted, not what this
 * interface hopes — so every consumed field is checked before it can reach the
 * UI. Bytes decode as `Buffer`, which `instanceof Uint8Array` covers.
 */
export function isRawProof(value: unknown): value is RawProof {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isChainInt(v.index) &&
    typeof v.prover === 'string' &&
    v.commitment instanceof Uint8Array &&
    isChainInt(v.signals) &&
    isChainInt(v.ledger)
  );
}

/** Recent anchored proofs, newest first. */
export async function getRecentProofs(limit = 20): Promise<ProofEntry[]> {
  const value = await simulateRead(registry, 'get_recent', [nativeToScVal(limit, { type: 'u32' })]);
  if (!Array.isArray(value)) return [];
  const proofs: ProofEntry[] = [];
  let skipped = 0;
  for (const entry of value) {
    if (isRawProof(entry)) {
      proofs.push({
        index: Number(entry.index),
        prover: entry.prover,
        commitment: toHex(new Uint8Array(entry.commitment)),
        signals: Number(entry.signals),
        ledger: Number(entry.ledger),
      });
    } else {
      skipped += 1;
    }
  }
  // One structured line per batch — drift belongs in the logs, not as NaN rows.
  if (skipped > 0) {
    log('warn', 'proofs.entry_skipped', { source: 'get_recent', skipped, total: value.length });
  }
  return proofs;
}
