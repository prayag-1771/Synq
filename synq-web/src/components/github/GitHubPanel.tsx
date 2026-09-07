'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  X,
  Loader2,
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  CircleDot,
  CheckCircle2,
  GitCommit,
  FolderClosed,
  FileCode,
  Activity,
  Sparkles,
  Plus,
  ChevronDown,
  ChevronRight,
  Link2,
  Unlink,
  Search,
  Share2,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Star,
  Send,
  ArrowLeft,
  XCircle,
} from 'lucide-react';
import { localDb } from '../../db/localDb';
import { githubService, GitHubNotConnectedError, LinkedRepo } from '../../services/githubService';
import { useGitHubStore } from '../../stores/githubStore';
import { GitHubMark } from './GitHubRefCard';
import { Markdownish } from './PullRequestModal';

type Tab = 'pulls' | 'issues' | 'code' | 'activity' | 'ask';

interface Props {
  chatId: string;
  onClose: () => void;
}

/**
 * The repository workspace that lives beside the conversation: open pull
 * requests, issues, the file tree, live CI activity, and a repo-aware AI — all
 * scoped to the repositories linked to this chat.
 */
export default function GitHubPanel({ chatId, onClose }: Props) {
  const {
    status,
    reposByChat,
    setRepos,
    activityByChat,
    setActivity,
    clearUnread,
    openConnectModal,
    openLinkRepoModal,
    openPullRequest,
    openCommit,
    openFileEditor,
    queueComposerInsert,
  } = useGitHubStore();

  const repos = reposByChat[chatId] || [];
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [showRepoMenu, setShowRepoMenu] = useState(false);
  const [tab, setTab] = useState<Tab>('pulls');
  const [toast, setToast] = useState<string | null>(null);

  const activeRepo: LinkedRepo | undefined = useMemo(
    () => repos.find((r) => r.repositoryId === activeRepoId) || repos.find((r) => r.isPrimary) || repos[0],
    [repos, activeRepoId]
  );

  useEffect(() => {
    clearUnread(chatId);
  }, [chatId, tab, clearUnread]);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const refreshRepos = async () => {
    try {
      const list = await githubService.listChatRepositories(chatId);
      setRepos(chatId, list);
    } catch (err) {
      if (err instanceof GitHubNotConnectedError) openConnectModal(true);
    }
  };

  // --- Not connected --------------------------------------------------------
  if (status && !status.connected) {
    return (
      <PanelShell onClose={onClose} title="GitHub">
        <EmptyState
          icon={<GitHubMark className="w-10 h-10" />}
          title="Connect GitHub"
          body="Turn #123, commit shas and file:line references in this conversation into live, clickable, actionable code."
          action={
            <button
              onClick={() => openConnectModal(true)}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              Connect account
            </button>
          }
        />
      </PanelShell>
    );
  }

  // --- Connected but no repository linked -----------------------------------
  if (repos.length === 0) {
    return (
      <PanelShell onClose={onClose} title="GitHub">
        <EmptyState
          icon={<Link2 className="w-10 h-10" />}
          title="Link a repository"
          body="Bind a repo to this conversation so #123 and src/file.ts:20-40 resolve, and pull requests, reviews and CI stream in here."
          action={
            <button
              onClick={() => openLinkRepoModal(true)}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              Link repository
            </button>
          }
        />
      </PanelShell>
    );
  }

  const owner = activeRepo!.owner;
  const repo = activeRepo!.name;

  return (
    <PanelShell
      onClose={onClose}
      title={
        <div className="relative flex-1 min-w-0">
          <button
            onClick={() => setShowRepoMenu(!showRepoMenu)}
            className="flex items-center gap-1.5 max-w-full group"
          >
            <span className="font-mono text-xs text-slate-200 truncate group-hover:text-white transition-colors">
              {activeRepo!.fullName}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
            {activeRepo!.webhookActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Live activity enabled" />
            )}
          </button>

          {showRepoMenu && (
            <div className="absolute top-full left-0 mt-1.5 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-1 z-30">
              {repos.map((r) => (
                <div key={r.repositoryId} className="flex items-center group">
                  <button
                    onClick={() => {
                      setActiveRepoId(r.repositoryId);
                      setShowRepoMenu(false);
                    }}
                    className={`flex-1 text-left px-3 py-2 rounded-lg text-[11px] font-mono truncate transition-colors ${
                      r.repositoryId === activeRepo!.repositoryId
                        ? 'bg-indigo-600/20 text-indigo-300'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {r.fullName}
                    {r.isPrimary && <span className="ml-1.5 text-[9px] text-slate-500">primary</span>}
                  </button>
                  <button
                    onClick={async () => {
                      await githubService.unlinkRepository(chatId, r.repositoryId);
                      await refreshRepos();
                      setShowRepoMenu(false);
                      flash(`Unlinked ${r.fullName}`);
                    }}
                    title="Unlink from this chat"
                    className="p-1.5 mr-1 rounded-md text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Unlink className="w-3 h-3" />
                  </button>
                </div>
              ))}

              <div className="border-t border-slate-800 mt-1 pt-1 space-y-0.5">
                {repos.length > 1 && activeRepo && !activeRepo.isPrimary && (
                  <button
                    onClick={async () => {
                      await githubService.setPrimaryRepository(chatId, activeRepo.repositoryId);
                      await refreshRepos();
                      setShowRepoMenu(false);
                      flash(`${activeRepo.fullName} is now the default for #references`);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                  >
                    <Star className="w-3 h-3" />
                    Make default for #refs
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowRepoMenu(false);
                    openLinkRepoModal(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Link another repository
                </button>
              </div>
            </div>
          )}
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex items-center border-b border-slate-800/60 px-2 shrink-0">
        {(
          [
            ['pulls', GitPullRequest, 'Pulls'],
            ['issues', CircleDot, 'Issues'],
            ['code', FolderClosed, 'Code'],
            ['activity', Activity, 'Activity'],
            ['ask', Sparkles, 'Ask'],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-2.5 py-2.5 text-[11px] font-medium border-b-2 transition-colors ${
              tab === key ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {tab === 'pulls' && (
          <PullsTab
            owner={owner}
            repo={repo}
            onOpen={(number) => openPullRequest({ owner, repo, number })}
            onShare={(number) => {
              queueComposerInsert(`${owner}/${repo}#${number}`);
              flash('Reference added to your message');
            }}
          />
        )}

        {tab === 'issues' && (
          <IssuesTab
            chatId={chatId}
            owner={owner}
            repo={repo}
            onOpen={(number) => openPullRequest({ owner, repo, number })}
            onShare={(number) => {
              queueComposerInsert(`${owner}/${repo}#${number}`);
              flash('Reference added to your message');
            }}
            flash={flash}
          />
        )}

        {tab === 'code' && (
          <CodeTab
            owner={owner}
            repo={repo}
            defaultBranch={activeRepo!.defaultBranch}
            onOpenFile={(path) => openFileEditor({ owner, repo, path })}
            onShare={(path) => {
              queueComposerInsert(path);
              flash('Reference added to your message');
            }}
            onOpenCommit={(sha) => openCommit({ owner, repo, sha })}
          />
        )}

        {tab === 'activity' && (
          <ActivityTab
            chatId={chatId}
            events={activityByChat[chatId] || []}
            setEvents={(events) => setActivity(chatId, events)}
            webhookActive={activeRepo!.webhookActive}
          />
        )}

        {tab === 'ask' && <AskTab owner={owner} repo={repo} onShare={(text) => { queueComposerInsert(text); flash('Answer added to your message'); }} />}
      </div>

      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-200 shadow-2xl whitespace-nowrap animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Shell & shared pieces
// ---------------------------------------------------------------------------

const PanelShell = ({
  title,
  children,
  onClose,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
}) => (
  <div className="w-[38%] min-w-[380px] flex flex-col bg-slate-900 border-l border-slate-800/60 z-20 shadow-2xl relative">
    <div className="h-[57px] flex items-center gap-2.5 px-4 border-b border-slate-800/60 shrink-0">
      <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-300 shrink-0">
        <GitHubMark className="w-3.5 h-3.5" />
      </div>
      {typeof title === 'string' ? <span className="text-sm font-semibold text-slate-100 flex-1">{title}</span> : title}
      <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
    {children}
  </div>
);

const EmptyState = ({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) => (
  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
    <div className="text-slate-700">{icon}</div>
    <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
    <p className="text-xs text-slate-500 max-w-[280px] leading-relaxed">{body}</p>
    {action && <div className="mt-1">{action}</div>}
  </div>
);

const Loading = () => (
  <div className="flex justify-center py-10">
    <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
  </div>
);

const ErrorNote = ({ message }: { message: string }) => (
  <div className="m-3 flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-300">
    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
    {message}
  </div>
);

/** Shared loader for the tabs that just fetch a list. */
const useRemoteList = <T,>(load: () => Promise<T>, deps: any[]): { data: T | null; loading: boolean; error: string | null; reload: () => void } => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const openConnectModal = useGitHubStore((s) => s.openConnectModal);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    load()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof GitHubNotConnectedError) openConnectModal(true);
        else setError(err?.message || 'Request failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
};

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

const PullsTab = ({
  owner,
  repo,
  onOpen,
  onShare,
}: {
  owner: string;
  repo: string;
  onOpen: (number: number) => void;
  onShare: (number: number) => void;
}) => {
  const [state, setState] = useState<'open' | 'all'>('open');
  const { data, loading, error, reload } = useRemoteList(
    () => githubService.listPullRequests(owner, repo, state),
    [owner, repo, state]
  );

  return (
    <div>
      <FilterBar
        options={[
          ['open', 'Open'],
          ['all', 'All'],
        ]}
        value={state}
        onChange={(v) => setState(v as 'open' | 'all')}
        onReload={reload}
      />

      {loading && <Loading />}
      {error && <ErrorNote message={error} />}

      {data && data.length === 0 && !loading && (
        <p className="text-center text-xs text-slate-600 py-10">No {state === 'open' ? 'open ' : ''}pull requests.</p>
      )}

      <div className="p-2 space-y-1">
        {(data || []).map((pull: any) => {
          const Icon =
            pull.state === 'merged'
              ? GitMerge
              : pull.state === 'closed'
              ? GitPullRequestClosed
              : pull.draft
              ? GitPullRequestDraft
              : GitPullRequest;
          const color =
            pull.state === 'merged'
              ? 'text-purple-400'
              : pull.state === 'closed'
              ? 'text-rose-400'
              : pull.draft
              ? 'text-slate-500'
              : 'text-emerald-400';

          return (
            <ListRow
              key={pull.number}
              icon={<Icon className={`w-4 h-4 ${color}`} />}
              title={pull.title}
              meta={
                <>
                  <span className="font-mono">#{pull.number}</span>
                  <span>{pull.author?.login}</span>
                  <span className="font-mono truncate">
                    {pull.head} → {pull.base}
                  </span>
                </>
              }
              labels={pull.labels}
              onOpen={() => onOpen(pull.number)}
              onShare={() => onShare(pull.number)}
              href={pull.htmlUrl}
            />
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const IssuesTab = ({
  chatId,
  owner,
  repo,
  onOpen,
  onShare,
  flash,
}: {
  chatId: string;
  owner: string;
  repo: string;
  onOpen: (number: number) => void;
  onShare: (number: number) => void;
  flash: (message: string) => void;
}) => {
  const [state, setState] = useState<'open' | 'all'>('open');
  const { data, loading, error, reload } = useRemoteList(
    () => githubService.listIssues(owner, repo, state),
    [owner, repo, state]
  );

  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<{ title: string; body: string; labels: string[] } | null>(null);
  const [creating, setCreating] = useState(false);

  const messages = useLiveQuery(
    () => localDb.messages.where('chatId').equals(chatId).sortBy('createdAt'),
    [chatId]
  ) || [];

  /**
   * Reads the recent conversation and drafts a real issue from it. This is the
   * "we discussed it, now make it real" step that usually gets lost in chat.
   */
  const draftFromConversation = async () => {
    const recent = messages.slice(-40).filter((m) => m.senderId !== 'SYSTEM_AI');
    if (recent.length === 0) {
      flash('There is nothing in this conversation yet');
      return;
    }

    setDrafting(true);
    try {
      const transcript = recent.map((m) => `${m.senderName}: ${m.content}`).join('\n');
      const result = await githubService.aiDraftIssue(owner, repo, transcript, false);
      setDraft(result.draft);
    } catch (err: any) {
      flash(err?.message || 'Could not draft an issue');
    } finally {
      setDrafting(false);
    }
  };

  const createDraft = async () => {
    if (!draft) return;
    setCreating(true);
    try {
      const issue = await githubService.createIssue(owner, repo, draft.title, draft.body, draft.labels);
      setDraft(null);
      reload();
      onShare(issue.number);
      flash(`Opened issue #${issue.number}`);
    } catch (err: any) {
      flash(err?.message || 'Could not create the issue');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <FilterBar
        options={[
          ['open', 'Open'],
          ['all', 'All'],
        ]}
        value={state}
        onChange={(v) => setState(v as 'open' | 'all')}
        onReload={reload}
        extra={
          <button
            onClick={draftFromConversation}
            disabled={drafting}
            title="Draft a GitHub issue from this conversation"
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gradient-to-r from-indigo-500/15 to-purple-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-medium transition-colors hover:border-indigo-400/50 disabled:opacity-50"
          >
            {drafting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            From chat
          </button>
        }
      />

      {draft && (
        <div className="m-2 rounded-xl border border-indigo-500/30 bg-indigo-950/20 overflow-hidden">
          <div className="px-3 py-2 border-b border-indigo-500/20 bg-indigo-950/30 flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300 flex-1">
              Drafted from this conversation
            </span>
            <button onClick={() => setDraft(null)} className="p-0.5 text-indigo-400/60 hover:text-indigo-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-3 space-y-2">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={7}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            {draft.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {draft.labels.map((label) => (
                  <span key={label} className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[9px]">
                    {label}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={createDraft}
              disabled={creating || !draft.title.trim()}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Open this issue on GitHub
            </button>
          </div>
        </div>
      )}

      {loading && <Loading />}
      {error && <ErrorNote message={error} />}

      {data && data.length === 0 && !loading && (
        <p className="text-center text-xs text-slate-600 py-10">No {state === 'open' ? 'open ' : ''}issues.</p>
      )}

      <div className="p-2 space-y-1">
        {(data || []).map((issue: any) => (
          <ListRow
            key={issue.number}
            icon={
              issue.state === 'closed' ? (
                <CheckCircle2 className="w-4 h-4 text-purple-400" />
              ) : (
                <CircleDot className="w-4 h-4 text-emerald-400" />
              )
            }
            title={issue.title}
            meta={
              <>
                <span className="font-mono">#{issue.number}</span>
                <span>{issue.author?.login}</span>
                {issue.comments > 0 && <span>{issue.comments} comments</span>}
              </>
            }
            labels={issue.labels}
            onOpen={() => onOpen(issue.number)}
            onShare={() => onShare(issue.number)}
            href={issue.htmlUrl}
          />
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Code browser
// ---------------------------------------------------------------------------

const CodeTab = ({
  owner,
  repo,
  defaultBranch,
  onOpenFile,
  onShare,
  onOpenCommit,
}: {
  owner: string;
  repo: string;
  defaultBranch: string;
  onOpenFile: (path: string) => void;
  onShare: (path: string) => void;
  onOpenCommit: (sha: string) => void;
}) => {
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showCommits, setShowCommits] = useState(false);

  const tree = useRemoteList(() => githubService.browseTree(owner, repo, path, defaultBranch), [owner, repo, path]);
  const commits = useRemoteList(
    () => (showCommits ? githubService.listCommits(owner, repo) : Promise.resolve([])),
    [owner, repo, showCommits]
  );

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const results = await githubService.searchCode(owner, repo, query.trim());
      setSearchResults(results.results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const segments = path ? path.split('/') : [];

  return (
    <div>
      <div className="p-2 border-b border-slate-800/60 space-y-2">
        <form onSubmit={runSearch} className="relative flex items-center">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-slate-500" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) setSearchResults(null);
            }}
            placeholder="Search code in this repository…"
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
          {searching && <Loader2 className="absolute right-2.5 w-3.5 h-3.5 animate-spin text-indigo-400" />}
        </form>

        <div className="flex items-center gap-1 text-[10px] font-mono">
          <button
            onClick={() => {
              setPath('');
              setShowCommits(false);
            }}
            className="text-slate-400 hover:text-indigo-300 transition-colors"
          >
            {repo}
          </button>
          {segments.map((segment, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="w-2.5 h-2.5 text-slate-700" />
              <button
                onClick={() => setPath(segments.slice(0, i + 1).join('/'))}
                className="text-slate-400 hover:text-indigo-300 transition-colors truncate"
              >
                {segment}
              </button>
            </React.Fragment>
          ))}

          <button
            onClick={() => setShowCommits(!showCommits)}
            className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
              showCommits ? 'text-indigo-300 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <GitCommit className="w-3 h-3" />
            Commits
          </button>
        </div>
      </div>

      {showCommits ? (
        <div className="p-2 space-y-1">
          {commits.loading && <Loading />}
          {(commits.data || []).map((commit: any) => (
            <button
              key={commit.sha}
              onClick={() => onOpenCommit(commit.sha)}
              className="w-full text-left p-2.5 rounded-lg border border-transparent hover:border-slate-800 hover:bg-slate-800/40 transition-colors group"
            >
              <div className="flex items-start gap-2">
                <GitCommit className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-200 truncate group-hover:text-white">{commit.message}</div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                    <span className="font-mono px-1 rounded bg-slate-800">{commit.sha.slice(0, 7)}</span>
                    <span>{commit.author?.login}</span>
                    <span>{new Date(commit.date).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : searchResults ? (
        <div className="p-2 space-y-1">
          {searchResults.length === 0 ? (
            <p className="text-center text-xs text-slate-600 py-10">No matches.</p>
          ) : (
            searchResults.map((result: any) => (
              <FileRow key={result.path} name={result.path} onOpen={() => onOpenFile(result.path)} onShare={() => onShare(result.path)} />
            ))
          )}
        </div>
      ) : (
        <div className="p-2 space-y-0.5">
          {tree.loading && <Loading />}
          {tree.error && <ErrorNote message={tree.error} />}

          {path && (
            <button
              onClick={() => setPath(segments.slice(0, -1).join('/'))}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              ..
            </button>
          )}

          {(tree.data?.entries || []).map((entry: any) =>
            entry.type === 'dir' ? (
              <button
                key={entry.path}
                onClick={() => setPath(entry.path)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-slate-300 hover:bg-slate-800/40 transition-colors"
              >
                <FolderClosed className="w-3.5 h-3.5 text-indigo-400/70 shrink-0" />
                <span className="truncate font-mono">{entry.name}</span>
              </button>
            ) : (
              <FileRow
                key={entry.path}
                name={entry.name}
                onOpen={() => onOpenFile(entry.path)}
                onShare={() => onShare(entry.path)}
              />
            )
          )}
        </div>
      )}
    </div>
  );
};

const FileRow = ({ name, onOpen, onShare }: { name: string; onOpen: () => void; onShare: () => void }) => (
  <div className="flex items-center group rounded-lg hover:bg-slate-800/40 transition-colors">
    <button onClick={onOpen} className="flex-1 flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-slate-300 min-w-0">
      <FileCode className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <span className="truncate font-mono text-left">{name}</span>
    </button>
    <button
      onClick={onShare}
      title="Reference this file in your message"
      className="p-1.5 mr-1 rounded-md text-slate-600 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
    >
      <Share2 className="w-3 h-3" />
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const ActivityTab = ({
  chatId,
  events,
  setEvents,
  webhookActive,
}: {
  chatId: string;
  events: any[];
  setEvents: (events: any[]) => void;
  webhookActive: boolean;
}) => {
  const [loading, setLoading] = useState(events.length === 0);

  useEffect(() => {
    let cancelled = false;
    githubService
      .getChatActivity(chatId)
      .then((fetched) => {
        if (!cancelled) setEvents(fetched.map((e: any) => ({ ...e, chatId })));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const toneColor: Record<string, string> = {
    open: 'text-emerald-400',
    merged: 'text-purple-400',
    closed: 'text-rose-400',
    success: 'text-emerald-400',
    failure: 'text-rose-400',
    draft: 'text-slate-500',
    neutral: 'text-slate-400',
  };

  if (loading) return <Loading />;

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="w-9 h-9" />}
        title={webhookActive ? 'Nothing yet' : 'Live activity is off'}
        body={
          webhookActive
            ? 'Pull requests, pushes, reviews and CI results will appear here as they happen.'
            : 'Re-link this repository with the webhook option enabled to stream repository events into this conversation.'
        }
      />
    );
  }

  return (
    <div className="p-2 space-y-1">
      {events.map((event, i) => (
        <a
          key={event.id || `${event.createdAt}-${i}`}
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block p-2.5 rounded-lg border border-transparent hover:border-slate-800 hover:bg-slate-800/40 transition-colors"
        >
          <div className="flex items-start gap-2.5">
            {event.actorAvatar ? (
              <img src={event.actorAvatar} alt="" className="w-5 h-5 rounded-full bg-slate-800 shrink-0 mt-0.5" />
            ) : (
              <div className="w-5 h-5 rounded-full bg-slate-800 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-300 leading-snug">
                <span className="font-medium text-slate-200">{event.actorLogin || 'someone'}</span>{' '}
                <span className={toneColor[event.tone] || 'text-slate-400'}>{event.summary}</span>
              </div>
              {event.title && <div className="text-[11px] text-slate-500 truncate mt-0.5">{event.title}</div>}
              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                <span className="font-mono">{event.repoFullName}</span>
                <span>{new Date(event.createdAt).toLocaleString()}</span>
              </div>
            </div>
            <ExternalLink className="w-3 h-3 text-slate-700 shrink-0 mt-1" />
          </div>
        </a>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Ask the repository
// ---------------------------------------------------------------------------

const AskTab = ({ owner, repo, onShare }: { owner: string; repo: string; onShare: (text: string) => void }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; sources: { path: string; url: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openFileEditor = useGitHubStore((s) => s.openFileEditor);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await githubService.aiAskRepo(owner, repo, question.trim()));
    } catch (err: any) {
      setError(err?.message || 'Could not answer that question');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <form onSubmit={ask} className="space-y-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(e as any);
            }
          }}
          rows={3}
          placeholder="Ask about this codebase — “where do we verify the webhook signature?”, “what happens when Redis is down?”"
          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Ask the repository
        </button>
      </form>

      {error && <ErrorNote message={error} />}

      {answer && (
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/20 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-indigo-500/20 bg-indigo-950/30">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300 flex-1">Answer</span>
            <button
              onClick={() => onShare(answer.answer)}
              title="Add to your message"
              className="p-1 rounded-md text-indigo-400/70 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
            >
              <Share2 className="w-3 h-3" />
            </button>
          </div>

          <div className="p-3">
            <Markdownish text={answer.answer} />

            {answer.sources.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-800/60">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Read from
                </div>
                <div className="space-y-0.5">
                  {answer.sources.map((source) => (
                    <button
                      key={source.path}
                      onClick={() => openFileEditor({ owner, repo, path: source.path })}
                      className="flex items-center gap-1.5 text-[10px] font-mono text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      <FileCode className="w-3 h-3" />
                      {source.path}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!answer && !busy && !error && (
        <p className="text-[11px] text-slate-600 leading-relaxed pt-2">
          Answers are grounded in the repository&apos;s real files — the model searches the code, reads what it finds, and
          cites the paths it used.
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared list primitives
// ---------------------------------------------------------------------------

const FilterBar = ({
  options,
  value,
  onChange,
  onReload,
  extra,
}: {
  options: [string, string][];
  value: string;
  onChange: (value: string) => void;
  onReload: () => void;
  extra?: React.ReactNode;
}) => (
  <div className="flex items-center gap-1.5 p-2 border-b border-slate-800/60">
    {options.map(([key, label]) => (
      <button
        key={key}
        onClick={() => onChange(key)}
        className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
          value === key ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300'
        }`}
      >
        {label}
      </button>
    ))}
    {extra}
    <button
      onClick={onReload}
      className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
      title="Refresh"
    >
      <RefreshCw className="w-3 h-3" />
    </button>
  </div>
);

const ListRow = ({
  icon,
  title,
  meta,
  labels,
  onOpen,
  onShare,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  meta: React.ReactNode;
  labels?: { name: string; color: string }[];
  onOpen: () => void;
  onShare: () => void;
  href: string;
}) => (
  <div className="group rounded-lg border border-transparent hover:border-slate-800 hover:bg-slate-800/30 transition-colors">
    <div className="flex items-start gap-2.5 p-2.5">
      <div className="shrink-0 mt-0.5">{icon}</div>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className="text-[11px] font-medium text-slate-200 group-hover:text-white leading-snug line-clamp-2">
          {title}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 truncate">{meta}</div>

        {labels && labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {labels.slice(0, 3).map((label) => (
              <span
                key={label.name}
                className="px-1.5 py-0.5 rounded-full text-[9px] font-medium border"
                style={{ color: `#${label.color}`, borderColor: `#${label.color}55`, backgroundColor: `#${label.color}18` }}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}
      </button>

      <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onShare}
          title="Reference in your message"
          className="p-1 rounded-md text-slate-600 hover:text-indigo-400 transition-colors"
        >
          <Share2 className="w-3 h-3" />
        </button>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded-md text-slate-600 hover:text-slate-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  </div>
);
