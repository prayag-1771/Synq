'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { githubService } from '../../../services/githubService';

/**
 * GitHub OAuth redirect target. Reads the code from the URL after mount (rather
 * than useSearchParams) so the route needs no Suspense boundary.
 */
export default function GitHubCallbackPage() {
  const router = useRouter();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('Completing GitHub authorisation…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error_description') || params.get('error');

    if (oauthError) {
      setState('error');
      setMessage(oauthError);
      return;
    }
    if (!code) {
      setState('error');
      setMessage('No authorisation code was returned by GitHub.');
      return;
    }

    githubService
      .completeOAuth(code)
      .then((result) => {
        setState('done');
        setMessage(`Connected as ${result.login}. Returning to Synq…`);
        setTimeout(() => router.replace('/'), 1200);
      })
      .catch((err) => {
        setState('error');
        setMessage(err?.message || 'Could not complete the GitHub connection.');
      });
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
        <div className="flex justify-center mb-4">
          {state === 'working' && <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />}
          {state === 'done' && <CheckCircle2 className="w-8 h-8 text-emerald-400" />}
          {state === 'error' && <AlertTriangle className="w-8 h-8 text-rose-400" />}
        </div>

        <h1 className="text-sm font-semibold text-slate-100 mb-2">
          {state === 'error' ? 'Connection failed' : 'GitHub'}
        </h1>
        <p className="text-xs text-slate-400 leading-relaxed">{message}</p>

        {state === 'error' && (
          <button
            onClick={() => router.replace('/')}
            className="mt-5 w-full px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
          >
            Back to Synq
          </button>
        )}
      </div>
    </div>
  );
}
