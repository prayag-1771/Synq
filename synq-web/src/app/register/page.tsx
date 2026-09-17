'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SynqMark from '../../components/SynqMark';
import { useAuthStore } from '../../stores/authStore';
import { useCryptoStore } from '../../stores/cryptoStore';
import { apiService } from '../../services/apiService';
import { generateKeyPair, generateSalt, deriveKeyFromPin, encryptPrivateKey } from '../../services/cryptoService';
import { MessageSquare, Mail, User, Lock, Loader2, ArrowRight } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated } = useAuthStore();
  const { setKeys } = useCryptoStore();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('[Register] Starting cryptographic key generation...');
      
      // 1. Generate E2EE Keys locally
      const { publicKey, privateKey } = await Promise.race([
        generateKeyPair(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Cryptography engine failed to load (WASM timeout)')), 5000))
      ]);
      
      console.log('[Register] Keys generated. Generating salt...');
      const salt = await generateSalt();
      
      console.log('[Register] Deriving PIN...');
      const derivedKey = await deriveKeyFromPin(password, salt);
      
      console.log('[Register] Encrypting Private Key...');
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, derivedKey);
      
      console.log('[Register] Crypto complete. Sending to server...');

      // Unlock for this tab (setKeys also keeps it across reloads)
      setKeys(privateKey, publicKey);

      // 2. Send keys to the server
      const response = await apiService.post('/auth/register', {
        username,
        email,
        password,
        publicKey,
        encryptedPrivateKey,
        keySalt: salt
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.errors && data.errors.length > 0) {
          throw new Error(data.errors[0].message);
        }
        throw new Error(data.message || 'Registration failed');
      }

      setAuth(data.user, data.accessToken, data.refreshToken);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen app-canvas flex items-center justify-center overflow-hidden px-4">
      {/* Background Gradients */}
      
      

      {/* Register Card */}
      <div className="w-full max-w-[400px] rounded-2xl border border-line bg-surface p-7 shadow-2xl shadow-black/50 relative z-10 rise">
        <div className="flex flex-col items-center mb-7">
          <SynqMark variant="badge" className="w-10 h-10 mb-4" />
          <h1 className="text-[21px] font-semibold tracking-tight text-ink">
            Create your account
          </h1>
          <p className="text-[12.5px] text-subtle mt-1.5 text-center">
            Encrypted team messaging, wired to your repositories
          </p>
        </div>

        {error && (
          <div className="mb-5 px-3.5 py-2.5 rounded-lg bg-critical/10 border border-critical/25 text-critical text-[12.5px]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-semibold text-subtle tracking-[0.08em] uppercase">
              Username
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-faint">
                <User className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-11 pl-10 pr-3 rounded-lg border border-line bg-raised text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-accent/60 focus:bg-hover transition-colors"
                placeholder="johndoe"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10.5px] font-semibold text-subtle tracking-[0.08em] uppercase">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-faint">
                <Mail className="w-4 h-4" />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 pl-10 pr-3 rounded-lg border border-line bg-raised text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-accent/60 focus:bg-hover transition-colors"
                placeholder="john@example.com"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10.5px] font-semibold text-subtle tracking-[0.08em] uppercase">
              Password
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-faint">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 pl-10 pr-3 rounded-lg border border-line bg-raised text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-accent/60 focus:bg-hover transition-colors"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-accent hover:bg-accent-bright active:scale-[0.99] disabled:bg-raised disabled:text-faint text-white text-[13.5px] font-semibold transition-all"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                Create Account
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-[12.5px] text-subtle">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-accent-bright hover:text-accent-ink transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
