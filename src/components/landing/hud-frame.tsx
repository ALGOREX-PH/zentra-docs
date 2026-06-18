/** Fixed viewport HUD frame — corner brackets and the lattice tag. Decorative. */
export function HudFrame() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40">
      <span className="absolute left-2 top-2 h-[18px] w-[18px] border-l-2 border-t-2 border-violet/70" />
      <span className="absolute right-2 top-2 h-[18px] w-[18px] border-r-2 border-t-2 border-violet/70" />
      <span className="absolute bottom-2 left-2 h-[18px] w-[18px] border-b-2 border-l-2 border-violet/70" />
      <span className="absolute bottom-2 right-2 h-[18px] w-[18px] border-b-2 border-r-2 border-violet/70" />
      <span className="absolute bottom-3.5 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.22em] text-faint/70">
        OBSIDIAN · PROOF · LATTICE
      </span>
    </div>
  );
}
