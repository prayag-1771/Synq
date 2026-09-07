'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { GitPullRequest, GitMerge, CircleDot, CheckCircle2, Loader2, GitPullRequestDraft } from 'lucide-react';
import { githubService } from '../../services/githubService';
import { useGitHubStore } from '../../stores/githubStore';

export interface RefSuggestion {
  number: number;
  title: string;
  kind: 'pull' | 'issue';
  state: string;
  draft?: boolean;
  author?: string;
}

interface Props {
  chatId: string;
  /** Text typed after the `#`. */
  query: string;
  activeIndex: number;
  onSuggestions: (items: RefSuggestion[]) => void;
  onSelect: (item: RefSuggestion) => void;
}

/**
 * Typing `#` in the composer opens this: the live list of open pull requests
 * and issues in the conversation's repository, so a reference is two keystrokes
 * rather than a trip to the browser.
 */
export default function RefAutocomplete({ chatId, query, activeIndex, onSuggestions, onSelect }: Props) {
  const reposByChat = useGitHubStore((s) => s.reposByChat);
  const status = useGitHubStore((s) => s.status);

  const [items, setItems] = useState<RefSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const primary = useMemo(() => {
    const repos = reposByChat[chatId];
    if (!repos || repos.length === 0) return null;
    return repos.find((r) => r.isPrimary) || repos[0];
  }, [chatId, reposByChat]);

  useEffect(() => {
    if (!primary || !status?.connected) {
      setItems([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      githubService.listPullRequests(primary.owner, primary.name, 'open').catch(() => []),
      githubService.listIssues(primary.owner, primary.name, 'open').catch(() => []),
    ])
      .then(([pulls, issues]) => {
        if (cancelled) return;
        const merged: RefSuggestion[] = [
          ...pulls.map((p: any) => ({
            number: p.number,
            title: p.title,
            kind: 'pull' as const,
            state: p.state,
            draft: p.draft,
            author: p.author?.login,
          })),
          ...issues.map((i: any) => ({
            number: i.number,
            title: i.title,
            kind: 'issue' as const,
            state: i.state,
            author: i.author?.login,
          })),
        ].sort((a, b) => b.number - a.number);
        setItems(merged);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [primary?.owner, primary?.name, status?.connected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items
      .filter((item) => String(item.number).startsWith(q) || item.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, query]);

  useEffect(() => {
    onSuggestions(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  if (!primary) return null;

  return (
    <div className="absolute bottom-full left-0 mb-3 bg-slate-900 border border-slate-800/80 rounded-xl shadow-2xl w-96 max-h-72 overflow-y-auto z-30 p-1.5 backdrop-blur-xl animate-in slide-in-from-bottom-2 duration-200 custom-scrollbar">
      <div className="px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}
        <span className="font-mono normal-case tracking-normal text-slate-400">{primary.fullName}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-slate-600">
          {loading ? 'Loading open work…' : 'No matching pull requests or issues.'}
        </div>
      ) : (
        <div className="py-0.5">
          {filtered.map((item, index) => {
            const Icon =
              item.kind === 'pull'
                ? item.state === 'merged'
                  ? GitMerge
                  : item.draft
                  ? GitPullRequestDraft
                  : GitPullRequest
                : item.state === 'closed'
                ? CheckCircle2
                : CircleDot;

            const color =
              item.kind === 'pull'
                ? item.draft
                  ? 'text-slate-500'
                  : 'text-emerald-400'
                : item.state === 'closed'
                ? 'text-purple-400'
                : 'text-emerald-400';

            return (
              <button
                key={`${item.kind}-${item.number}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg flex items-start gap-2 transition-colors ${
                  index === activeIndex
                    ? 'bg-indigo-600/20 border border-indigo-500/30'
                    : 'border border-transparent hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${color}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-200 truncate">{item.title}</div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    #{item.number}
                    {item.author ? ` · ${item.author}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
