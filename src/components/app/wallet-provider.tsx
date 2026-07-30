'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { stellar } from '@/config/stellar';
import { getKit } from '@/lib/stellar/kit';

const STORAGE_KEY = 'zentra:wallet';

interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  /**
   * Connect the given wallet, or fall back to the kit's own picker when the
   * caller has not chosen one.
   */
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** The shape written to localStorage — narrow, so a stale entry can be spotted. */
interface PersistedWallet {
  walletId: string;
  address: string;
}

/**
 * `JSON.parse` hands back `any`, which would let a hand-edited or stale entry
 * put a non-string through `setWallet` and into React state. Narrowing it here
 * keeps the untyped boundary to a single function.
 */
function readPersisted(raw: string): PersistedWallet | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (!('address' in parsed) || typeof parsed.address !== 'string') return null;
  if (parsed.address.length === 0) return null;
  const walletId =
    'walletId' in parsed && typeof parsed.walletId === 'string'
      ? parsed.walletId
      : FREIGHTER_ID;
  return { walletId, address: parsed.address };
}

/**
 * Which module the kit ended up on, so a reconnect reaches for the wallet the
 * user actually picked rather than assuming Freighter. `selectedModule` throws
 * when nothing is selected, hence the guard.
 */
function selectedWalletId(): string {
  try {
    return getKit().selectedModule.productId;
  } catch {
    return FREIGHTER_ID;
  }
}

/**
 * Holds the single source of truth for "is a wallet connected, and which one".
 *
 * The connection survives a refresh: the selected wallet id + address are
 * persisted to localStorage and rehydrated on mount, so the dApp doesn't make
 * the user reconnect every navigation.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const persisted = readPersisted(saved);
      if (!persisted) throw new Error('Unrecognised wallet entry.');
      getKit().setWallet(persisted.walletId);
      setAddress(persisted.address);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const connect = useCallback(async (walletId?: string) => {
    setConnecting(true);
    try {
      const kit = getKit();
      // A wallet id means the caller already ran its own picker, so the kit's
      // modal is skipped and the chosen module is asked for the address direct.
      if (walletId) kit.setWallet(walletId);
      const { address: addr } = walletId
        ? await kit.fetchAddress()
        : await kit.authModal();
      setAddress(addr);
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ walletId: selectedWalletId(), address: addr }),
      );
    } catch {
      // user dismissed the modal or declined — stay disconnected
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    window.localStorage.removeItem(STORAGE_KEY);
    try {
      void getKit().disconnect();
    } catch {
      // nothing to tear down
    }
  }, []);

  const signTransaction = useCallback(
    async (xdr: string) => {
      if (!address) throw new Error('Connect your wallet first.');
      const { signedTxXdr } = await getKit().signTransaction(xdr, {
        address,
        networkPassphrase: stellar.networkPassphrase,
      });
      return signedTxXdr;
    },
    [address],
  );

  const value = useMemo(
    () => ({ address, connecting, connect, disconnect, signTransaction }),
    [address, connecting, connect, disconnect, signTransaction],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider.');
  return ctx;
}
