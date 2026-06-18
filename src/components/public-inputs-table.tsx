// The 14 public inputs, in canonical order. This is the doc-side source of truth
// for the circuit ↔ contract ↔ serialization contract; the reference pages and
// the playground both render it from here.
const PUBLIC_INPUTS: ReadonlyArray<readonly [string, string, string]> = [
  ['policyCommitment', 'Poseidon commitment of the private policy', 'Fr'],
  ['recipientRoot', 'Merkle root of the approved recipients', 'Fr'],
  ['recipient', 'The payee, reduced to a field element', 'Fr'],
  ['amount', 'Payment amount, in stroops', 'i128 → Fr'],
  ['invoiceHash', 'Poseidon hash of the invoice preimage', 'Fr'],
  ['nullifier', 'Single-use replay marker', 'Fr'],
  ['agentAddress', 'The paying agent, reduced to a field element', 'Fr'],
  ['assetId', 'The asset (SAC), reduced to a field element', 'Fr'],
  ['contractAddress', 'The verifier contract, reduced to a field element', 'Fr'],
  ['prevEpochId', 'Epoch the prior counters belong to', 'u64 → Fr'],
  ['prevSpent', 'Spend before this action', 'i128 → Fr'],
  ['prevActionCount', 'Action count before this action', 'u64 → Fr'],
  ['newSpent', 'prevSpent + amount', 'i128 → Fr'],
  ['newActionCount', 'prevActionCount + 1', 'u64 → Fr'],
];

export function PublicInputsTable() {
  return (
    <div className="my-6 overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Signal</th>
            <th>Meaning</th>
            <th>Encoding</th>
          </tr>
        </thead>
        <tbody>
          {PUBLIC_INPUTS.map(([name, meaning, enc], i) => (
            <tr key={name}>
              <td className="font-mono text-fd-muted-foreground">{i + 1}</td>
              <td>
                <code>{name}</code>
              </td>
              <td>{meaning}</td>
              <td className="whitespace-nowrap font-mono text-xs">{enc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
