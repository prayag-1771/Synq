'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Loader2,
  GitMerge,
  GitBranch,
  Check,
  ThumbsUp,
  AlertTriangle,
  MessageSquare,
  Send,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Clock,
  FileCode,
  ShieldCheck,
  ChevronDown,
  CircleDot,
  Share2,
  Wand2,
} from 'lucide-react';
import { githubService, GitHubNotConnectedError } from '../../services/githubService';
import { useGitHubStore } from '../../stores/githubStore';
import DiffView from './DiffView';
import { GitHubMark } from './GitHubRefCard';

type Tab = 'conversation' | 'files' | 'checks' | 'ai';

const SEVERITY_STYLES: Record<string, { badge: string; border: string }> = {
  critical: { badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30', border: 'border-l-rose-500' },
  major: { badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30', border: 'border-l-orange-500' },
  minor: { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', border: 'border-l-amber-500' },
  nit: { badge: 'bg-subtle/15 text-muted border-line-strong/30', border: 'border-l-line-strong' },
};

/**
 * The full pull request (or issue) surface, opened from a reference in chat.
 * Everything a developer would leave for github.com to do — read the diff,
 * check CI, review, comment, merge — happens here instead.
 */
export default function PullRequestModal() {
  const { pullRequestTarget, openPullRequest, queueComposerInsert, openConnectModal } = useGitHubStore();

  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('conversation');
  const [toast, setToast] = useState<string | null>(null);

  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<'squash' | 'merge' | 'rebase'>('squash');
  const [showMergeMenu, setShowMergeMenu] = useState(false);

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<any>(null);
  const [aiDescription, setAiDescription] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const target = pullRequestTarget;

  useEffect(() => {
    if (!target) return;

    setLoading(true);
    setError(null);
    setDetail(null);
    setAiSummary(null);
    setAiReview(null);
    setAiDescription(null);
    setTab('conversation');

    githubService
      .getPullRequest(target.owner, target.repo, target.number)
      .then(setDetail)
      .catch((err) => {
        if (err instanceof GitHubNotConnectedError) {
          openPullRequest(null);
          openConnectModal(true);
        } else {
          setError(err?.message || 'Could not load this reference');
        }
      })
      .finally(() => setLoading(false));
  }, [target?.owner, target?.repo, target?.number]);

  if (!target) return null;

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const close = () => openPullRequest(null);

  const reload = async () => {
    const fresh = await githubService.getPullRequest(target.owner, target.repo, target.number);
    setDetail(fresh);
    // The cached chip in the message list is now stale.
    await githubService.invalidateRefs([
      `pull:${target.owner}/${target.repo}#${target.number}`,
      `issue:${target.owner}/${target.repo}#${target.number}`,
    ]);
  };

  const isPull = detail?.type === 'pull';
  const item = detail?.item;
  const pr = detail?.pullRequest;

  const handleComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await githubService.comment(target.owner, target.repo, target.number, comment.trim());
      setComment('');
      await reload();
      flash('Comment posted to GitHub');
    } catch (err: any) {
      flash(err?.message || 'Could not post comment');
    } finally {
      setPosting(false);
    }
  };

  const handleReview = async (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT') => {
    if (event !== 'APPROVE' && !comment.trim()) {
      flash('Add a comment before requesting changes');
      return;
    }
    setPosting(true);
    try {
      await githubService.submitReview(target.owner, target.repo, target.number, event, comment.trim() || undefined);
      setComment('');
      await reload();
      flash(event === 'APPROVE' ? 'Pull request approved' : 'Review submitted');
    } catch (err: any) {
      flash(err?.message || 'Could not submit review');
    } finally {
      setPosting(false);
    }
  };

  const handleMerge = async () => {
    setMerging(true);
    setShowMergeMenu(false);
    try {
      await githubService.mergePullRequest(target.owner, target.repo, target.number, mergeMethod);
      await reload();
      flash(`Merged with ${mergeMethod}`);
    } catch (err: any) {
      flash(err?.message || 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  const runAi = async (kind: 'summary' | 'review' | 'describe') => {
    setAiBusy(kind);
    setTab('ai');
    try {
      if (kind === 'summary') {
        setAiSummary(await githubService.aiSummarizePullRequest(target.owner, target.repo, target.number));
      } else if (kind === 'review') {
        setAiReview(await githubService.aiReviewPullRequest(target.owner, target.repo, target.number));
      } else {
        const result = await githubService.aiDescribePullRequest(target.owner, target.repo, target.number);
        setAiDescription(result.description);
      }
    } catch (err: any) {
      flash(err?.message || 'AI request failed');
    } finally {
      setAiBusy(null);
    }
  };

  const postAiReviewToGitHub = async () => {
    if (!aiReview) return;
    setAiBusy('post');
    try {
      const body = formatReviewForGitHub(aiReview);
      await githubService.submitReview(
        target.owner,
        target.repo,
        target.number,
        aiReview.verdict === 'request_changes' ? 'REQUEST_CHANGES' : 'COMMENT',
        body
      );
      await reload();
      flash('AI review posted to GitHub');
    } catch (err: any) {
      flash(err?.message || 'Could not post review');
    } finally {
      setAiBusy(null);
    }
  };

  const shareInChat = () => {
    queueComposerInsert(`${target.owner}/${target.repo}#${target.number}`);
    flash('Reference added to your message');
  };

  const quoteLine = (path: string, line: number) => {
    queueComposerInsert(`${path}:${line}`);
    flash(`Added ${path}:${line} to your message`);
  };

  const stateStyle =
    item?.state === 'merged'
      ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
      : item?.state === 'closed'
      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
      : pr?.draft
      ? 'bg-subtle/15 text-muted border-line-strong/30'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

  const checksSummary = (detail?.checks || []).reduce(
    (acc: any, c: any) => {
      if (c.status !== 'completed') acc.pending++;
      else if (['success', 'neutral', 'skipped'].includes(c.conclusion)) acc.passed++;
      else acc.failed++;
      return acc;
    },
    { passed: 0, failed: 0, pending: 0 }
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-sm">
      <div className="bg-surface border border-line rounded-2xl w-full max-w-5xl h-[88vh] shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line/60">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-[11px] text-subtle">
                  {target.owner}/{target.repo}
                </span>
                {item && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${stateStyle}`}>
                    {pr?.draft && item.state === 'open' ? 'draft' : item.state}
                  </span>
                )}
              </div>
              <h2 className="text-base font-semibold text-ink leading-snug pr-4">
                {loading ? 'Loading…' : item?.title || `#${target.number}`}
                <span className="text-subtle font-normal ml-2">#{target.number}</span>
              </h2>

              {pr && (
                <div className="flex items-center flex-wrap gap-2 mt-2 text-[11px]">
                  <span className="flex items-center gap-1.5 font-mono text-muted">
                    <GitBranch className="w-3 h-3 text-subtle" />
                    <span className="px-1.5 py-0.5 rounded bg-raised">{pr.head?.ref}</span>
                    <span className="text-faint">→</span>
                    <span className="px-1.5 py-0.5 rounded bg-raised">{pr.base?.ref}</span>
                  </span>
                  <span className="font-mono text-subtle">
                    <span className="text-emerald-400">+{pr.additions}</span>{' '}
                    <span className="text-rose-400">-{pr.deletions}</span> · {pr.changedFiles} files
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={shareInChat}
                title="Add this reference to your message"
                className="p-2 rounded-xl text-muted hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
              >
                <Share2 className="w-4 h-4" />
              </button>
              {item?.htmlUrl && (
                <a
                  href={item.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-xl text-muted hover:text-ink hover:bg-raised transition-colors"
                  title="Open on GitHub"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <button onClick={close} className="p-2 rounded-xl text-muted hover:text-ink hover:bg-raised transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          {detail && (
            <div className="flex items-center gap-1 mt-3 -mb-4">
              <TabButton active={tab === 'conversation'} onClick={() => setTab('conversation')} icon={<MessageSquare className="w-3.5 h-3.5" />}>
                Conversation
                {detail.comments?.length > 0 && <Count value={detail.comments.length} />}
              </TabButton>
              {isPull && (
                <>
                  <TabButton active={tab === 'files'} onClick={() => setTab('files')} icon={<FileCode className="w-3.5 h-3.5" />}>
                    Files
                    <Count value={detail.files?.length || 0} />
                  </TabButton>
                  <TabButton active={tab === 'checks'} onClick={() => setTab('checks')} icon={<ShieldCheck className="w-3.5 h-3.5" />}>
                    Checks
                    {checksSummary.failed > 0 ? (
                      <span className="ml-1 px-1.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px]">{checksSummary.failed}</span>
                    ) : (
                      <Count value={detail.checks?.length || 0} />
                    )}
                  </TabButton>
                </>
              )}
              <TabButton active={tab === 'ai'} onClick={() => setTab('ai')} icon={<Sparkles className="w-3.5 h-3.5" />}>
                AI
              </TabButton>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
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

          {detail && tab === 'conversation' && (
            <div className="space-y-4">
              <ConversationEntry
                author={item.author}
                createdAt={item.createdAt}
                body={item.body || '_No description provided._'}
                highlight
              />

              {detail.reviews?.map((review: any) => (
                <ReviewEntry key={review.id} review={review} />
              ))}

              {detail.comments?.map((c: any) => (
                <ConversationEntry key={c.id} author={c.author} createdAt={c.createdAt} body={c.body} />
              ))}

              {detail.comments?.length === 0 && detail.reviews?.length === 0 && (
                <p className="text-center text-xs text-faint py-4">No comments yet.</p>
              )}
            </div>
          )}

          {detail && tab === 'files' && <DiffView files={detail.files || []} onQuoteLine={quoteLine} />}

          {detail && tab === 'checks' && (
            <div className="space-y-2">
              {(detail.checks || []).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-faint text-sm gap-2">
                  <ShieldCheck className="w-8 h-8 opacity-30" />
                  No checks have reported for this branch.
                </div>
              ) : (
                detail.checks.map((check: any) => {
                  const running = check.status !== 'completed';
                  const passed = ['success', 'neutral', 'skipped'].includes(check.conclusion);
                  const Icon = running ? Clock : passed ? CheckCircle2 : XCircle;
                  const color = running ? 'text-amber-400' : passed ? 'text-emerald-400' : 'text-rose-400';

                  return (
                    <a
                      key={check.name + check.startedAt}
                      href={check.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-xl border border-line bg-canvas/50 hover:bg-surface/60 transition-colors"
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${color} ${running ? 'animate-pulse' : ''}`} />
                      <span className="text-sm text-ink/85 flex-1 truncate">{check.name}</span>
                      <span className={`text-[11px] font-medium ${color}`}>{check.conclusion || check.status}</span>
                      <ExternalLink className="w-3 h-3 text-faint" />
                    </a>
                  );
                })
              )}
            </div>
          )}

          {detail && tab === 'ai' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <AiButton onClick={() => runAi('summary')} busy={aiBusy === 'summary'} icon={<Sparkles className="w-3.5 h-3.5" />}>
                  Explain this change
                </AiButton>
                {isPull && (
                  <>
                    <AiButton onClick={() => runAi('review')} busy={aiBusy === 'review'} icon={<ShieldCheck className="w-3.5 h-3.5" />}>
                      Review the diff
                    </AiButton>
                    <AiButton onClick={() => runAi('describe')} busy={aiBusy === 'describe'} icon={<Wand2 className="w-3.5 h-3.5" />}>
                      Draft description
                    </AiButton>
                  </>
                )}
              </div>

              {aiSummary && (
                <AiPanel title="What this change does" onShare={() => { queueComposerInsert(aiSummary); flash('Summary added to your message'); }}>
                  <Markdownish text={aiSummary} />
                </AiPanel>
              )}

              {aiDescription && (
                <AiPanel
                  title="Suggested pull request description"
                  onShare={() => { queueComposerInsert(aiDescription); flash('Description added to your message'); }}
                  action={
                    <button
                      onClick={async () => {
                        setAiBusy('apply');
                        try {
                          await githubService.aiDescribePullRequest(target.owner, target.repo, target.number, true);
                          await reload();
                          flash('Description applied to the pull request');
                        } catch (err: any) {
                          flash(err?.message || 'Could not apply description');
                        } finally {
                          setAiBusy(null);
                        }
                      }}
                      disabled={aiBusy === 'apply'}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
                    >
                      {aiBusy === 'apply' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Apply to PR
                    </button>
                  }
                >
                  <Markdownish text={aiDescription} />
                </AiPanel>
              )}

              {aiReview && (
                <AiPanel
                  title={`Review — ${aiReview.verdict.replace('_', ' ')}`}
                  action={
                    <button
                      onClick={postAiReviewToGitHub}
                      disabled={aiBusy === 'post'}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
                    >
                      {aiBusy === 'post' ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitHubMark className="w-3 h-3" />}
                      Post to GitHub
                    </button>
                  }
                >
                  <p className="text-xs text-ink/85 leading-relaxed">{aiReview.summary}</p>

                  {aiReview.findings?.length > 0 ? (
                    <div className="space-y-2 mt-3">
                      {aiReview.findings.map((finding: any, i: number) => {
                        const style = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.nit;
                        return (
                          <div key={i} className={`pl-3 border-l-2 ${style.border} py-1`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${style.badge}`}>
                                {finding.severity}
                              </span>
                              <span className="text-xs font-medium text-ink">{finding.title}</span>
                            </div>
                            <button
                              onClick={() => finding.line && quoteLine(finding.file, finding.line)}
                              className="mt-1 font-mono text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                            >
                              {finding.file}
                              {finding.line ? `:${finding.line}` : ''}
                            </button>
                            <p className="text-[11px] text-muted mt-1 leading-relaxed">{finding.detail}</p>
                            {finding.suggestion && (
                              <p className="text-[11px] text-emerald-400/80 mt-1 leading-relaxed">→ {finding.suggestion}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-emerald-400 mt-3">
                      <CheckCircle2 className="w-4 h-4" />
                      No defects found in the diff.
                    </p>
                  )}

                  {aiReview.testGaps?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-line">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle mb-1.5">Untested behaviour</div>
                      <ul className="space-y-1">
                        {aiReview.testGaps.map((gap: string, i: number) => (
                          <li key={i} className="text-[11px] text-muted flex gap-2">
                            <span className="text-faint">•</span>
                            {gap}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </AiPanel>
              )}

              {!aiSummary && !aiReview && !aiDescription && !aiBusy && (
                <div className="flex flex-col items-center justify-center py-12 text-faint text-sm gap-2 text-center">
                  <Sparkles className="w-8 h-8 opacity-30" />
                  <p>Ask the AI to read the actual diff.</p>
                  <p className="text-xs text-faint max-w-xs">
                    It reviews real code — not the description — and can post its findings back to GitHub.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action bar */}
        {detail && item?.state !== 'merged' && (
          <div className="border-t border-line/60 bg-canvas/50 p-4 space-y-3">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder={isPull ? 'Leave a review comment…' : 'Leave a comment…'}
              className="w-full px-3 py-2 bg-canvas border border-line rounded-xl text-sm text-ink placeholder-faint resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />

            <div className="flex items-center flex-wrap gap-2">
              <button
                onClick={handleComment}
                disabled={posting || !comment.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-raised hover:bg-hover disabled:opacity-40 text-ink text-xs font-medium transition-colors"
              >
                {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Comment
              </button>

              {isPull && item?.state === 'open' && (
                <>
                  <button
                    onClick={() => handleReview('APPROVE')}
                    disabled={posting}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleReview('REQUEST_CHANGES')}
                    disabled={posting}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-rose-300 text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Request changes
                  </button>

                  <div className="relative ml-auto">
                    <div className="flex">
                      <button
                        onClick={handleMerge}
                        disabled={merging || pr?.mergeable === false}
                        title={pr?.mergeable === false ? 'GitHub reports this branch has conflicts' : undefined}
                        className="flex items-center gap-1.5 pl-3 pr-2.5 py-2 rounded-l-xl bg-purple-600 hover:bg-purple-500 disabled:bg-raised disabled:text-faint text-white text-xs font-semibold transition-colors"
                      >
                        {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                        {mergeMethod === 'squash' ? 'Squash and merge' : mergeMethod === 'rebase' ? 'Rebase and merge' : 'Merge'}
                      </button>
                      <button
                        onClick={() => setShowMergeMenu(!showMergeMenu)}
                        disabled={merging || pr?.mergeable === false}
                        className="px-2 py-2 rounded-r-xl bg-purple-600 hover:bg-purple-500 disabled:bg-raised disabled:text-faint text-white border-l border-purple-500/40 transition-colors"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {showMergeMenu && (
                      <div className="absolute bottom-full right-0 mb-2 w-44 bg-surface border border-line rounded-xl shadow-2xl p-1 z-10">
                        {(['squash', 'merge', 'rebase'] as const).map((method) => (
                          <button
                            key={method}
                            onClick={() => {
                              setMergeMethod(method);
                              setShowMergeMenu(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                              mergeMethod === method ? 'bg-purple-600/20 text-purple-300' : 'text-ink/85 hover:bg-raised'
                            }`}
                          >
                            {method === 'squash' ? 'Squash and merge' : method === 'rebase' ? 'Rebase and merge' : 'Create a merge commit'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {!isPull && item?.state === 'open' && (
                <button
                  onClick={async () => {
                    setPosting(true);
                    try {
                      await githubService.setIssueState(target.owner, target.repo, target.number, 'closed');
                      await reload();
                      flash('Issue closed');
                    } catch (err: any) {
                      flash(err?.message || 'Could not close issue');
                    } finally {
                      setPosting(false);
                    }
                  }}
                  disabled={posting}
                  className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-600/15 hover:bg-purple-600/25 border border-purple-500/30 text-purple-300 text-xs font-medium transition-colors disabled:opacity-40"
                >
                  <CircleDot className="w-3.5 h-3.5" />
                  Close issue
                </button>
              )}
            </div>
          </div>
        )}

        {toast && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-raised border border-line-strong text-xs text-ink shadow-2xl animate-in fade-in slide-in-from-bottom-2">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

// --- small building blocks --------------------------------------------------

const TabButton = ({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
      active ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-subtle hover:text-ink/85'
    }`}
  >
    {icon}
    {children}
  </button>
);

const Count = ({ value }: { value: number }) => (
  <span className="ml-1 px-1.5 rounded-full bg-raised text-muted text-[10px]">{value}</span>
);

const AiButton = ({
  onClick,
  busy,
  icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    disabled={busy}
    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-indigo-500/15 to-purple-500/15 border border-indigo-500/30 hover:border-indigo-400/50 text-indigo-300 text-xs font-medium transition-colors disabled:opacity-50"
  >
    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
    {children}
  </button>
);

const AiPanel = ({
  title,
  children,
  action,
  onShare,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  onShare?: () => void;
}) => (
  <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/20 overflow-hidden">
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-500/20 bg-indigo-950/30">
      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300 flex-1">{title}</span>
      {onShare && (
        <button
          onClick={onShare}
          title="Add to your message"
          className="p-1 rounded-md text-indigo-400/70 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
        >
          <Share2 className="w-3.5 h-3.5" />
        </button>
      )}
      {action}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const ConversationEntry = ({
  author,
  createdAt,
  body,
  highlight,
}: {
  author: any;
  createdAt: string;
  body: string;
  highlight?: boolean;
}) => (
  <div className={`rounded-xl border p-4 ${highlight ? 'border-line-strong/60 bg-canvas/50' : 'border-line bg-canvas/30'}`}>
    <div className="flex items-center gap-2 mb-2.5">
      {author?.avatarUrl && <img src={author.avatarUrl} alt="" className="w-5 h-5 rounded-full bg-raised" />}
      <span className="text-xs font-medium text-ink/85">{author?.login}</span>
      <span className="text-[10px] text-faint">{new Date(createdAt).toLocaleString()}</span>
    </div>
    <Markdownish text={body} />
  </div>
);

const ReviewEntry = ({ review }: { review: any }) => {
  const approved = review.state === 'APPROVED';
  const changes = review.state === 'CHANGES_REQUESTED';
  const Icon = approved ? CheckCircle2 : changes ? AlertTriangle : MessageSquare;
  const color = approved ? 'text-emerald-400' : changes ? 'text-rose-400' : 'text-muted';

  return (
    <div className="rounded-xl border border-line bg-canvas/30 p-4">
      <div className="flex items-center gap-2 mb-2">
        {review.author?.avatarUrl && <img src={review.author.avatarUrl} alt="" className="w-5 h-5 rounded-full bg-raised" />}
        <span className="text-xs font-medium text-ink/85">{review.author?.login}</span>
        <span className={`flex items-center gap-1 text-[11px] font-medium ${color}`}>
          <Icon className="w-3 h-3" />
          {approved ? 'approved' : changes ? 'requested changes' : 'reviewed'}
        </span>
        <span className="text-[10px] text-faint ml-auto">{new Date(review.submittedAt).toLocaleString()}</span>
      </div>
      {review.body && <Markdownish text={review.body} />}
    </div>
  );
};

/** Lightweight markdown rendering — headings, bullets, bold, inline code, fences. */
export const Markdownish = ({ text }: { text: string }) => (
  <div className="text-xs text-ink/85 leading-relaxed space-y-1.5">
    {text.split('\n').map((line, i) => {
      if (!line.trim()) return <div key={i} className="h-1" />;

      if (line.startsWith('###') || line.startsWith('##')) {
        return (
          <div key={i} className="text-[11px] font-semibold uppercase tracking-wider text-muted pt-1">
            {line.replace(/^#+\s*/, '')}
          </div>
        );
      }

      const bulleted = /^[-*]\s+/.test(line.trim());
      const content = bulleted ? line.trim().replace(/^[-*]\s+/, '') : line;

      const rendered = content.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((chunk, j) => {
        if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
          return (
            <code key={j} className="px-1 py-0.5 rounded bg-surface border border-line text-indigo-400 font-mono text-[11px]">
              {chunk.slice(1, -1)}
            </code>
          );
        }
        if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4) {
          return (
            <strong key={j} className="font-semibold text-ink">
              {chunk.slice(2, -2)}
            </strong>
          );
        }
        return <React.Fragment key={j}>{chunk}</React.Fragment>;
      });

      return bulleted ? (
        <div key={i} className="flex gap-2 pl-1">
          <span className="text-faint shrink-0">•</span>
          <span>{rendered}</span>
        </div>
      ) : (
        <div key={i}>{rendered}</div>
      );
    })}
  </div>
);

/** Formats an AI review as the markdown body of a GitHub review. */
const formatReviewForGitHub = (review: any): string => {
  const lines = [`### Synq AI review`, '', review.summary, ''];

  if (review.findings?.length > 0) {
    lines.push('#### Findings', '');
    for (const f of review.findings) {
      lines.push(`- **[${f.severity}]** \`${f.file}${f.line ? `:${f.line}` : ''}\` — **${f.title}**`);
      lines.push(`  ${f.detail}`);
      if (f.suggestion) lines.push(`  _Suggestion:_ ${f.suggestion}`);
    }
    lines.push('');
  } else {
    lines.push('No defects found in the diff.', '');
  }

  if (review.testGaps?.length > 0) {
    lines.push('#### Untested behaviour', '');
    review.testGaps.forEach((gap: string) => lines.push(`- ${gap}`));
    lines.push('');
  }

  lines.push('---', '_Generated by Synq from the conversation. Verify before acting on it._');
  return lines.join('\n');
};
