'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { protocol } from '@/config/protocol';

const shortId = (id: string) => `${id.slice(0, 4)}…${id.slice(-3)}`;

const STEPS = [
  'verify_groth16_proof()',
  'check_state_binding()',
  'assert_nullifier_unused()',
  'settle_payment() · emit ActionReceipt',
];

export function VerifierMonolith() {
  const [revealed, setRevealed] = useState(0);
  const [dropped, setDropped] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [stamped, setStamped] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  const run = useCallback(async () => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) {
      setDropped(true); setAccepted(true); setStamped(true); setRevealed(4);
      return;
    }
    const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
    await sleep(300); setDropped(true);
    await sleep(700); setRevealed(1);
    await sleep(450); setRevealed(2);
    await sleep(450); setRevealed(3);
    await sleep(450); setAccepted(true); setRevealed(4);
    await sleep(400); setStamped(true);
  }, []);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !ran.current) { ran.current = true; run(); io.disconnect(); }
      }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [run]);

  return (
    <section ref={wrap} className="border-t border-violet/20 px-5 py-14 sm:px-7 sm:py-20">
      <div className="mx-auto max-w-[1160px]">
        <div className="mb-[18px] flex items-center gap-3.5">
          <span className="font-mono text-xs tracking-[0.12em] text-violet">[ 03 ] ON-CHAIN VERIFICATION</span>
          <span className="h-px flex-1 bg-violet/25" />
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-[1fr_0.85fr]">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[40px]">
              The chain is the source of truth.
            </h2>
            <p className="mb-7 mt-4 max-w-[480px] text-[17px] text-muted">
              A Soroban verifier checks the Groth16 proof, confirms the proof binds to
              stored authority state, enforces nullifier uniqueness — then, and only
              then, settles the payment.
            </p>
            <div className="border border-fd-border">
              {STEPS.map((s, i) => {
                const last = i === STEPS.length - 1;
                return (
                  <div
                    key={s}
                    className="flex items-center gap-3 border-b border-fd-border px-4 py-3 font-mono text-[13px] transition-opacity duration-500 last:border-b-0"
                    style={{ opacity: i < revealed ? 1 : 0, color: last ? '#22c55e' : '#e2e8f0', fontWeight: last ? 600 : 400 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 15 15" aria-hidden>
                      <polyline points="2,8 6,12 13,3" fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
                    </svg>
                    {s}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex h-[400px] items-center justify-center">
            <div className="relative h-[360px] w-full max-w-[280px] overflow-hidden border border-violet/40" style={{ background: 'linear-gradient(180deg,#0e121c,#090b12)' }}>
              <span className="absolute -left-px -top-px h-3.5 w-3.5 border-l-2 border-t-2 border-violet" />
              <span className="absolute -right-px -top-px h-3.5 w-3.5 border-r-2 border-t-2 border-violet" />
              <span className="absolute -bottom-px -left-px h-3.5 w-3.5 border-b-2 border-l-2 border-violet" />
              <span className="absolute -bottom-px -right-px h-3.5 w-3.5 border-b-2 border-r-2 border-violet" />
              <span className="absolute inset-y-0 left-1/4 w-px bg-violet/15" />
              <span className="absolute inset-y-0 left-1/2 w-px bg-violet/20" />
              <span className="absolute inset-y-0 left-3/4 w-px bg-violet/15" />
              <span aria-hidden className="absolute inset-x-0 top-0 h-10 [animation:zen-scan_4s_linear_infinite]" style={{ background: 'linear-gradient(180deg,transparent,rgba(0,229,255,0.08),transparent)' }} />

              <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-fd-border px-3.5 py-3">
                <span className="font-mono text-[10px] tracking-[0.1em] text-muted">SOROBAN VERIFIER</span>
                <span className="size-2 transition-colors duration-500" style={{ background: accepted ? '#22c55e' : '#7c3aed' }} />
              </div>

              <div
                className="absolute left-1/2 top-16 flex h-[26px] w-[54px] items-center justify-center font-mono text-[10px] font-bold text-[#06070d] transition-all duration-700"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#00e5ff)', boxShadow: '0 0 16px rgba(0,229,255,0.5)', transform: `translate(-50%, ${dropped ? '96px' : '-44px'})`, opacity: dropped ? 0 : 1 }}
              >
                PROOF
              </div>

              <div className="absolute inset-x-[30px] top-[172px] flex h-[30px] items-center border border-fd-border bg-void px-1">
                <div className="h-2 w-full transition-all duration-500" style={{ background: dropped ? '#00e5ff' : 'rgba(148,163,184,0.18)', boxShadow: dropped ? '0 0 14px rgba(0,229,255,0.7)' : 'none' }} />
              </div>
              <span className="absolute left-[30px] top-[208px] font-mono text-[9px] tracking-[0.06em] text-faint">PROOF SLOT · BN254</span>

              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-fd-border px-3.5 py-3">
                <span className="font-mono text-[10px] text-violet-soft">{shortId(protocol.contractId)}</span>
                <span className="font-mono text-[10px] tracking-[0.08em] transition-colors" style={{ color: accepted ? '#22c55e' : '#64748b' }}>
                  {accepted ? 'ACCEPTED' : 'AWAITING'}
                </span>
              </div>

              <div
                className="absolute left-1/2 top-1/2 border-2 border-live px-4 py-2 transition-all duration-300"
                style={{ background: 'rgba(34,197,94,0.08)', transform: `translate(-50%,-50%) rotate(-9deg) scale(${stamped ? 1 : 1.6})`, opacity: stamped ? 1 : 0 }}
              >
                <span className="font-display text-[22px] font-bold tracking-[0.08em] text-live">VERIFIED</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
