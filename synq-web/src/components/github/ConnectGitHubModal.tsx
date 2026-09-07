'use client';

import React, { useState } from 'react';
import { X, Loader2, KeyRound, ExternalLink, ShieldCheck, AlertCircle, Unlink } from 'lucide-react';
import { githubService } from '../../services/githubService';
import { useGitHubStore } from '../../stores/githubStore';
import { GitHubMark } from './GitHubRefCard';

const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:org,read:user&description=Synq%20Integration';

/**
 * Connects a developer's GitHub identity. Personal access tokens work with no
 * server-side setup; OAuth appears when the deployment has an OAuth App.
 */
export default function ConnectGitHubModal() {
  const { showConnectModal, openConnectModal, status, setStatus } = useGitHubStore();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!showConnectModal) return null;

  const close = () => {
    setToken('');
    setError(null);
    openConnectModal(false);
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setBusy(true);
    setError(null);
    try {
      await githubService.connectWithToken(token.trim());
      const fresh = await githubService.getStatus();
      setStatus(fresh);
      close();
    } catch (err: any) {
      setError(err?.message || 'Could not connect to GitHub');
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await githubService.getOAuthUrl();
      window.location.href = url;
    } catch (err: any) {
      setError(err?.message || 'OAuth is not available on this server');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await githubService.disconnect();
      const fresh = await githubService.getStatus();
      setStatus(fresh);
      await githubService.invalidateRefs();
      close();
    } catch (err: any) {
      setError(err?.message || 'Could not disconnect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 p-5 border-b border-slate-800/60">
          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-200">
            <GitHubMark className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-100">
              {status?.connected ? 'GitHub connected' : 'Connect GitHub'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {status?.connected
                ? `Signed in as ${status.login}`
                : 'Turn references into live pull requests, issues and code'}
            </p>
          </div>
          <button onClick={close} className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {status?.connected ? (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              {status.avatarUrl && <img src={status.avatarUrl} alt="" className="w-10 h-10 rounded-lg bg-slate-800" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-100">{status.login}</div>
                <div className="text-[11px] text-slate-500">
                  {status.tokenType === 'oauth' ? 'OAuth' : 'Personal access token'}
                  {status.connectedAt ? ` · connected ${new Date(status.connectedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Your token is encrypted at rest and used only to read and act on repositories on your behalf. Synq never
              sends your message text to GitHub — only the reference tokens it extracts locally.
            </p>

            <button
              onClick={handleDisconnect}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
              Disconnect GitHub
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {status?.oauthAvailable && (
              <>
                <button
                  onClick={handleOAuth}
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-slate-100 hover:bg-white text-slate-900 text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  <GitHubMark className="w-4 h-4" />
                  Continue with GitHub
                </button>
                <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-slate-600">
                  <div className="flex-1 h-px bg-slate-800" />
                  or use a token
                  <div className="flex-1 h-px bg-slate-800" />
                </div>
              </>
            )}

            <form onSubmit={handleConnect} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Personal access token</label>
                <div className="relative flex items-center">
                  <KeyRound className="absolute left-3 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_… or github_pat_…"
                    autoComplete="off"
                    className="w-full pl-10 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              </div>

              <a
                href={TOKEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Create a token with <code className="font-mono text-slate-400">repo</code> scope
              </a>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !token.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-semibold transition-colors"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Connect
              </button>
            </form>

            <p className="text-[11px] text-slate-600 leading-relaxed">
              Tokens are encrypted with AES-256-GCM before storage. Synq reads repositories with your permissions — you
              will never see anything on GitHub you could not already see.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
