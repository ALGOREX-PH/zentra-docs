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
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

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
      const { walletId, address: savedAddress } = JSON.parse(saved);
      getKit().setWallet(walletId ?? FREIGHTER_ID);
      setAddress(savedAddress ?? null);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    const kit = getKit();
    try {
      await kit.openModal({
        onWalletSelected: async (option) => {
          try {
            kit.setWallet(option.id);
            const { address: addr } = await kit.getAddress();
            setAddress(addr);
            window.localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({ walletId: option.id, address: addr }),
            );
          } finally {
            setConnecting(false);
          }
        },
        onClosed: () => setConnecting(false),
      });
    } catch {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    window.localStorage.removeItem(STORAGE_KEY);
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
