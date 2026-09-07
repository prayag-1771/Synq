'use client';

import React from 'react';
import {
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  GitMerge,
  GitCommit,
  GitBranch,
  GitCompare,
  CircleDot,
  CheckCircle2,
  XCircle,
  FileCode,
  PlayCircle,
  ExternalLink,
  AlertCircle,
  Plus,
  Minus,
  MessageSquare,
  Pencil,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { ResolvedRefCard } from '../../services/githubService';
import { useGitHubStore } from '../../stores/githubStore';

/** GitHub's mark, inlined — lucide dropped brand icons. */
export const GitHubMark = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

type Tone = NonNullable<ResolvedRefCard['tone']>;

const TONE_STYLES: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  open: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500' },
  merged: { text: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', dot: 'bg-purple-500' },
  closed: { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30', dot: 'bg-rose-500' },
  draft: { text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-600/40', dot: 'bg-slate-500' },
  success: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500' },
  failure: { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30', dot: 'bg-rose-500' },
  neutral: { text: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-700/60', dot: 'bg-slate-500' },
};

const toneOf = (card?: ResolvedRefCard): Tone => card?.tone || 'neutral';

export const RefIcon = ({ card, className = 'w-4 h-4' }: { card: ResolvedRefCard; className?: string }) => {
  if (card.kind === 'pull') {
    if (card.merged) return <GitMerge className={className} />;
    if (card.state === 'closed') return <GitPullRequestClosed className={className} />;
    if (card.tone === 'draft') return <GitPullRequestDraft className={className} />;
    return <GitPullRequest className={className} />;
  }
  switch (card.kind) {
    case 'issue':
      return card.state === 'closed' ? <CheckCircle2 className={className} /> : <CircleDot className={className} />;
    case 'commit':
      return <GitCommit className={className} />;
    case 'file':
      return <FileCode className={className} />;
    case 'compare':
      return <GitCompare className={className} />;
    case 'branch':
      return <GitBranch className={className} />;
    case 'run':
      return card.tone === 'failure' ? <XCircle className={className} /> : <PlayCircle className={className} />;
    default:
      return <GitHubMark className={className} />;
  }
};

/** Opens the right surface for a reference: PR modal, commit view, or editor. */
export const useOpenRef = () => {
  const { openPullRequest, openCommit, openFileEditor } = useGitHubStore();

  return (card: ResolvedRefCard) => {
    if (card.error) {
      window.open(card.url, '_blank', 'noopener');
      return;
    }
    if ((card.kind === 'pull' || card.kind === 'issue') && card.number) {
      openPullRequest({ owner: card.owner, repo: card.repo, number: card.number });
    } else if (card.kind === 'commit' && card.sha) {
      openCommit({ owner: card.owner, repo: card.repo, sha: card.sha });
    } else if (card.kind === 'file' && card.path) {
      openFileEditor({ owner: card.owner, repo: card.repo, path: card.path });
    } else {
      window.open(card.url, '_blank', 'noopener');
    }
  };
};

// ---------------------------------------------------------------------------
// Inline chip — what a reference looks like inside a sentence
// ---------------------------------------------------------------------------

interface ChipProps {
  raw: string;
  card?: ResolvedRefCard;
  loading?: boolean;
}

export const RefChip = ({ raw, card, loading }: ChipProps) => {
  const openRef = useOpenRef();

  if (loading || !card) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-slate-800/60 border border-slate-700/50 text-slate-400 font-mono text-[11px] align-baseline">
        <Loader2 className="w-3 h-3 animate-spin" />
        {raw}
      </span>
    );
  }

  if (card.error) {
    return (
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        title={card.error}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-slate-200 font-mono text-[11px] align-baseline"
      >
        <AlertCircle className="w-3 h-3" />
        {raw}
      </a>
    );
  }

  const tone = TONE_STYLES[toneOf(card)];
  const label =
    card.kind === 'pull' || card.kind === 'issue'
      ? `#${card.number}`
      : card.kind === 'commit'
      ? card.sha?.slice(0, 7)
      : card.kind === 'file'
      ? `${card.path?.split('/').pop()}${card.startLine ? `:${card.startLine}` : ''}`
      : raw;

  return (
    <button
      type="button"
      onClick={() => openRef(card)}
      title={`${card.title}${card.state ? ` — ${card.state}` : ''}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md border ${tone.bg} ${tone.border} ${tone.text} hover:brightness-125 font-mono text-[11px] font-medium align-baseline transition-all cursor-pointer`}
    >
      <RefIcon card={card} className="w-3 h-3" />
      {label}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Unfurl card — the full reference preview under a message
// ---------------------------------------------------------------------------

const StateBadge = ({ card }: { card: ResolvedRefCard }) => {
  const tone = TONE_STYLES[toneOf(card)];
  const label = card.merged ? 'merged' : card.state || (card.tone === 'draft' ? 'draft' : null);
  if (!label) return null;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${tone.bg} ${tone.text} border ${tone.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
      {label}
    </span>
  );
};

const ChecksBadge = ({ checks }: { checks: NonNullable<ResolvedRefCard['checks']> }) => {
  const failed = checks.failed > 0;
  const pending = checks.pending > 0;
  const style = failed ? TONE_STYLES.failure : pending ? TONE_STYLES.neutral : TONE_STYLES.success;
  const Icon = failed ? XCircle : pending ? Loader2 : CheckCircle2;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${style.bg} ${style.text} border ${style.border}`}>
      <Icon className={`w-3 h-3 ${pending && !failed ? 'animate-spin' : ''}`} />
      {failed ? `${checks.failed} failing` : pending ? `${checks.pending} running` : `${checks.passed} checks passed`}
    </span>
  );
};

const CodeSnippet = ({ card }: { card: ResolvedRefCard }) => {
  if (!card.snippet || card.snippet.length === 0) return null;
  const gutterWidth = String(card.snippet[card.snippet.length - 1].line).length;

  return (
    <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
      <div className="max-h-64 overflow-auto custom-scrollbar">
        <pre className="text-[11px] leading-relaxed font-mono">
          {card.snippet.map((row) => (
            <div key={row.line} className="flex hover:bg-slate-900/60">
              <span
                className="shrink-0 select-none px-2 py-px text-right text-slate-600 border-r border-slate-800/80 bg-slate-900/40"
                style={{ minWidth: `${gutterWidth + 2}ch` }}
              >
                {row.line}
              </span>
              <code className="px-3 py-px text-slate-300 whitespace-pre">{row.text || ' '}</code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
};

interface RefCardProps {
  card: ResolvedRefCard;
  compact?: boolean;
}

export const RefCard = ({ card, compact = false }: RefCardProps) => {
  const openRef = useOpenRef();
  const { openFileEditor, openPullRequest, openCommit } = useGitHubStore();
  const tone = TONE_STYLES[toneOf(card)];

  if (card.error) {
    return (
      <div className="mt-2 rounded-xl border border-slate-800/80 bg-slate-900/40 px-3 py-2.5 flex items-center gap-2.5">
        <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-400 truncate">{card.title}</div>
          <div className="text-[10px] text-slate-600">{card.error}</div>
        </div>
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  return (
    <div className={`mt-2 rounded-xl border ${tone.border} bg-slate-900/60 backdrop-blur-sm overflow-hidden hover:bg-slate-900/80 transition-colors`}>
      <div className="px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <div className={`mt-0.5 shrink-0 ${tone.text}`}>
            <RefIcon card={card} className="w-4 h-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => openRef(card)}
                className="text-left text-sm font-semibold text-slate-100 hover:text-indigo-300 leading-snug transition-colors"
              >
                {card.title}
              </button>
              <a
                href={card.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                title="Open on GitHub"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1.5">
              <StateBadge card={card} />
              {card.subtitle && <span className="text-[11px] text-slate-500 font-mono truncate">{card.subtitle}</span>}
            </div>

            {card.branch?.head && (
              <div className="flex items-center gap-1.5 mt-2 text-[11px] font-mono text-slate-400">
                <GitBranch className="w-3 h-3 text-slate-500" />
                <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300">{card.branch.head}</span>
                <span className="text-slate-600">→</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300">{card.branch.base}</span>
              </div>
            )}

            {!compact && card.body && card.kind !== 'file' && (
              <p className="mt-2 text-[11px] text-slate-400 leading-relaxed line-clamp-2">{card.body}</p>
            )}

            {card.kind === 'file' && <CodeSnippet card={card} />}

            <div className="flex items-center flex-wrap gap-2 mt-2.5">
              {card.author?.login && (
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  {card.author.avatarUrl && (
                    <img src={card.author.avatarUrl} alt="" className="w-4 h-4 rounded-full bg-slate-800" />
                  )}
                  {card.author.login}
                </span>
              )}

              {(card.stats?.additions !== undefined || card.stats?.deletions !== undefined) && (
                <span className="flex items-center gap-1.5 text-[11px] font-mono">
                  {card.stats.additions !== undefined && (
                    <span className="text-emerald-400 flex items-center gap-0.5">
                      <Plus className="w-3 h-3" />
                      {card.stats.additions}
                    </span>
                  )}
                  {card.stats.deletions !== undefined && (
                    <span className="text-rose-400 flex items-center gap-0.5">
                      <Minus className="w-3 h-3" />
                      {card.stats.deletions}
                    </span>
                  )}
                  {card.stats.changedFiles !== undefined && (
                    <span className="text-slate-500">{card.stats.changedFiles} files</span>
                  )}
                </span>
              )}

              {card.stats?.comments ? (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <MessageSquare className="w-3 h-3" />
                  {card.stats.comments}
                </span>
              ) : null}

              {card.checks && <ChecksBadge checks={card.checks} />}
            </div>

            {card.labels && card.labels.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {card.labels.slice(0, 4).map((label) => (
                  <span
                    key={label.name}
                    className="px-1.5 py-0.5 rounded-full text-[9px] font-medium border"
                    style={{
                      color: `#${label.color}`,
                      borderColor: `#${label.color}55`,
                      backgroundColor: `#${label.color}18`,
                    }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Act on the reference without leaving the conversation. */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-t border-slate-800/60 bg-slate-950/40">
        {(card.kind === 'pull' || card.kind === 'issue') && card.number && (
          <>
            <CardAction
              icon={<GitPullRequest className="w-3 h-3" />}
              label={card.kind === 'pull' ? 'Open pull request' : 'Open issue'}
              onClick={() => openPullRequest({ owner: card.owner, repo: card.repo, number: card.number! })}
            />
            {card.kind === 'pull' && (
              <CardAction
                icon={<Sparkles className="w-3 h-3" />}
                label="AI review"
                onClick={() =>
                  openPullRequest({ owner: card.owner, repo: card.repo, number: card.number! })
                }
              />
            )}
          </>
        )}

        {card.kind === 'commit' && card.sha && (
          <CardAction
            icon={<Sparkles className="w-3 h-3" />}
            label="Explain this commit"
            onClick={() => openCommit({ owner: card.owner, repo: card.repo, sha: card.sha! })}
          />
        )}

        {card.kind === 'file' && card.path && (
          <CardAction
            icon={<Pencil className="w-3 h-3" />}
            label="Open & edit"
            onClick={() => openFileEditor({ owner: card.owner, repo: card.repo, path: card.path! })}
          />
        )}

        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors"
        >
          <GitHubMark className="w-3 h-3" />
          GitHub
        </a>
      </div>
    </div>
  );
};

const CardAction = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
  >
    {icon}
    {label}
  </button>
);

export default RefCard;
