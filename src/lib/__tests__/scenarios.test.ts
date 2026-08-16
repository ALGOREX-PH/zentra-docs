import { describe, expect, it } from 'vitest';
import {
  LANDING_MESSAGES,
  LANDING_PANELS,
  OVERSPEND,
  SCENARIOS,
} from '@/lib/scenarios';

/**
 * The landing strip's panel configs and terminal lines are projections of
 * SCENARIOS — there is no second copy to drift. These tests guard that the
 * derivation stays a derivation: every landing value must trace back to the
 * scenario entry it came from.
 */
describe('SCENARIOS', () => {
  it('carries three scenarios with unique ids and landing keys', () => {
    expect(SCENARIOS).toHaveLength(3);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(new Set(SCENARIOS.map((s) => s.landing.key)).size).toBe(SCENARIOS.length);
  });

  it('tells the docs over-spend story: 400 spent of a 500 limit, claiming 0', () => {
    expect(OVERSPEND).toEqual({ claimed: 0, chainSpent: 400, dailyLimit: 500 });
    const overspend = SCENARIOS.find((s) => s.landing.key === 'overspend');
    // The playground subtitle quotes the same numbers as the landing panels.
    expect(overspend?.subtitle).toContain(String(OVERSPEND.claimed));
    expect(overspend?.subtitle).toContain(String(OVERSPEND.chainSpent));
  });
});

describe('LANDING_PANELS', () => {
  it('is a per-scenario projection, in scenario order', () => {
    expect(LANDING_PANELS.map((p) => p.id)).toEqual(SCENARIOS.map((s) => s.id));
  });

  it('takes every field from its scenario entry', () => {
    LANDING_PANELS.forEach((panel, i) => {
      const s = SCENARIOS[i];
      expect(panel.key).toBe(s.landing.key);
      expect(panel.label).toBe(s.landing.panelLabel);
      expect(panel.title).toBe(s.title);
      // Identity, not just equality: the arrays are the scenario's own.
      expect(panel.tags).toBe(s.landing.tags);
      expect(panel.desc).toBe(s.landing.desc);
      expect(panel.delay).toBe(s.landing.delay);
      expect(panel.steps).toEqual(s.landing.rail.map((step) => step.panel));
      expect(panel.stop).toBe(s.landing.rail.length - 1);
      expect(panel.settles).toBe(s.outcome === 'settled');
    });
  });

  it('halts blocked walks before the full rail and settles only the valid one', () => {
    const full = Math.max(...LANDING_PANELS.map((p) => p.stop));
    for (const panel of LANDING_PANELS) {
      if (panel.settles) expect(panel.stop).toBe(full);
      else expect(panel.stop).toBeLessThan(full);
    }
    expect(LANDING_PANELS.filter((p) => p.settles)).toHaveLength(1);
  });
});

describe('LANDING_MESSAGES', () => {
  it('carries exactly the scenario keys', () => {
    expect(Object.keys(LANDING_MESSAGES).sort()).toEqual(
      SCENARIOS.map((s) => s.landing.key).sort(),
    );
  });

  it('takes each line list from the scenario rail', () => {
    for (const s of SCENARIOS) {
      expect(LANDING_MESSAGES[s.landing.key]).toEqual(
        s.landing.rail.map((step) => step.engine),
      );
    }
  });
});
