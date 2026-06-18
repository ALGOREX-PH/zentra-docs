import { protocol, stellarExpertContractUrl } from '@/config/protocol';

/** The live testnet contract id, linked to Stellar Expert. Never hardcode it in prose. */
export function ContractId() {
  return (
    <a
      href={stellarExpertContractUrl}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[0.85em] break-all text-fd-primary hover:underline"
    >
      {protocol.contractId}
    </a>
  );
}

export function RpcUrl() {
  return <code>{protocol.rpcUrl}</code>;
}

export function NetworkPassphrase() {
  return <code>{protocol.networkPassphrase}</code>;
}

export function CpuBudget() {
  return <span>{protocol.cpuBudget}</span>;
}

export function AssetLabel() {
  return <span>{protocol.asset}</span>;
}
