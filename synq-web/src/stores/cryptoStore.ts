import { create } from 'zustand';

const PRIVATE_KEY_SLOT = 'synq_pk';
const PUBLIC_KEY_SLOT = 'synq_pub';

/**
 * Unlocked keys are kept for the life of the tab (sessionStorage), so a reload
 * does not re-prompt for the password. sessionStorage is per-tab and cleared
 * when the tab closes; it can be unavailable (private mode, blocked storage),
 * so every access is guarded.
 */
const tabStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const forgetSavedKeys = () => {
  const storage = tabStorage();
  try {
    storage?.removeItem(PRIVATE_KEY_SLOT);
    storage?.removeItem(PUBLIC_KEY_SLOT);
  } catch {
    /* storage blocked — nothing was saved */
  }
};

interface CryptoState {
  privateKeyHex: string | null;
  publicKeyHex: string | null;
  isUnlocked: boolean;
  setKeys: (privateKeyHex: string, publicKeyHex: string) => void;
  lockKeys: () => void;
  /**
   * Restores keys unlocked earlier in this tab — but only when they belong to
   * the signed-in account, checked against the public key the server holds for
   * it. Returns whether the keys were restored.
   */
  restoreKeys: (accountPublicKey: string) => boolean;
}

export const useCryptoStore = create<CryptoState>((set) => ({
  privateKeyHex: null,
  publicKeyHex: null,
  isUnlocked: false,

  setKeys: (privateKeyHex, publicKeyHex) => {
    const storage = tabStorage();
    try {
      storage?.setItem(PRIVATE_KEY_SLOT, privateKeyHex);
      storage?.setItem(PUBLIC_KEY_SLOT, publicKeyHex);
    } catch {
      /* storage blocked — keys stay in memory for this page only */
    }
    set({ privateKeyHex, publicKeyHex, isUnlocked: true });
  },

  // Signing out must also drop the saved copy, or the next person to sign in
  // on this tab would inherit the previous account's private key.
  lockKeys: () => {
    forgetSavedKeys();
    set({ privateKeyHex: null, publicKeyHex: null, isUnlocked: false });
  },

  restoreKeys: (accountPublicKey) => {
    const storage = tabStorage();
    let privateKeyHex: string | null = null;
    let publicKeyHex: string | null = null;
    try {
      privateKeyHex = storage?.getItem(PRIVATE_KEY_SLOT) ?? null;
      publicKeyHex = storage?.getItem(PUBLIC_KEY_SLOT) ?? null;
    } catch {
      return false;
    }

    if (privateKeyHex && publicKeyHex && accountPublicKey && publicKeyHex === accountPublicKey) {
      set({ privateKeyHex, publicKeyHex, isUnlocked: true });
      return true;
    }

    // Saved keys that belong to a different account are discarded, never used.
    if (privateKeyHex || publicKeyHex) forgetSavedKeys();
    return false;
  },
}));
