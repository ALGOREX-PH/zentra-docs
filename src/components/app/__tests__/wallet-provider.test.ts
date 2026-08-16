// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWallet, WalletProvider } from '@/components/app/wallet-provider';

// React reports un-acted updates unless the environment opts in.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The kit module is the seam: everything behind it is lazy chunks and wallet
// extensions. `getKit` resolves to a fake kit whose methods each test scripts.
const mocks = vi.hoisted(() => {
  const kit = {
    setWallet: vi.fn(),
    getAddress: vi.fn(),
    fetchAddress: vi.fn(),
    authModal: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
    selectedModule: { productId: 'freighter' },
  };
  return { kit, getKit: vi.fn() };
});

vi.mock('@/lib/stellar/kit', () => ({
  FREIGHTER_ID: 'freighter',
  getKit: mocks.getKit,
}));

const STORAGE_KEY = 'zentra:wallet';
const ADDRESS = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';
const OTHER = 'GBVLKSFRCOTZQK4PSFPYSQ3HYKW527IsomethingELSE';

/** Surfaces the context through the DOM so tests assert via roles and labels. */
function Probe() {
  const { address, connect, disconnect, signTransaction } = useWallet();
  const [outcome, setOutcome] = useState('');
  const [signError, setSignError] = useState('');
  return h(
    'div',
    null,
    h('output', { 'aria-label': 'address' }, address ?? 'disconnected'),
    h('output', { 'aria-label': 'outcome' }, outcome),
    h('output', { 'aria-label': 'sign-error' }, signError),
    h(
      'button',
      { type: 'button', onClick: () => void connect('freighter').then(setOutcome) },
      'connect',
    ),
    h('button', { type: 'button', onClick: () => disconnect() }, 'disconnect'),
    h(
      'button',
      {
        type: 'button',
        onClick: () => void signTransaction('XDR').catch((err: Error) => setSignError(err.message)),
      },
      'sign',
    ),
  );
}

function renderProvider() {
  return render(h(WalletProvider, null, h(Probe)));
}

const addressOutput = () => screen.getByLabelText('address');

beforeEach(() => {
  window.localStorage.clear();
  // Reset, not clear: a test that gives `setWallet` a throwing implementation
  // must not leak it into the next test.
  vi.resetAllMocks();
  mocks.getKit.mockResolvedValue(mocks.kit);
  mocks.kit.selectedModule = { productId: 'freighter' };
});

afterEach(() => {
  cleanup();
});

describe('rehydration', () => {
  it('shows a persisted address optimistically, before the kit loads', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: 'freighter', address: ADDRESS }),
    );
    // A kit that never arrives: the persisted address must not wait for it.
    mocks.getKit.mockReturnValue(new Promise(() => {}));

    renderProvider();

    expect(addressOutput()).toHaveTextContent(ADDRESS);
  });

  it('keeps the persisted entry when the kit confirms the same address', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: 'freighter', address: ADDRESS }),
    );
    mocks.kit.getAddress.mockResolvedValue({ address: ADDRESS });

    renderProvider();

    await waitFor(() => expect(mocks.kit.setWallet).toHaveBeenCalledWith('freighter'));
    expect(addressOutput()).toHaveTextContent(ADDRESS);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ walletId: 'freighter', address: ADDRESS }),
    );
  });

  it("reconciles toward the kit's own record when the two drift", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: 'freighter', address: ADDRESS }),
    );
    mocks.kit.getAddress.mockResolvedValue({ address: OTHER });

    renderProvider();

    await waitFor(() => expect(addressOutput()).toHaveTextContent(OTHER));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ walletId: 'freighter', address: OTHER }),
    );
  });

  it('removes a corrupt entry and stays disconnected', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');

    renderProvider();

    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
    expect(addressOutput()).toHaveTextContent('disconnected');
    // Nothing to rehydrate means the kit is never even asked for.
    expect(mocks.kit.setWallet).not.toHaveBeenCalled();
  });

  it('removes an entry whose address is not a string', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: 'freighter', address: 42 }),
    );

    renderProvider();

    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
    expect(addressOutput()).toHaveTextContent('disconnected');
  });

  it('drops the entry and disconnects when the saved wallet module no longer exists', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: 'gone', address: ADDRESS }),
    );
    mocks.kit.setWallet.mockImplementation(() => {
      throw new Error('no module');
    });

    renderProvider();

    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
    expect(addressOutput()).toHaveTextContent('disconnected');
  });
});

describe('connect', () => {
  it('persists the wallet id and address on success', async () => {
    const user = userEvent.setup();
    mocks.kit.fetchAddress.mockResolvedValue({ address: ADDRESS });

    renderProvider();
    await user.click(screen.getByRole('button', { name: 'connect' }));

    await waitFor(() => expect(screen.getByLabelText('outcome')).toHaveTextContent('connected'));
    expect(addressOutput()).toHaveTextContent(ADDRESS);
    expect(mocks.kit.setWallet).toHaveBeenCalledWith('freighter');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ walletId: 'freighter', address: ADDRESS }),
    );
  });

  it('reports a decline and leaves the app disconnected', async () => {
    const user = userEvent.setup();
    // The kit rejects with plain `{ code, message }` objects, not Errors.
    mocks.kit.fetchAddress.mockRejectedValue({ code: -3, message: 'User declined access' });

    renderProvider();
    await user.click(screen.getByRole('button', { name: 'connect' }));

    await waitFor(() => expect(screen.getByLabelText('outcome')).toHaveTextContent('declined'));
    expect(addressOutput()).toHaveTextContent('disconnected');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('reports unavailable when the kit itself fails to load', async () => {
    const user = userEvent.setup();
    mocks.getKit.mockRejectedValue(new Error('chunk load failed'));

    renderProvider();
    await user.click(screen.getByRole('button', { name: 'connect' }));

    await waitFor(() => expect(screen.getByLabelText('outcome')).toHaveTextContent('unavailable'));
    expect(addressOutput()).toHaveTextContent('disconnected');
  });
});

describe('disconnect', () => {
  it('clears the persisted entry and the address', async () => {
    const user = userEvent.setup();
    mocks.kit.fetchAddress.mockResolvedValue({ address: ADDRESS });
    mocks.kit.disconnect.mockResolvedValue(undefined);

    renderProvider();
    await user.click(screen.getByRole('button', { name: 'connect' }));
    await waitFor(() => expect(addressOutput()).toHaveTextContent(ADDRESS));

    await user.click(screen.getByRole('button', { name: 'disconnect' }));

    expect(addressOutput()).toHaveTextContent('disconnected');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(mocks.kit.disconnect).toHaveBeenCalledTimes(1));
  });
});

describe('signTransaction', () => {
  it('rejects without ever reaching the kit when no wallet is connected', async () => {
    const user = userEvent.setup();

    renderProvider();
    await user.click(screen.getByRole('button', { name: 'sign' }));

    await waitFor(() =>
      expect(screen.getByLabelText('sign-error')).toHaveTextContent('Connect your wallet first.'),
    );
    expect(mocks.kit.signTransaction).not.toHaveBeenCalled();
  });
});
