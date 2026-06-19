'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { protocol } from '@/config/protocol';

const shortId = (id: string) => `${id.slice(0, 4)}...${id.slice(-3)}`;

const CHECKS = [
  'Policy commitment verified',
  'Recipient is approved',
  'Amount is within limit',
  'Daily budget is valid',
  'Nullifier unused',
  'Stellar payment released',
];

const kw = { color: '#c4b5fd' };
const str = { color: '#67e8f9' };
const fn = { color: '#a78bfa' };
const num = { color: '#86efac' };
const com = { color: '#64748b' };

export function ForDevelopers() {
  const [revealed, setRevealed] = useState(0);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  const code = `import { Zentra } from "@zentra/sdk";

const zentra = new Zentra({
  network: "stellar-testnet",
  contractId: "${shortId(protocol.contractId)}",
});

const policy = await zentra.createPolicy({
  asset: "USDC",
  maxAmount: 100,
  dailyLimit: 500,
  approvedRecipients: ["GABC...", "GBXQ..."],
});

// guard the agent
const result = await zentra
  .guard(agent)
  .pay({ recipient: "GABC...", amount: 75 });

console.log(result.status); // released`;

  const reveal = useCallback(async () => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) { setRevealed(CHECKS.length); return; }
    for (let i = 1; i <= CHECKS.length; i++) {
      await new Promise((r) => setTimeout(r, 260));
      setRevealed(i);
    }
  }, []);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !ran.current) { ran.current = true; reveal(); io.disconnect(); }
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [reveal]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <section id="developer" ref={wrap} className="border-t border-violet/20 bg-abyss px-5 py-14 sm:px-7 sm:py-20">
      <div className="mx-auto max-w-[1160px]">
        <div className="mb-10 flex items-center gap-3.5">
          <span className="font-mono text-xs tracking-[0.12em] text-violet">[ 04 ] FOR DEVELOPERS</span>
          <span className="h-px flex-1 bg-violet/25" />
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[40px]">
              Guard an agent in an afternoon.
            </h2>
            <p className="mb-[30px] mt-4 max-w-[480px] text-[17px] text-muted">
              Bolt policy enforcement onto an agent without learning ZK theory. Define
              a policy, guard the agent, and let the proof do the rest.
            </p>
            <div className="border border-fd-border">
              {CHECKS.map((c, i) => {
                const last = i === CHECKS.length - 1;
                return (
                  <div
                    key={c}
                    className="flex items-center gap-3 border-b border-fd-border px-4 py-2.5 font-mono text-[13px] transition-opacity duration-500 last:border-b-0"
                    style={{ opacity: i < revealed ? 1 : 0, color: last ? '#22c55e' : '#e2e8f0', fontWeight: last ? 600 : 400 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 15 15" aria-hidden>
                      <polyline points="2,8 6,12 13,3" fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
                    </svg>
                    {c}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative border border-violet/35 bg-panel">
            <span className="absolute -left-px -top-px h-3.5 w-3.5 border-l-2 border-t-2 border-violet" />
            <span className="absolute -bottom-px -right-px h-3.5 w-3.5 border-b-2 border-r-2 border-violet" />
            <div className="flex items-center justify-between border-b border-fd-border bg-[#0a0c12] px-4 py-3">
              <span className="font-mono text-[11px] tracking-[0.06em] text-muted">agent.ts · @zentra/sdk</span>
              <button
                type="button"
                onClick={copy}
                className="border border-fd-border px-2.5 py-1 font-mono text-[11px] tracking-[0.06em] text-muted transition-colors hover:border-cyan/40 hover:text-cyan"
              >
                {copied ? 'COPIED' : 'COPY'}
              </button>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-[1.7] text-[#e2e8f0] sm:p-5 sm:text-[12.5px]">
              <code>
                <span style={kw}>import</span> {'{ Zentra }'} <span style={kw}>from</span> <span style={str}>"@zentra/sdk"</span>;{'\n\n'}
                <span style={kw}>const</span> zentra = <span style={kw}>new</span> <span style={fn}>Zentra</span>({'{'}{'\n'}
                {'  '}network: <span style={str}>"stellar-testnet"</span>,{'\n'}
                {'  '}contractId: <span style={str}>"{shortId(protocol.contractId)}"</span>,{'\n'}
                {'}'});{'\n\n'}
                <span style={kw}>const</span> policy = <span style={kw}>await</span> zentra.<span style={fn}>createPolicy</span>({'{'}{'\n'}
                {'  '}asset: <span style={str}>"USDC"</span>,{'\n'}
                {'  '}maxAmount: <span style={num}>100</span>,{'\n'}
                {'  '}dailyLimit: <span style={num}>500</span>,{'\n'}
                {'  '}approvedRecipients: [<span style={str}>"GABC..."</span>, <span style={str}>"GBXQ..."</span>],{'\n'}
                {'}'});{'\n\n'}
                <span style={com}>{'// guard the agent'}</span>{'\n'}
                <span style={kw}>const</span> result = <span style={kw}>await</span> zentra{'\n'}
                {'  '}.<span style={fn}>guard</span>(agent){'\n'}
                {'  '}.<span style={fn}>pay</span>({'{'} recipient: <span style={str}>"GABC..."</span>, amount: <span style={num}>75</span> {'}'});{'\n\n'}
                console.<span style={fn}>log</span>(result.status); <span style={com}>{'// released'}</span>
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
