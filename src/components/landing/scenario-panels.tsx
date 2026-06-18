'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const V = '#7c3aed', C = '#00e5ff', G = '#22c55e', R = '#ef4444';

type Id = 'a' | 'b' | 'c';
interface Cfg {
  id: Id;
  label: string;
  letter: string;
  accent: string;
  title: string;
  tags: string[];
  stop: number;
  steps: string[];
  desc: string;
  delay: number;
}

const PANELS: Cfg[] = [
  { id: 'a', label: 'PANEL_A // LEGIT', letter: 'A', accent: G, title: 'Legitimate payment', tags: ['approved vendor', 'within limit', 'nullifier unused'], stop: 6, steps: ['composing', 'policy passed', 'proof generated', 'state bound', 'verified', 'settling', 'receipt emitted'], desc: 'A valid agent action proves compliance, settles on testnet, and emits a verifiable receipt.', delay: 200 },
  { id: 'b', label: 'PANEL_B // INJECTION', letter: 'B', accent: R, title: 'Prompt injection', tags: ['malicious recipient', 'not in allowlist'], stop: 1, steps: ['composing', 'checking policy'], desc: 'A malicious recipient fails the private policy check before a proof is ever produced.', delay: 700 },
  { id: 'c', label: 'PANEL_C // OVERSPEND', letter: 'C', accent: R, title: 'Over-spend', tags: ['exceeds daily limit', 'false zero spend'], stop: 3, steps: ['composing', 'policy passed', 'proof generated', 'binding to state'], desc: 'A valid-looking proof cannot override authoritative on-chain state.', delay: 1200 },
];

function nodeColor(cfg: Cfg, i: number, failed: boolean) {
  if (cfg.id !== 'a' && i === cfg.stop && failed) return R;
  if (cfg.id === 'a' && i >= 4) return C;
  return V;
}

