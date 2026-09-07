'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Search, Lock, Globe, Check, AlertCircle, Radio, Star } from 'lucide-react';
import { githubService, GitHubNotConnectedError } from '../../services/githubService';
import { useGitHubStore } from '../../stores/githubStore';
import { GitHubMark } from './GitHubRefCard';

interface Props {
  chatId: string;
}

/**
 * Binds a repository to the conversation. Once linked, bare `#123` and
 * `src/file.ts:20-40` shorthand resolve against it, and — with a webhook —
 * pull requests, pushes and CI results stream into the chat.
 */
export default function LinkRepoModal({ chatId }: Props) {
  const { showLinkRepoModal, openLinkRepoModal, openConnectModal, setRepos } = useGitHubStore();

  const [repos, setRepoList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [installWebhook, setInstallWebhook] = useState(true);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!showLinkRepoModal) return;

    setLoading(true);
    setError(null);
    githubService
      .listMyRepositories()
      .then(setRepoList)
      .catch((err) => {
        if (err instanceof GitHubNotConnectedError) {
          openLinkRepoModal(false);
          openConnectModal(true);
        } else {
          setError(err?.message || 'Could not load your repositories');
        }
      })
      .finally(() => setLoading(false));
  }, [showLinkRepoModal, openConnectModal, openLinkRepoModal]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos.slice(0, 60);
    return repos.filter((r) => r.fullName.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)).slice(0, 60);
  }, [repos, query]);

  if (!showLinkRepoModal) return null;

  const handleLink = async (fullName: string) => {
    setLinking(fullName);
    setError(null);
    setNotice(null);

    try {
      const result = await githubService.linkRepository(chatId, fullName, installWebhook);
      const refreshed = await githubService.listChatRepositories(chatId);
      setRepos(chatId, refreshed);

      if (result.webhookError) {
        setNotice(`${fullName} linked. ${result.webhookError}`);
      } else {
        openLinkRepoModal(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to link repository');
    } finally {
      setLinking(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl h-[80vh] shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 p-5 border-b border-slate-800/60">
          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-200">
            <GitHubMark className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-100">Link a repository</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Makes <code className="font-mono text-slate-400">#123</code> and{' '}
              <code className="font-mono text-slate-400">src/file.ts:20-40</code> resolve in this conversation
            </p>
          </div>
          <button
            onClick={() => openLinkRepoModal(false)}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-800/60 space-y-3">
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 w-4 h-4 text-slate-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter repositories…"
              className="w-full pl-10 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer group">
            <div
              className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                installWebhook ? 'bg-indigo-600 border-indigo-500' : 'bg-slate-950 border-slate-700 group-hover:border-slate-600'
              }`}
              onClick={(e) => {
                e.preventDefault();
                setInstallWebhook(!installWebhook);
              }}
            >
              {installWebhook && <Check className="w-3 h-3 text-white" />}
            </div>
            <div className="flex-1">
              <div className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-indigo-400" />
                Stream live activity into this chat
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Installs a webhook for pull requests, pushes, reviews and CI. Needs admin rights on the repository.
              </div>
            </div>
          </label>
        </div>

        {(error || notice) && (
          <div
            className={`mx-4 mt-3 flex items-start gap-2 p-3 rounded-xl border text-xs ${
              error ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            {error || notice}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 text-sm gap-2">
              <GitHubMark className="w-8 h-8 opacity-30" />
              No repositories match that filter.
            </div>
          ) : (
            filtered.map((repo) => (
              <button
                key={repo.fullName}
                onClick={() => handleLink(repo.fullName)}
                disabled={Boolean(linking)}
                className="w-full text-left p-3 rounded-xl border border-transparent hover:border-slate-800 hover:bg-slate-800/40 transition-colors disabled:opacity-50 group"
              >
                <div className="flex items-center gap-2.5">
                  {repo.isPrivate ? (
                    <Lock className="w-3.5 h-3.5 text-amber-500/70 shrink-0" />
                  ) : (
                    <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <span className="text-sm font-medium text-slate-200 group-hover:text-white truncate">
                    {repo.fullName}
                  </span>
                  {repo.language && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 shrink-0">
                      {repo.language}
                    </span>
                  )}
                  {repo.stars > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-slate-500 shrink-0">
                      <Star className="w-3 h-3" />
                      {repo.stars}
                    </span>
                  )}
                  {linking === repo.fullName && <Loader2 className="w-4 h-4 animate-spin text-indigo-400 ml-auto shrink-0" />}
                </div>
                {repo.description && (
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-1 pl-6">{repo.description}</p>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
