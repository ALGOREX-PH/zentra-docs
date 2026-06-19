'use client';

import { useEffect, useRef } from 'react';

const NODES: [number, number][] = [
  [90, 70], [260, 70], [430, 70], [260, 170], [90, 270], [260, 270], [430, 270],
];
const RECTS: [number, number][] = [
  [81, 61], [251, 61], [421, 61], [251, 161], [81, 261], [251, 261], [421, 261],
];
const MSG: Record<string, string[]> = {
  valid: ['composing action', 'checking private policy', 'generating proof', 'binding to authority state', 'verifying on-chain', 'settling on Stellar', 'receipt emitted'],
  injection: ['composing action', 'checking private policy'],
  overspend: ['composing action', 'checking private policy', 'generating proof', 'binding to authority state'],
};
const PILLS = ['COMPOSING', 'POLICY', 'PROVING', 'BINDING', 'VERIFYING', 'SETTLING', 'RELEASED'];
const V = '#7c3aed', C = '#00e5ff', G = '#22c55e', R = '#ef4444';

export function ProofEngine() {
  const root = useRef<HTMLDivElement>(null);
  const play = useRef<(s: string) => void>(() => {});

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let alive = true, loop = true, busy = false;
    const timers: number[] = [];
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const q = (s: string) => el.querySelector(s) as HTMLElement | null;
    const rect = (i: number) => el.querySelector(`[data-i="${i}"] rect`) as SVGRectElement | null;
    const fill = q('[data-z-fill]') as unknown as SVGPathElement;
    const cap = q('[data-z-capsule]') as unknown as SVGGElement;
    const seal = q('[data-z-seal]') as unknown as SVGGElement;
    const burn = q('[data-z-burn]') as unknown as SVGLineElement;
    if (!fill || !cap || !seal || !burn) return;

    const cum = [0];
    for (let i = 1; i < NODES.length; i++) {
      const a = NODES[i - 1], b = NODES[i];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    const len = fill.getTotalLength ? fill.getTotalLength() : total;
    fill.style.transition = 'stroke-dashoffset .55s ease, stroke .3s';
    fill.style.strokeDasharray = String(len);
    fill.style.strokeDashoffset = String(len);
    cap.style.transition = 'transform .55s cubic-bezier(.45,0,.3,1), opacity .3s';

    const sleep = (ms: number) => new Promise<void>((res) => { const t = window.setTimeout(res, reduced ? 0 : ms); timers.push(t); });
    const setPill = (t: string, c: string) => { const p = q('[data-z-pill]'); if (p) { p.textContent = t; p.style.color = c; p.style.borderColor = c; p.style.background = c + '1f'; } };
    const setStatus = (t: string, c?: string) => { const s = q('[data-z-status]'); if (s) { s.textContent = t; s.style.color = c || '#e2e8f0'; } };
    const setOutput = (t: string, c?: string) => { const o = q('[data-z-output]'); if (o) { o.textContent = t; o.style.color = c || '#64748b'; } };
    const activate = (i: number, c: string) => { const r = rect(i); if (r) { r.style.stroke = c; r.style.fill = c + '26'; r.style.filter = `drop-shadow(0 0 6px ${c})`; } };
    const advance = (i: number, c?: string) => { fill.style.strokeDashoffset = String(len * (1 - cum[i] / total)); if (c) fill.style.stroke = c; };
    const reset = () => {
      for (let i = 0; i < 7; i++) { const r = rect(i); if (r) { r.style.stroke = 'rgba(148,163,184,0.4)'; r.style.fill = '#0d111a'; r.style.filter = 'none'; } }
      fill.style.strokeDashoffset = String(len); fill.style.stroke = 'url(#zgrad)';
      cap.style.transform = `translate(${NODES[0][0]}px,${NODES[0][1]}px)`; cap.style.opacity = '0';
      seal.style.transition = 'none'; seal.style.opacity = '0'; seal.style.transform = 'scale(0.5)';
      burn.style.opacity = '0';
      setPill('COMPOSING', V); setStatus('composing action'); setOutput('awaiting submission');
    };
    const burnAt = (i: number) => {
      const [x, y] = NODES[i];
      burn.setAttribute('x1', String(x - 17)); burn.setAttribute('y1', String(y - 17));
      burn.setAttribute('x2', String(x + 17)); burn.setAttribute('y2', String(y + 17));
      burn.style.opacity = '1'; cap.style.opacity = '0';
    };

    async function run(scenario: string) {
      if (busy) return; busy = true; reset(); await sleep(150); cap.style.opacity = '1';
      const stop = scenario === 'valid' ? 6 : scenario === 'injection' ? 1 : 3;
      for (let i = 0; i <= stop; i++) {
        if (!alive) { busy = false; return; }
        const fail = scenario !== 'valid' && i === stop;
        activate(i, fail ? R : i >= 4 ? C : V);
        advance(i, fail ? R : undefined);
        cap.style.transform = `translate(${NODES[i][0]}px,${NODES[i][1]}px)`;
        const m = MSG[scenario][i];
        if (m) setStatus(m, fail ? R : '#e2e8f0');
        setPill(fail ? 'BLOCKED' : PILLS[i], fail ? R : i === 6 ? G : '#c4b5fd');
        await sleep(640);
      }
      if (scenario === 'valid') {
        cap.style.opacity = '0'; seal.style.transition = 'none'; seal.style.opacity = '1'; seal.style.transform = 'scale(1)';
        setPill('RELEASED', G); setStatus('receipt emitted', G);
        setOutput('proof verified · payment released · receipt 0x9f3a…a3c1d7', G);
      } else if (scenario === 'injection') {
        burnAt(1); setStatus('recipient not in approved set', R); setOutput('no proof generated · no payment moved', R);
      } else {
        burnAt(3); setStatus('state mismatch', R); setOutput('claimed prev_spent=0  ≠  chain spent=500  ·  no payment moved', R);
      }
      busy = false;
    }
    play.current = (s: string) => { loop = false; void run(s); };

    reset();
    if (reduced) {
      for (let i = 0; i < 7; i++) activate(i, i >= 4 ? C : V);
      advance(6); cap.style.opacity = '0'; seal.style.opacity = '1'; seal.style.transform = 'scale(1)';
      setPill('RELEASED', G); setStatus('receipt emitted', G); setOutput('proof verified · payment released', G);
      return () => { alive = false; timers.forEach(clearTimeout); };
    }
    void (async () => {
      await sleep(650);
      while (alive && loop) { await run('valid'); await sleep(2700); if (!alive || !loop) break; reset(); await sleep(450); }
    })();
    return () => { alive = false; loop = false; timers.forEach(clearTimeout); };
  }, []);

  return (
    <div ref={root} className="relative border border-violet/35 bg-panel">
      <span className="absolute -left-px -top-px h-3.5 w-3.5 border-l-2 border-t-2 border-violet" />
      <span className="absolute -right-px -top-px h-3.5 w-3.5 border-r-2 border-t-2 border-violet" />
      <span className="absolute -bottom-px -left-px h-3.5 w-3.5 border-b-2 border-l-2 border-violet" />
      <span className="absolute -bottom-px -right-px h-3.5 w-3.5 border-b-2 border-r-2 border-violet" />

      <div className="flex items-center justify-between border-b border-fd-border bg-[#0a0c12] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="size-2 bg-violet" />
          <span className="font-mono text-[11px] tracking-[0.12em] text-muted">PROOF ENGINE // SUBMIT AN ACTION</span>
        </div>
        <span data-z-pill className="border border-violet/40 px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-[0.1em] text-violet-soft" style={{ background: 'rgba(124,58,237,0.12)' }}>COMPOSING</span>
      </div>

      <div className="px-4 pt-3">
        <svg viewBox="0 0 520 340" className="block h-auto w-full" aria-label="Zentra proof path">
          <defs>
            <linearGradient id="zgrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7c3aed" />
              <stop offset="1" stopColor="#00e5ff" />
            </linearGradient>
          </defs>
          <path d="M90,70 L430,70 L90,270 L430,270" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" />
          <path data-z-fill d="M90,70 L430,70 L90,270 L430,270" fill="none" stroke="url(#zgrad)" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" style={{ filter: 'drop-shadow(0 0 5px rgba(124,58,237,0.7))' }} />
          <line data-z-burn x1="0" y1="0" x2="0" y2="0" stroke="#ef4444" strokeWidth="6" strokeLinecap="square" opacity="0" style={{ filter: 'drop-shadow(0 0 5px rgba(239,68,68,0.8))' }} />
          {RECTS.map(([x, y], i) => (
            <g data-z-node="" data-i={i} key={i}>
              <rect x={x} y={y} width="18" height="18" fill="#0d111a" stroke="rgba(148,163,184,0.4)" strokeWidth="2" style={{ transition: 'all .3s' }} />
            </g>
          ))}
          <g data-z-seal style={{ transformBox: 'view-box', transformOrigin: '430px 270px', transform: 'scale(0.5)', opacity: 0 }}>
            <polygon points="430,240 456,255 456,285 430,300 404,285 404,255" fill="rgba(0,229,255,0.05)" stroke="#00e5ff" strokeWidth="2" />
            <polyline points="420,270 427,278 442,260" fill="none" stroke="#00e5ff" strokeWidth="3" strokeLinecap="square" strokeLinejoin="miter" />
          </g>
          <g data-z-capsule style={{ transform: 'translate(90px,70px)', opacity: 0 }}>
            <rect x="-23" y="-12" width="46" height="24" fill="url(#zgrad)" style={{ filter: 'drop-shadow(0 0 10px rgba(0,229,255,0.6))' }} />
            <text x="0" y="4" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight="700" fill="#06070d">ZK</text>
          </g>
          <text x="90" y="48" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="11" letterSpacing="1" fill="#64748b">INTENT</text>
          <text x="430" y="320" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="11" letterSpacing="1" fill="#64748b">RECEIPT</text>
        </svg>
      </div>

      <div className="flex border-y border-fd-border">
        <button type="button" onClick={() => play.current('valid')} className="flex-1 border-r border-fd-border py-2.5 font-mono text-[10px] font-semibold tracking-[0.04em] sm:py-3 sm:text-[11px] sm:tracking-[0.06em] text-live transition-colors hover:bg-live/15" style={{ background: 'rgba(34,197,94,0.06)' }}>VALID PAYMENT</button>
        <button type="button" onClick={() => play.current('injection')} className="flex-1 border-r border-fd-border py-2.5 font-mono text-[10px] font-semibold tracking-[0.04em] sm:py-3 sm:text-[11px] sm:tracking-[0.06em] text-denied transition-colors hover:bg-denied/15" style={{ background: 'rgba(239,68,68,0.05)' }}>PROMPT INJECTION</button>
        <button type="button" onClick={() => play.current('overspend')} className="flex-1 py-2.5 font-mono text-[10px] font-semibold tracking-[0.04em] sm:py-3 sm:text-[11px] sm:tracking-[0.06em] text-denied transition-colors hover:bg-denied/15" style={{ background: 'rgba(239,68,68,0.05)' }}>OVER-SPEND</button>
      </div>

      <div className="px-4 pb-4 pt-3.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] text-cyan">&gt;</span>
          <span data-z-status className="font-mono text-[13px] text-[#e2e8f0]">composing action</span>
          <span className="h-3.5 w-2 bg-cyan [animation:zen-blink_1.1s_step-end_infinite]" />
        </div>
        <div data-z-output className="mt-2 font-mono text-[11px] tracking-[0.02em] text-faint">awaiting submission</div>
      </div>
    </div>
  );
}
