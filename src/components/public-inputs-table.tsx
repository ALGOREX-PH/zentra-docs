import { SIGNALS } from '@/lib/zk/education';

/**
 * The 14 public inputs, in canonical order, rendered from the shared SIGNALS
 * contract (`@/lib/zk/education`) — the same source the playground table and
 * the system bar count read, so the reference pages can never drift from it.
 * Rows are numbered 00–13 to match the playground's signal indices.
 */
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
          {SIGNALS.map((s, i) => (
            <tr key={s.name}>
              <td className="font-mono text-fd-muted-foreground">{String(i).padStart(2, '0')}</td>
              <td>
                <code>{s.name}</code>
              </td>
              <td>{s.meaning}</td>
              <td className="whitespace-nowrap font-mono text-xs">{s.encoding}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
