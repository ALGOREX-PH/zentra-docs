type Cat = 'path' | 'sibling' | 'dim';

interface Node {
  id: string;
  x: number;
  y: number;
  cat: Cat;
  label?: string;
}

// A depth-3 binary Merkle tree (8 leaves). The recipient is leaf L2; the cyan
// nodes trace its path to the root, and the violet nodes are the sibling hashes
// (the "Merkle proof") needed to recompute the root.
const NODES: Node[] = [
  { id: 'R', x: 340, y: 42, cat: 'path', label: 'root · public' },
  { id: 'M0', x: 180, y: 120, cat: 'path' },
  { id: 'M1', x: 500, y: 120, cat: 'sibling' },
  { id: 'N0', x: 100, y: 196, cat: 'sibling' },
  { id: 'N1', x: 260, y: 196, cat: 'path' },
  { id: 'N2', x: 420, y: 196, cat: 'dim' },
  { id: 'N3', x: 580, y: 196, cat: 'dim' },
  { id: 'L0', x: 60, y: 268, cat: 'dim' },
  { id: 'L1', x: 140, y: 268, cat: 'dim' },
  { id: 'L2', x: 220, y: 268, cat: 'path', label: 'recipient' },
  { id: 'L3', x: 300, y: 268, cat: 'sibling' },
  { id: 'L4', x: 380, y: 268, cat: 'dim' },
  { id: 'L5', x: 460, y: 268, cat: 'dim' },
  { id: 'L6', x: 540, y: 268, cat: 'dim' },
  { id: 'L7', x: 620, y: 268, cat: 'dim' },
];

const EDGES: [string, string][] = [
  ['R', 'M0'], ['R', 'M1'],
  ['M0', 'N0'], ['M0', 'N1'], ['M1', 'N2'], ['M1', 'N3'],
  ['N0', 'L0'], ['N0', 'L1'], ['N1', 'L2'], ['N1', 'L3'],
  ['N2', 'L4'], ['N2', 'L5'], ['N3', 'L6'], ['N3', 'L7'],
];

const PATH = new Set(['R', 'M0', 'N1', 'L2']);
const byId = (id: string): Node => NODES.find((n) => n.id === id) as Node;

const FILL: Record<Cat, string> = {
  path: '#00e5ff',
  sibling: '#a78bfa',
  dim: '#0d111a',
};

/** Visualizes how a recipient's membership is proven against the Merkle root. */
export function VizMerkle() {
  return (
    <div>
      <svg viewBox="0 0 660 300" className="w-full" role="img" aria-label="Merkle tree membership proof">
        {EDGES.map(([a, b]) => {
          const na = byId(a);
          const nb = byId(b);
          const hot = PATH.has(a) && PATH.has(b);
          return (
            <line
              key={a + b}
              x1={na.x}
              y1={na.y}
              x2={nb.x}
              y2={nb.y}
              stroke={hot ? '#00e5ff' : '#1a2130'}
              strokeWidth={hot ? 2 : 1}
            />
          );
        })}
        {NODES.map((n) => (
          <g key={n.id}>
            <circle
              cx={n.x}
              cy={n.y}
              r={n.cat === 'dim' ? 7 : 11}
              fill={FILL[n.cat]}
              stroke={n.cat === 'dim' ? '#334155' : 'none'}
              strokeWidth={1.5}
            />
            {n.label ? (
              <text
                x={n.x}
                y={n.cat === 'path' && n.id === 'L2' ? n.y + 26 : n.y - 18}
                textAnchor="middle"
                fontSize="12"
                fill={n.cat === 'path' ? '#00e5ff' : '#a78bfa'}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {n.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-cyan" /> path to the root
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-violet-soft" /> proof · sibling hashes
        </span>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        To prove the recipient is on the approved list, the circuit only needs the
        path to the public root — never the whole list.
      </p>
    </div>
  );
}