function Panel({ cfg }: { cfg: Cfg }) {
  const [active, setActive] = useState(-1);
  const [failed, setFailed] = useState(false);
  const [outcome, setOutcome] = useState<'' | Id>('');
  const [stat, setStat] = useState<{ t: string; c: string }>({ t: 'IDLE', c: '#64748b' });
  const wrap = useRef<HTMLDivElement>(null);
  const cancel = useRef(false);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    cancel.current = false;
    setActive(-1); setFailed(false); setOutcome('');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, reduced ? 0 : ms));
    for (let i = 0; i <= cfg.stop; i++) {
      if (cancel.current) { busy.current = false; return; }
      const fail = cfg.id !== 'a' && i === cfg.stop;
      if (fail) setFailed(true);
      setActive(i);
      setStat({ t: (cfg.steps[i] ?? '').toUpperCase(), c: fail ? R : '#e2e8f0' });
      await sleep(cfg.id === 'a' ? 560 : 640);
    }
    if (cancel.current) { busy.current = false; return; }
    if (cfg.id === 'a') {
      setOutcome('a'); setStat({ t: 'RECEIPT EMITTED', c: G });
    } else if (cfg.id === 'b') {
      setStat({ t: 'RECIPIENT NOT IN SET', c: R }); await sleep(420);
      setOutcome('b'); await sleep(700); setStat({ t: 'NO PAYMENT MOVED', c: '#64748b' });
    } else {
      setStat({ t: 'STATEMISMATCH', c: R }); setOutcome('c'); await sleep(1100);
      setStat({ t: 'NO PAYMENT MOVED', c: '#64748b' });
    }
    busy.current = false;
  }, [cfg]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    let fired = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !fired) {
          fired = true;
          setTimeout(() => run(), cfg.delay);
          io.disconnect();
        }
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { cancel.current = true; io.disconnect(); };
  }, [run, cfg.delay]);

  const fillPct = active < 0 ? 0 : (active / 6) * 100;

  return (
    <div ref={wrap} className="flex flex-col bg-panel p-6">
      <div className="mb-[18px] flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.1em]" style={{ color: cfg.accent }}>{cfg.label}</span>
        <span className="flex size-6 items-center justify-center font-display text-[13px] font-bold" style={{ color: cfg.accent, background: cfg.accent + '24' }}>{cfg.letter}</span>
      </div>
      <h3 className="mb-3 font-display text-lg font-semibold">{cfg.title}</h3>
      <div className="mb-[22px] flex flex-wrap gap-1.5">
        {cfg.tags.map((t) => (
          <span key={t} className="border border-fd-border px-2 py-0.5 font-mono text-[10px] text-muted">{t}</span>
        ))}
      </div>

      <div className="relative mb-[18px] min-h-[48px] py-1">
        <div className="absolute inset-x-0 top-3 h-0.5 bg-[rgba(148,163,184,0.16)]" />
        <div
          className="absolute left-0 top-3 h-0.5 transition-[width] duration-500"
          style={{ width: `${fillPct}%`, background: failed ? R : 'linear-gradient(90deg,#7c3aed,#00e5ff)', boxShadow: `0 0 10px ${failed ? 'rgba(239,68,68,0.7)' : 'rgba(124,58,237,0.6)'}` }}
        />
        <div className="relative z-[2] flex justify-between">
          {Array.from({ length: 7 }).map((_, i) => {
            const on = i <= active;
            const col = nodeColor(cfg, i, failed);
            return (
              <span key={i} className="flex size-[18px] items-center justify-center border-2 bg-panel transition-all" style={{ borderColor: on ? col : 'rgba(148,163,184,0.3)', boxShadow: on ? `0 0 12px ${col}aa` : 'none' }}>
                <span className="size-[5px] transition-opacity" style={{ background: on ? col : '#94a3b8', opacity: on ? 1 : 0 }} />
              </span>
            );
          })}
        </div>
      </div>

      <div className="mb-1.5 flex h-[92px] items-center justify-center">
        {outcome === 'a' && (
          <svg width="70" height="70" viewBox="0 0 70 70" className="[animation:zen-seal-pulse_1.3s_ease-out]" aria-hidden>
            <polygon points="35,5 60,20 60,50 35,65 10,50 10,20" fill="rgba(34,197,94,0.06)" stroke="#22c55e" strokeWidth="2" />
            <polyline points="27,35 32,41 45,27" fill="none" stroke="#22c55e" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter" />
          </svg>
        )}
        {outcome === 'b' && (
          <div className="flex flex-col items-center gap-2" aria-hidden>
            <svg width="54" height="54" viewBox="0 0 56 56">
              <rect x="6" y="6" width="44" height="44" fill="rgba(239,68,68,0.06)" stroke="#ef4444" strokeWidth="2" />
              <line x1="18" y1="18" x2="38" y2="38" stroke="#ef4444" strokeWidth="3" strokeLinecap="square" />
              <line x1="38" y1="18" x2="18" y2="38" stroke="#ef4444" strokeWidth="3" strokeLinecap="square" />
            </svg>
            <span className="font-mono text-[9px] tracking-[0.12em] text-denied">BLOCKED</span>
          </div>
        )}
        {outcome === 'c' && (
          <div className="grid h-[92px] w-full grid-cols-2 border border-denied/30 [animation:zen-flare_1s_ease-in-out_2]">
            <div className="border-r border-denied/30 p-2.5">
              <div className="mb-1.5 font-mono text-[8px] tracking-[0.08em] text-faint">CLAIMED</div>
              <div className="font-mono text-[11px] text-denied">prev_spent=0</div>
              <div className="mt-0.5 font-mono text-[11px] text-[#cbd5e1]">count=2</div>
            </div>
            <div className="p-2.5">
              <div className="mb-1.5 font-mono text-[8px] tracking-[0.08em] text-faint">CHAIN</div>
              <div className="font-mono text-[11px] text-denied">spent=500</div>
              <div className="mt-0.5 font-mono text-[11px] text-[#cbd5e1]">count=2</div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 min-h-[18px] text-center font-mono text-xs tracking-[0.04em]" style={{ color: stat.c }}>{stat.t}</div>
      <p className="mb-[18px] text-[13px] leading-relaxed text-muted">{cfg.desc}</p>
      <button
        type="button"
        onClick={() => run()}
        className="mt-auto border px-4 py-2.5 font-mono text-xs font-semibold tracking-[0.08em] transition-colors"
        style={{ borderColor: cfg.accent + '73', background: cfg.accent + '12', color: cfg.accent }}
      >
        RUN SEQUENCE →
      </button>
    </div>
  );
}

export function ScenarioPanels() {
  return (
    <section id="panels" className="border-t border-violet/20 bg-abyss px-7 py-20">
      <div className="mx-auto max-w-[1160px]">
        <div className="mb-[18px] flex items-center gap-3.5">
          <span className="font-mono text-xs tracking-[0.12em] text-violet">[ 02 ] PROOF PLAYGROUND</span>
          <span className="h-px flex-1 bg-violet/25" />
        </div>
        <h2 className="font-display text-3xl font-bold tracking-[-0.025em] sm:text-[40px]">
          Watch the protocol enforce itself.
        </h2>
        <p className="mb-[42px] mt-3 max-w-[600px] text-[17px] text-muted">
          Run each scenario. A valid action settles and earns a receipt. An attack
          collapses before money moves.
        </p>

        <div className="grid border border-fd-border md:grid-cols-3 md:[&>*:not(:last-child)]:border-r md:[&>*]:border-fd-border">
          {PANELS.map((p) => (
            <Panel key={p.id} cfg={p} />
          ))}
        </div>
        <p className="mt-7 text-center font-mono text-[13px] tracking-[0.1em] text-faint">// NO PAYMENT MOVED</p>
      </div>
    </section>
  );
}
