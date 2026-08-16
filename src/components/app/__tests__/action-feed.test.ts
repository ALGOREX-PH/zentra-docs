// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { act, createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionFeed } from '@/components/app/action-feed';
import { LIVE_POLL_MS } from '@/config/app';
import type { ActionEntry } from '@/lib/stellar/types';

// React reports un-acted updates unless the environment opts in.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The action-log module is the seam to the chain. The configuration flag is a
// getter so a test can flip it before render — the component reads it once per
// render, never caching it in state.
const mocks = vi.hoisted(() => ({
  contractsConfigured: true,
  getRecent: vi.fn(),
  getCount: vi.fn(),
  getLatestLedger: vi.fn(),
  pollEvents: vi.fn(),
}));

vi.mock('@/config/contract', () => ({
  get contractsConfigured() {
    return mocks.contractsConfigured;
  },
}));

vi.mock('@/lib/stellar/action-log', () => ({
  getRecent: mocks.getRecent,
  getCount: mocks.getCount,
  getLatestLedger: mocks.getLatestLedger,
  pollEvents: mocks.pollEvents,
}));

const AUTHOR = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';

function entry(index: number): ActionEntry {
  return { index, author: AUTHOR, message: `msg ${index}`, ledger: 3000 + index, score: index };
}

/** Newest first, as the contract's `get_recent` answers. */
function entries(from: number, to: number): ActionEntry[] {
  const list: ActionEntry[] = [];
  for (let i = to; i >= from; i -= 1) list.push(entry(i));
  return list;
}

/** Flush the microtask queue so the seed's promises commit their state. */
const flush = () => act(async () => {});

/** One poll interval, with the tick's own promise chain flushed. */
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  });

const STALE_BANNER = 'Could not load the on-chain feed. Showing the last entries loaded.';

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.contractsConfigured = true;
  mocks.getRecent.mockResolvedValue(entries(1, 2));
  mocks.getCount.mockResolvedValue(2);
  mocks.getLatestLedger.mockResolvedValue(100);
  mocks.pollEvents.mockResolvedValue({ entries: [], latestLedger: 100 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('seeding', () => {
  it('seeds the list and the count from the contract reads', async () => {
    const { container } = render(h(ActionFeed));
    await flush();

    expect(screen.getByText('msg 2')).toBeInTheDocument();
    expect(screen.getByText('msg 1')).toBeInTheDocument();
    expect(container.textContent).toContain('2 actions recorded');
    expect(mocks.getRecent).toHaveBeenCalledWith(20);
  });

  it('reports a seed failure instead of an empty feed', async () => {
    mocks.getRecent.mockRejectedValue(new Error('rpc down'));
    render(h(ActionFeed));
    await flush();

    // Stated twice by design: the visible paragraph and the alert region.
    expect(screen.getAllByText('Could not load the on-chain feed.').length).toBeGreaterThan(0);
  });
});

describe('polling', () => {
  it('prepends new entries, dedupes by index and respects the cap', async () => {
    mocks.getRecent.mockResolvedValue(entries(0, 24));
    mocks.getCount.mockResolvedValue(25);
    render(h(ActionFeed));
    await flush();
    expect(screen.getAllByRole('listitem')).toHaveLength(25);

    // One duplicate (24) and one genuinely new entry (25).
    mocks.pollEvents.mockResolvedValue({
      entries: [entry(24), entry(25)],
      latestLedger: 101,
    });
    await tick();

    // The poll starts from the ledger after the seed's latest.
    expect(mocks.pollEvents).toHaveBeenCalledWith(101);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(25);
    // Newest lands on top, the duplicate is not repeated, the oldest fell off.
    expect(items[0]).toHaveTextContent('msg 25');
    expect(screen.getAllByText('msg 24')).toHaveLength(1);
    expect(screen.queryByText('msg 0')).not.toBeInTheDocument();
  });

  it('bumps the count from the highest polled index', async () => {
    const { container } = render(h(ActionFeed));
    await flush();

    mocks.pollEvents.mockResolvedValue({ entries: [entry(9)], latestLedger: 101 });
    await tick();

    // Index 9 means at least ten actions exist.
    expect(container.textContent).toContain('10 actions recorded');
  });

  it('keeps the entries on a poll failure', async () => {
    render(h(ActionFeed));
    await flush();

    mocks.pollEvents.mockRejectedValue(new Error('rpc hiccup'));
    await tick();

    expect(screen.getByText('msg 2')).toBeInTheDocument();
    expect(screen.getByText('msg 1')).toBeInTheDocument();
    // A single hiccup is not stated — the next tick usually heals it.
    expect(screen.queryByText(STALE_BANNER)).not.toBeInTheDocument();
  });

  it('reseeds after three consecutive poll failures', async () => {
    render(h(ActionFeed));
    await flush();
    expect(mocks.getRecent).toHaveBeenCalledTimes(1);

    mocks.pollEvents.mockRejectedValue(new Error('cursor aged out'));
    await tick();
    await tick();
    expect(mocks.getRecent).toHaveBeenCalledTimes(1);

    await tick();
    expect(mocks.getRecent).toHaveBeenCalledTimes(2);
  });

  it('states staleness when the reseed fails, keeping the entries', async () => {
    render(h(ActionFeed));
    await flush();

    mocks.pollEvents.mockRejectedValue(new Error('cursor aged out'));
    mocks.getRecent.mockRejectedValue(new Error('rpc down'));
    await tick();
    await tick();
    await tick();

    // The entries are still real, so they stay — with the staleness stated
    // both in the visible banner and the pre-mounted alert region.
    expect(screen.getByText('msg 2')).toBeInTheDocument();
    expect(screen.getByText('msg 1')).toBeInTheDocument();
    expect(screen.getAllByText(STALE_BANNER).length).toBeGreaterThan(0);
  });
});

describe('an unconfigured network', () => {
  it('renders the not-configured panel and issues no reads', async () => {
    mocks.contractsConfigured = false;
    render(h(ActionFeed));
    await flush();

    expect(screen.getByText(/Contracts are not configured for/)).toBeInTheDocument();

    // No seed, and no poll either — even after a full interval.
    await tick();
    expect(mocks.getRecent).not.toHaveBeenCalled();
    expect(mocks.getCount).not.toHaveBeenCalled();
    expect(mocks.getLatestLedger).not.toHaveBeenCalled();
    expect(mocks.pollEvents).not.toHaveBeenCalled();
  });
});
