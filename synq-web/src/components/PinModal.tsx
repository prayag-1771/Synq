'use client';

import React, { useState, useEffect } from 'react';
import { useCryptoStore } from '../stores/cryptoStore';
import { apiService } from '../services/apiService';
import {
  deriveKeyFromPin,
  generateSalt,
  generateKeyPair,
  encryptPrivateKey,
  decryptPrivateKey
} from '../services/cryptoService';
import { Lock, Unlock, Loader2, AlertCircle } from 'lucide-react';

export default function PinModal() {
  const { isUnlocked, setKeys, restoreKeys } = useCryptoStore();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const [fetchingStatus, setFetchingStatus] = useState(true);

  // Check if user has keys on server
  useEffect(() => {
    const checkKeys = async () => {
      try {
        const res = await apiService.get('/keys/me');
        if (res.ok) {
          const data = await res.json();
          // Keys unlocked earlier in this tab are reused — but only if they
          // belong to this account, so a reload does not re-prompt.
          if (data.publicKey && restoreKeys(data.publicKey)) return;
          // If keys are returned, user already has them
          setIsNewUser(!data.encryptedPrivateKey);
        } else if (res.status === 404) {
          // If 404, no keys exist
          setIsNewUser(true);
        } else {
          // Any other error (500, network error) should block to prevent accidental key overwrite
          setError('Failed to connect to key server. Please refresh and try again.');
          return; // don't set fetchingStatus false yet, or handle appropriately
        }
      } catch (err) {
        console.error('Failed to fetch keys', err);
        setError('Network error checking keys.');
      } finally {
        setFetchingStatus(false);
      }
    };
    checkKeys();
  }, []);

  if (isUnlocked || fetchingStatus) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 6) {
      setError('PIN must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (isNewUser) {
        // --- 1. GENERATE NEW KEYS ---
        const salt = await generateSalt();
        const derivedKey = await deriveKeyFromPin(pin, salt);
        const { publicKey, privateKey } = await generateKeyPair();
        
        // Encrypt the private key with the PIN-derived key
        const encryptedSk = await encryptPrivateKey(privateKey, derivedKey);
        
        // Upload to server
        const res = await apiService.post('/keys/upload', {
          publicKey,
          encryptedPrivateKey: encryptedSk,
          keySalt: salt,
        });

        if (!res.ok) throw new Error('Failed to upload keys');
        
        // Store in memory
        setKeys(privateKey, publicKey);
      } else {
        // --- 2. RECOVER EXISTING KEYS ---
        const res = await apiService.get('/keys/me');
        if (!res.ok) throw new Error('Failed to fetch keys');
        
        const { publicKey, encryptedPrivateKey, keySalt } = await res.json();
        
        // Derive key and decrypt
        const derivedKey = await deriveKeyFromPin(pin, keySalt);
        
        try {
          const privateKey = await decryptPrivateKey(encryptedPrivateKey, derivedKey);
          setKeys(privateKey, publicKey);
        } catch (decryptErr) {
          throw new Error('Incorrect PIN. Failed to decrypt keys.');
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-title"
        className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7 shadow-2xl shadow-black/60 rise"
      >
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-11 h-11 rounded-xl bg-accent-soft border border-accent/25 grid place-items-center text-accent-bright mb-4">
            {isNewUser ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
          </div>
          <h2 id="pin-title" className="text-[18px] font-semibold tracking-tight text-ink">
            {isNewUser ? 'Set up encryption' : 'Unlock your messages'}
          </h2>
          <p className="text-[12.5px] text-subtle mt-1.5 leading-relaxed">
            {isNewUser
              ? 'Your password encrypts your private key on this device. You will need it to read your messages anywhere else.'
              : 'Your messages are end-to-end encrypted. Enter your password to decrypt them on this device.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="pin-input" className="text-[10.5px] font-semibold text-subtle tracking-[0.08em] uppercase">
              Account password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
              <input
                id="pin-input"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full h-11 pl-10 pr-3 rounded-lg border border-line bg-raised text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-accent/60 focus:bg-hover transition-colors"
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-critical/10 border border-critical/25 text-critical text-[12.5px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || pin.length < 6}
            className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-accent hover:bg-accent-bright disabled:bg-raised disabled:text-faint disabled:cursor-not-allowed text-white text-[13.5px] font-semibold transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isNewUser ? 'Secure my account' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
