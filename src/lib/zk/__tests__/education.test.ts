import { describe, expect, it } from 'vitest';
import { SIGNALS } from '@/lib/zk/education';

/**
 * SIGNALS is the single source for the 14-signal circuit ↔ contract contract:
 * the playground table, the docs reference table and the system bar count all
 * render from it. These tests pin the contract's shape.
 */
describe('SIGNALS', () => {
  it('carries exactly the 14 public signals', () => {
    expect(SIGNALS).toHaveLength(14);
  });

  it('has a unique name per signal', () => {
    const names = SIGNALS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('fills every doc-facing column', () => {
    for (const s of SIGNALS) {
      expect(s.label).not.toBe('');
      expect(s.desc).not.toBe('');
      expect(s.meaning).not.toBe('');
      expect(s.encoding).not.toBe('');
    }
  });
});
