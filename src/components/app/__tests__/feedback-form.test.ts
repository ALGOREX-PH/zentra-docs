// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackForm } from '@/components/app/feedback-form';

// React reports un-acted updates unless the environment opts in.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Three seams: the wallet context, the two chain calls (build + submit), and
// fetch for the API leg. The anchored-retry machine itself stays real.
const mocks = vi.hoisted(() => ({
  wallet: {
    address: null as string | null,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
  },
  buildFeedbackXdr: vi.fn(),
  submitInvoke: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/components/app/wallet-provider', () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock('@/lib/stellar/feedback', () => ({
  buildFeedbackXdr: mocks.buildFeedbackXdr,
}));

vi.mock('@/lib/stellar/action-log', () => ({
  submitInvoke: mocks.submitInvoke,
}));

const ADDRESS = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';
const HASH = 'cd'.repeat(32);
const SUCCESS = 'Thanks — your feedback was recorded.';

function apiResponse(status: number, message = 'nope') {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ error: { code: 'err', message } }),
  };
}

/** The JSON body of the `nth` POST to /api/feedback. */
function postedBody(nth: number): Record<string, unknown> {
  const call = mocks.fetch.mock.calls[nth] as [string, { body: string }];
  expect(call[0]).toBe('/api/feedback');
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, rating = 4, comment = 'Solid.') {
  await user.click(screen.getByRole('button', { name: `Rate ${rating} of 5` }));
  await user.click(screen.getByLabelText('Comment'));
  await user.paste(comment);
}

const submitButton = () => screen.getByRole('button', { name: 'Send feedback' });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.wallet.address = null;
  mocks.buildFeedbackXdr.mockResolvedValue('UNSIGNED_XDR');
  mocks.wallet.signTransaction.mockResolvedValue('SIGNED_XDR');
  mocks.submitInvoke.mockResolvedValue(HASH);
  mocks.fetch.mockResolvedValue(apiResponse(200));
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('submit gating', () => {
  it('stays disabled until a rating is picked and a comment is typed', async () => {
    const user = userEvent.setup();
    render(h(FeedbackForm));

    expect(submitButton()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Rate 3 of 5' }));
    expect(submitButton()).toBeDisabled();

    await user.type(screen.getByLabelText('Comment'), 'Great docs.');
    expect(submitButton()).toBeEnabled();
  });

  it('disables again when the comment exceeds the maximum', async () => {
    const user = userEvent.setup();
    render(h(FeedbackForm));
    await fillForm(user, 4, 'x'.repeat(281));

    expect(screen.getByText('Comment must be 280 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByText('281/280')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });
});

describe('the no-wallet path', () => {
  it('posts API-only feedback, marked as off-chain', async () => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    render(h(FeedbackForm, { onSubmitted }));
    await fillForm(user);

    await user.click(submitButton());
    await waitFor(() => expect(screen.getByText(SUCCESS)).toBeInTheDocument());

    // No wallet means no chain leg at all — straight to the API.
    expect(mocks.buildFeedbackXdr).not.toHaveBeenCalled();
    expect(mocks.wallet.signTransaction).not.toHaveBeenCalled();
    expect(mocks.submitInvoke).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(postedBody(0)).toEqual({
      rating: 4,
      comment: 'Solid.',
      wallet: null,
      txHash: null,
      onChain: false,
    });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });
});

describe('the anchored retry', () => {
  async function submitWithFailingSave(user: ReturnType<typeof userEvent.setup>) {
    mocks.wallet.address = ADDRESS;
    mocks.fetch.mockResolvedValueOnce(apiResponse(500, 'DB down.'));
    render(h(FeedbackForm));
    await fillForm(user);
    await user.click(submitButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Your feedback is recorded on-chain, but saving it failed (DB down.). Retrying will not ask for another signature.',
      ),
    );
  }

  it('freezes the settled payload and links the anchored transaction', async () => {
    const user = userEvent.setup();
    await submitWithFailingSave(user);

    // The settled anchor is independently verifiable.
    expect(screen.getByRole('link', { name: /^Tx / })).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
    // The retry saves the frozen payload, so the fields must not look live.
    expect(screen.getByLabelText('Comment')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rate 4 of 5' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled();
  });

  it('re-posts the same hash without a second signature, then succeeds', async () => {
    const user = userEvent.setup();
    await submitWithFailingSave(user);

    await user.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.getByText(SUCCESS)).toBeInTheDocument());

    // The chain leg ran exactly once — the retry never rebuilds or re-signs.
    expect(mocks.buildFeedbackXdr).toHaveBeenCalledTimes(1);
    expect(mocks.wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.submitInvoke).toHaveBeenCalledTimes(1);

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const first = postedBody(0);
    const second = postedBody(1);
    expect(first).toEqual({
      rating: 4,
      comment: 'Solid.',
      wallet: ADDRESS,
      txHash: HASH,
      onChain: true,
    });
    expect(second).toEqual(first);

    // Settled and saved: the form resets for the next entry.
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    expect(screen.getByLabelText('Comment')).toHaveValue('');
  });

  it('treats a 409 on the retry as success — the first save landed', async () => {
    const user = userEvent.setup();
    await submitWithFailingSave(user);

    mocks.fetch.mockResolvedValueOnce(apiResponse(409, 'Already saved.'));
    await user.click(screen.getByRole('button', { name: 'Retry save' }));

    await waitFor(() => expect(screen.getByText(SUCCESS)).toBeInTheDocument());
    expect(mocks.wallet.signTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not treat a first-attempt 409 as success', async () => {
    const user = userEvent.setup();
    mocks.wallet.address = null;
    mocks.fetch.mockResolvedValueOnce(apiResponse(409, 'Duplicate.'));
    render(h(FeedbackForm));
    await fillForm(user);

    await user.click(submitButton());

    // Without a settled anchor a 409 is an ordinary failure, not a lost ack.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Duplicate.'));
    expect(screen.queryByText(SUCCESS)).not.toBeInTheDocument();
  });
});
