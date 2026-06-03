import { create } from 'zustand';

interface CryptoState {
  privateKeyHex: string | null;
  publicKeyHex: string | null;
  isUnlocked: boolean;
  setKeys: (privateKeyHex: string, publicKeyHex: string) => void;
  lockKeys: () => void;
}

export const useCryptoStore = create<CryptoState>((set) => ({
  privateKeyHex: null,
  publicKeyHex: null,
  isUnlocked: false,
  setKeys: (privateKeyHex, publicKeyHex) =>
    set({ privateKeyHex, publicKeyHex, isUnlocked: true }),
  lockKeys: () => set({ privateKeyHex: null, publicKeyHex: null, isUnlocked: false }),
}));
