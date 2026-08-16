// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectButton } from '@/components/app/connect-button';

// React reports un-acted updates unless the environment opts in.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Two seams: the wallet context (which owns the connection outcome) and the
// kit (which owns wallet detection). The dialog machinery itself stays real.
const mocks = vi.hoisted(() => ({
  wallet: {
    address: null as string | null,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
  },
  kit: { refreshSupportedWallets: vi.fn() },
  getKit: vi.fn(),
}));

vi.mock('@/components/app/wallet-provider', () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock('@/lib/stellar/kit', () => ({
  FREIGHTER_ID: 'freighter',
  getKit: mocks.getKit,
}));

const ADDRESS = 'GDUY4FYOA7C5FF45OL5HN2IMVE5CDXO2DZZQNKQXVVDRNCXOSDRHY7LO';

/** The shape the kit's `refreshSupportedWallets` reports per module. */
const WALLETS = [
  { id: 'freighter', name: 'Freighter', isAvailable: true, url: 'https://freighter.app' },
  { id: 'xbull', name: 'xBull', isAvailable: false, url: 'https://xbull.app' },
];

const trigger = () => screen.getByRole('button', { name: 'Connect your Stellar wallet' });

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  return await screen.findByRole('dialog', { name: 'Connect a wallet' });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.wallet.address = null;
  mocks.wallet.connecting = false;
  mocks.getKit.mockResolvedValue(mocks.kit);
  mocks.kit.refreshSupportedWallets.mockResolvedValue(WALLETS);
});

afterEach(() => {
  cleanup();
});

describe('the wallet list', () => {
  it('renders a connect button for detected wallets and an install link otherwise', async () => {
    const user = userEvent.setup();
    render(h(ConnectButton));
    await openDialog(user);

    const connectFreighter = await screen.findByRole('button', { name: /Freighter/ });
    expect(connectFreighter).toHaveTextContent('Detected');

    const installXbull = screen.getByRole('link', { name: /xBull/ });
    expect(installXbull).toHaveTextContent('Install');
    expect(installXbull).toHaveAttribute('href', 'https://xbull.app');
  });

  it('says so when detection fails', async () => {
    const user = userEvent.setup();
    mocks.kit.refreshSupportedWallets.mockRejectedValue(new Error('kit exploded'));
    render(h(ConnectButton));
    await openDialog(user);

    expect(
      await screen.findByText('Could not detect the wallets on this device.'),
    ).toBeInTheDocument();
  });
});

describe('closing the dialog', () => {
  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(h(ConnectButton));
    await openDialog(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('closes on a backdrop click', async () => {
    const user = userEvent.setup();
    const { container } = render(h(ConnectButton));
    await openDialog(user);

    const backdrop = container.querySelector<HTMLElement>('[class*="backdrop-blur"]');
    if (!backdrop) throw new Error('backdrop not rendered');
    await user.click(backdrop);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('focus management', () => {
  it('moves focus into the panel on open', async () => {
    const user = userEvent.setup();
    render(h(ConnectButton));
    await openDialog(user);

    // The first focusable element in document order is the Close button.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('wraps Tab at the last element instead of walking out of the dialog', async () => {
    const user = userEvent.setup();
    render(h(ConnectButton));
    await openDialog(user);
    // Wait for the list so the trap has all its stops.
    await screen.findByRole('button', { name: /Freighter/ });

    // Close → Freighter → xBull install link → wraps to Close.
    await user.tab();
    await user.tab();
    expect(screen.getByRole('link', { name: /xBull/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});

describe('connection outcomes', () => {
  it('closes the dialog when the wallet connects', async () => {
    const user = userEvent.setup();
    mocks.wallet.connect.mockResolvedValue('connected');
    render(h(ConnectButton));
    await openDialog(user);

    await user.click(await screen.findByRole('button', { name: /Freighter/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.wallet.connect).toHaveBeenCalledWith('freighter');
  });

  it('keeps the dialog open and explains a decline', async () => {
    const user = userEvent.setup();
    mocks.wallet.connect.mockResolvedValue('declined');
    render(h(ConnectButton));
    await openDialog(user);

    await user.click(await screen.findByRole('button', { name: /Freighter/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request was declined in the wallet. Approve it there to connect.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('points at the wallet when it is unavailable', async () => {
    const user = userEvent.setup();
    mocks.wallet.connect.mockResolvedValue('unavailable');
    render(h(ConnectButton));
    await openDialog(user);

    await user.click(await screen.findByRole('button', { name: /Freighter/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not connect. Check the wallet is installed, unlocked, and set to testnet.',
    );
  });
});

describe('the connected state', () => {
  it('renders the explorer link and a disconnect control instead of the trigger', async () => {
    const user = userEvent.setup();
    mocks.wallet.address = ADDRESS;
    render(h(ConnectButton));

    expect(
      screen.queryByRole('button', { name: 'Connect your Stellar wallet' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View connected account GDUY…Y7LO/ })).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/account/${ADDRESS}`,
    );

    await user.click(screen.getByRole('button', { name: 'Disconnect your Stellar wallet' }));
    expect(mocks.wallet.disconnect).toHaveBeenCalledTimes(1);
  });
});
