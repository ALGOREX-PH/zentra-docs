'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { stellar } from '@/config/stellar';
import { FREIGHTER_ID, getKit, type WalletKit } from '@/lib/stellar/kit';

const STORAGE_KEY = 'zentra:wallet';

/**
 * How a connection attempt ended, so the caller can say the right thing:
 *
 * - `connected` — an address is live; the UI can close its picker.
 * - `declined` — the user said no (closed the kit's modal, or rejected the
 *   request inside the wallet). Not an error; the wallet works fine.
 * - `unavailable` — the attempt failed for any other reason: the kit's lazy
 *   chunks did not load, the wallet is missing, locked, or unreachable.
 *
 * Returned rather than thrown so a component can branch on the outcome without
 * re-deriving it from `connecting` falling back to false.
 */
export type ConnectOutcome = 'connected' | 'declined' | 'unavailable';

interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  /**
   * Connect the given wallet, or fall back to the kit's own picker when the
   * caller has not chosen one. Never rejects — the outcome says how it went.
   */
  connect: (walletId?: string) => Promise<ConnectOutcome>;
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
    'walletId' in parsed && typeof parsed.walletId === 'string' ? parsed.walletId : FREIGHTER_ID;
  return { walletId, address: parsed.address };
}

/**
 * Which module the kit ended up on, so a reconnect reaches for the wallet the
 * user actually picked rather than assuming Freighter. `selectedModule` throws
 * when nothing is selected, hence the guard.
 */
function selectedWalletId(kit: WalletKit): string {
  try {
    return kit.selectedModule.productId;
  } catch {
    return FREIGHTER_ID;
  }
}

/**
 * Whether a connection failure was the user saying no, as opposed to the
 * wallet being broken or absent.
 *
 * The kit rejects with plain `{ code, message }` objects and passes wallet
 * errors through `parseError`, so the message is the only usable signal: the
 * kit's own modal-close is "The user closed the modal.", and the wallets word
 * their refusals with declined/rejected/denied/cancelled. Anything that does
 * not read as a refusal is treated as the wallet being unavailable — the safer
 * of the two claims, since it tells the user to check the wallet rather than
 * blaming them for a decline they never made.
 */
function isDecline(cause: unknown): boolean {
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : '';
  return /declin|reject|denied|cancel|closed the modal/i.test(message);
}

/**
 * Holds the single source of truth for "is a wallet connected, and which one".
 *
 * The connection survives a refresh: the selected wallet id + address are
 * persisted to localStorage and rehydrated on mount, so the dApp doesn't make
 * the user reconnect every navigation.
 *
 * The kit itself loads lazily (see `@/lib/stellar/kit`), so every kit call in
 * here crosses an async boundary. Rehydration shows the persisted address
 * immediately and lets the kit catch up when its chunks arrive — a returning
 * user should not watch their own address pop in after a network round-trip.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    let persisted: PersistedWallet | null = null;
    try {
      persisted = readPersisted(saved);
    } catch {
      persisted = null;
    }
    if (!persisted) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    // Optimistic: the address renders now, and the kit is pointed at the saved
    // module once its lazy chunks land.
    setAddress(persisted.address);
    const target = persisted;
    let cancelled = false;
    getKit()
      .then(async (kit) => {
        if (cancelled) return;
        try {
          kit.setWallet(target.walletId);
        } catch {
          // The saved id names a module that no longer exists — a stale entry,
          // so drop it and stay disconnected rather than sign with a guess.
          window.localStorage.removeItem(STORAGE_KEY);
          setAddress(null);
          return;
        }
        /*
         * Reconcile the rehydrated address against the kit's own record. The
         * kit persists its active account independently of ours, and the two
         * can drift — the user switched accounts on another page, or one of
         * the two storage entries was cleared. `getAddress` reads the kit's
         * memory and never wakes the wallet; `fetchAddress` is deliberately
         * not used here, because probing an extension on page load can throw
         * a permission prompt at a user who asked for nothing.
         *
         * Mismatch → the kit's record wins and is re-persisted: it was written
         * by an actual wallet handshake, ours is just a cache of one. Kit has
         * no record (its entry cleared, or it threw) → keep the optimistic
         * value; a missing record is not evidence the session is invalid, and
         * the next signature will confront the real wallet either way.
         */
        try {
          const { address: current } = await kit.getAddress();
          if (cancelled || current === target.address) return;
          setAddress(current);
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ walletId: target.walletId, address: current }),
          );
        } catch {
          // Kit memory is empty or unreachable — the optimistic value stands.
        }
      })
      .catch(() => {
        // The kit itself failed to load. The optimistic address stands — any
        // later signing attempt will surface its own error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (walletId?: string): Promise<ConnectOutcome> => {
    setConnecting(true);
    try {
      let kit: WalletKit;
      try {
        kit = await getKit();
      } catch {
        // The lazy chunks never arrived — nothing wallet-side was even asked.
        return 'unavailable';
      }
      // A wallet id means the caller already ran its own picker, so the kit's
      // modal is skipped and the chosen module is asked for the address direct.
      if (walletId) kit.setWallet(walletId);
      const { address: addr } = walletId ? await kit.fetchAddress() : await kit.authModal();
      setAddress(addr);
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ walletId: selectedWalletId(kit), address: addr }),
      );
      return 'connected';
    } catch (cause) {
      // Either way the dApp stays disconnected; the outcome tells the caller
      // whether that was the user's choice or the wallet's failure.
      return isDecline(cause) ? 'declined' : 'unavailable';
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    window.localStorage.removeItem(STORAGE_KEY);
    // Fire-and-forget, but never unhandled: the app's own state is already
    // cleared above, so a wallet that fails its teardown changes nothing —
    // without the catch, that async rejection would surface as an unhandled
    // promise error in the console of a user who successfully disconnected.
    getKit()
      .then((kit) => kit.disconnect())
      .catch(() => {});
  }, []);

  const signTransaction = useCallback(
    async (xdr: string) => {
      if (!address) throw new Error('Connect your wallet first.');
      const kit = await getKit();
      const { signedTxXdr } = await kit.signTransaction(xdr, {
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
