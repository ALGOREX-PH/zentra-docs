// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SendForm } from '@/components/app/send-form';
import { inFlightLabels } from '@/components/app/tx-status';
import { SubmitTimeoutError } from '@/lib/stellar/errors';

// React reports un-acted updates unless the environment opts in.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Two seams: the wallet context (address + signing) and the payment lib
// (build + submit). Validation, phase machinery and copy all stay real.
const mocks = vi.hoisted(() => ({
  wallet: {
    address: null as string | null,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
  },
  buildPaymentXdr: vi.fn(),
  submitSignedXdr: vi.fn(),
}));

vi.mock('@/components/app/wallet-provider', () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock('@/lib/stellar/payment', () => ({
  buildPaymentXdr: mocks.buildPaymentXdr,
  submitSignedXdr: mocks.submitSignedXdr,
}));

const ADDRESS = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';
// The destination runs through the real StrKey validator (checksum included),
// so it must be a genuine ed25519 public key:
// Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey().
const DESTINATION = 'GD6ROJBYLKQMOW3E7N4M2YBPUHMZD7PL65VRHRMO24BOVSBV5H3BQRSL';
const HASH = 'ab'.repeat(32);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush the microtask queue so a just-settled promise commits its state. */
const flush = () => act(async () => {});

function form(): HTMLFormElement {
  const node = document.querySelector('form');
  if (!node) throw new Error('form not rendered');
  return node;
}

async function fillValidFields(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Destination'));
  await user.paste(DESTINATION);
  await user.type(screen.getByLabelText('Amount'), '12.5');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.wallet.address = ADDRESS;
  mocks.buildPaymentXdr.mockResolvedValue('UNSIGNED_XDR');
  mocks.wallet.signTransaction.mockResolvedValue('SIGNED_XDR');
  mocks.submitSignedXdr.mockResolvedValue({ hash: HASH, ledger: 123 });
});

afterEach(() => {
  cleanup();
});

describe('submit gating', () => {
  it('keeps the button disabled until both fields are valid', async () => {
    const user = userEvent.setup();
    render(h(SendForm));
    const button = screen.getByRole('button', { name: 'Send XLM' });

    expect(button).toBeDisabled();

    await user.click(screen.getByLabelText('Destination'));
    await user.paste('GABC-not-a-key');
    expect(screen.getByText('Enter a valid G… testnet address')).toBeInTheDocument();
    expect(button).toBeDisabled();

    await user.clear(screen.getByLabelText('Destination'));
    await user.click(screen.getByLabelText('Destination'));
    await user.paste(DESTINATION);
    await user.type(screen.getByLabelText('Amount'), '0');
    expect(screen.getByText('Enter a positive amount (max 7 decimals)')).toBeInTheDocument();
    expect(button).toBeDisabled();

    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '12.5');
    expect(button).toBeEnabled();
  });

  it('treats a forced submit with invalid fields as a validation failure, not a send', async () => {
    render(h(SendForm));

    fireEvent.submit(form());
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('Fix the highlighted fields.');
    expect(mocks.buildPaymentXdr).not.toHaveBeenCalled();
  });

  it('asks for a wallet when none is connected', async () => {
    mocks.wallet.address = null;
    render(h(SendForm));

    expect(screen.getByText('Connect your wallet to send.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send XLM' })).toBeDisabled();

    fireEvent.submit(form());
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('Connect your wallet first.');
    expect(mocks.buildPaymentXdr).not.toHaveBeenCalled();
  });
});

describe('the pipeline phases', () => {
  it('walks building → signing → submitting → success through the status region', async () => {
    const user = userEvent.setup();
    const build = deferred<string>();
    const sign = deferred<string>();
    const submit = deferred<{ hash: string; ledger: number }>();
    mocks.buildPaymentXdr.mockReturnValue(build.promise);
    mocks.wallet.signTransaction.mockReturnValue(sign.promise);
    mocks.submitSignedXdr.mockReturnValue(submit.promise);
    const onPaid = vi.fn();

    render(h(SendForm, { onPaid }));
    await fillValidFields(user);
    await user.click(screen.getByRole('button', { name: 'Send XLM' }));

    // Each label appears twice: the sr-only live region and the visible panel.
    expect(screen.getAllByText(inFlightLabels.building).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();

    build.resolve('UNSIGNED_XDR');
    await flush();
    expect(screen.getAllByText(inFlightLabels.signing).length).toBeGreaterThan(0);

    sign.resolve('SIGNED_XDR');
    await flush();
    expect(screen.getAllByText(inFlightLabels.submitting).length).toBeGreaterThan(0);

    submit.resolve({ hash: HASH, ledger: 123 });
    await flush();
    expect(screen.getByRole('heading', { name: 'Payment settled' })).toBeInTheDocument();
    expect(screen.getByText('Sent 12.5 XLM.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Tx / })).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
    expect(onPaid).toHaveBeenCalledTimes(1);
    // A repeat send must be a deliberate re-entry, so the amount clears.
    expect(screen.getByLabelText('Amount')).toHaveValue('');
  });

  it('fires onPaid exactly once per settled payment', async () => {
    const user = userEvent.setup();
    const onPaid = vi.fn();

    render(h(SendForm, { onPaid }));
    await fillValidFields(user);
    await user.click(screen.getByRole('button', { name: 'Send XLM' }));
    await flush();

    expect(screen.getByRole('heading', { name: 'Payment settled' })).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it('ignores a second submit while a run is in flight', async () => {
    const user = userEvent.setup();
    const build = deferred<string>();
    mocks.buildPaymentXdr.mockReturnValue(build.promise);
    const onPaid = vi.fn();

    render(h(SendForm, { onPaid }));
    await fillValidFields(user);
    await user.click(screen.getByRole('button', { name: 'Send XLM' }));

    // The button is disabled now, but Enter still submits the form directly.
    fireEvent.submit(form());
    fireEvent.submit(form());
    await flush();
    expect(mocks.buildPaymentXdr).toHaveBeenCalledTimes(1);
    // The in-flight status must survive the blocked resubmits.
    expect(screen.getAllByText(inFlightLabels.building).length).toBeGreaterThan(0);

    build.resolve('UNSIGNED_XDR');
    await flush();
    await flush();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });
});

describe('failure copy', () => {
  it('renders the shared decline message when the wallet refuses to sign', async () => {
    const user = userEvent.setup();
    mocks.wallet.signTransaction.mockRejectedValue(new Error('User declined access'));

    render(h(SendForm));
    await fillValidFields(user);
    await user.click(screen.getByRole('button', { name: 'Send XLM' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Payment failed. You declined the signature in your wallet.',
    );
    expect(mocks.submitSignedXdr).not.toHaveBeenCalled();
  });

  it('surfaces the explorer link when a submission times out with a hash', async () => {
    const user = userEvent.setup();
    mocks.submitSignedXdr.mockRejectedValue(new SubmitTimeoutError(HASH));

    render(h(SendForm));
    await fillValidFields(user);
    await user.click(screen.getByRole('button', { name: 'Send XLM' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('the payment may still have gone through');
    // The unresolved hash must reach the panel so the user can check the
    // explorer instead of blindly — and possibly doubly — retrying.
    expect(screen.getByRole('link', { name: /^Tx / })).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
  });
});
