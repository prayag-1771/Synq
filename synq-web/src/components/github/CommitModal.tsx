'use client';

import React, { useEffect, useState } from 'react';
import { X, Loader2, GitCommit, ExternalLink, Sparkles, Share2, Plus, Minus, Send, AlertTriangle } from 'lucide-react';
import { githubService, GitHubNotConnectedError } from '../../services/githubService';
import { useGitHubStore } from '../../stores/githubStore';
import DiffView from './DiffView';
import { Markdownish } from './PullRequestModal';

/**
 * A commit, opened from an `@sha` reference in chat. The point of this view is
 * the AI explanation: "what did this actually change, and why" — answered from
 * the real diff rather than the commit message.
 */
export default function CommitModal() {
  const { commitTarget, openCommit, queueComposerInsert, openConnectModal } = useGitHubStore();

  const [commit, setCommit] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [explanation, setExplanation] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const target = commitTarget;

  useEffect(() => {
    if (!target) return;

    setLoading(true);
    setError(null);
    setCommit(null);
    setExplanation(null);
    setQuestion('');

    githubService
      .getCommit(target.owner, target.repo, target.sha)
      .then(setCommit)
      .catch((err) => {
        if (err instanceof GitHubNotConnectedError) {
          openCommit(null);
          openConnectModal(true);
        } else {
          setError(err?.message || 'Could not load this commit');
        }
      })
      .finally(() => setLoading(false));
  }, [target?.owner, target?.repo, target?.sha]);

  if (!target) return null;

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const explain = async () => {
    setExplaining(true);
    try {
      const result = await githubService.aiExplainCommit(
        target.owner,
        target.repo,
        target.sha,
        question.trim() || undefined
      );
      setExplanation(result.explanation);
    } catch (err: any) {
      flash(err?.message || 'AI explanation failed');
    } finally {
      setExplaining(false);
    }
  };

  const [subject, ...bodyLines] = (commit?.message || '').split('\n');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-sm">
      <div className="bg-surface border border-line rounded-2xl w-full max-w-4xl h-[85vh] shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-line/60 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-raised border border-line-strong/60 flex items-center justify-center text-ink/85 shrink-0">
            <GitCommit className="w-4 h-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] text-subtle">
                {target.owner}/{target.repo}
              </span>
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-raised text-ink/85">
                {target.sha.slice(0, 7)}
              </span>
            </div>
            <h2 className="text-sm font-semibold text-ink leading-snug">{loading ? 'Loading…' : subject}</h2>

            {commit && (
              <div className="flex items-center flex-wrap gap-2.5 mt-2 text-[11px]">
                {commit.author?.login && (
                  <span className="flex items-center gap-1.5 text-muted">
                    {commit.author.avatarUrl && (
                      <img src={commit.author.avatarUrl} alt="" className="w-4 h-4 rounded-full bg-raised" />
                    )}
                    {commit.author.login}
                  </span>
                )}
                <span className="text-faint">{new Date(commit.date).toLocaleString()}</span>
                {commit.stats && (
                  <span className="font-mono flex items-center gap-1.5">
                    <span className="text-emerald-400 flex items-center gap-0.5">
                      <Plus className="w-3 h-3" />
                      {commit.stats.additions}
                    </span>
                    <span className="text-rose-400 flex items-center gap-0.5">
                      <Minus className="w-3 h-3" />
                      {commit.stats.deletions}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                queueComposerInsert(`${target.owner}/${target.repo}@${target.sha.slice(0, 7)}`);
                flash('Reference added to your message');
              }}
              title="Add this reference to your message"
              className="p-2 rounded-xl text-muted hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
            >
              <Share2 className="w-4 h-4" />
            </button>
            {commit?.htmlUrl && (
              <a
                href={commit.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-xl text-muted hover:text-ink hover:bg-raised transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button
              onClick={() => openCommit(null)}
              className="p-2 rounded-xl text-muted hover:text-ink hover:bg-raised transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {loading && (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {commit && (
            <>
              {bodyLines.join('\n').trim() && (
                <div className="rounded-xl border border-line bg-canvas/40 p-4">
                  <pre className="text-[11px] text-muted whitespace-pre-wrap font-mono leading-relaxed">
                    {bodyLines.join('\n').trim()}
                  </pre>
                </div>
              )}

              {/* AI explanation */}
              <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/20 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-500/20 bg-indigo-950/30">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300 flex-1">
                    Understand this commit
                  </span>
                  {explanation && (
                    <button
                      onClick={() => {
                        queueComposerInsert(explanation);
                        flash('Explanation added to your message');
                      }}
                      title="Add to your message"
                      className="p-1 rounded-md text-indigo-400/70 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') explain();
                      }}
                      placeholder="Ask something specific, or leave blank for a full explanation…"
                      className="flex-1 px-3 py-2 bg-canvas border border-line rounded-lg text-xs text-ink placeholder-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                    <button
                      onClick={explain}
                      disabled={explaining}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {explaining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Explain
                    </button>
                  </div>

                  {explanation && <Markdownish text={explanation} />}
                </div>
              </div>

              <DiffView
                files={commit.files || []}
                onQuoteLine={(path, line) => {
                  queueComposerInsert(`${path}:${line}`);
                  flash(`Added ${path}:${line} to your message`);
                }}
              />
            </>
          )}
        </div>

        {toast && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-raised border border-line-strong text-xs text-ink shadow-2xl animate-in fade-in slide-in-from-bottom-2">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
