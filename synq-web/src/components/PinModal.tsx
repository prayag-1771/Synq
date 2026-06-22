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
  const { isUnlocked, setKeys } = useCryptoStore();
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
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 max-w-sm w-full">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
            {isNewUser ? <Lock className="w-8 h-8" /> : <Unlock className="w-8 h-8" />}
          </div>
        </div>
        
        <h2 className="text-xl font-bold text-white text-center mb-2">
          {isNewUser ? 'Set up End-to-End Encryption' : 'Enter Account Password'}
        </h2>
        
        <p className="text-xs text-slate-400 text-center mb-6">
          {isNewUser 
            ? 'Enter your account password to secure your chat history. You will need this to read your messages on new devices.'
            : 'Enter your account password to decrypt your private keys and access your secure chat history.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Your password"
              className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-center text-xl tracking-[0.2em] text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
              autoFocus
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-2 items-center text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || pin.length < 6}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isNewUser ? 'Secure My Account' : 'Decrypt History'}
          </button>
        </form>
      </div>
    </div>
  );
}
