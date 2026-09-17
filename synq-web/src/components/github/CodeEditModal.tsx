'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Loader2,
  FileCode,
  GitBranch,
  Sparkles,
  Save,
  GitPullRequestCreate,
  ExternalLink,
  AlertTriangle,
  Check,
  Undo2,
  MessageSquareQuote,
  Wand2,
  ChevronDown,
} from 'lucide-react';
import { githubService, GitHubNotConnectedError } from '../../services/githubService';
import { useGitHubStore } from '../../stores/githubStore';

/**
 * Opens a repository file, lets a developer edit it (by hand or by telling the
 * AI what to change), and commits the result — either straight to a branch or,
 * by default, as a new branch with a pull request opened for review.
 */
export default function CodeEditModal() {
  const { fileEditorTarget, openFileEditor, queueComposerInsert, openConnectModal, openPullRequest } = useGitHubStore();

  const [original, setOriginal] = useState('');
  const [content, setContent] = useState('');
  const [fileSha, setFileSha] = useState<string | undefined>();
  const [htmlUrl, setHtmlUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [branches, setBranches] = useState<any[]>([]);
  const [branch, setBranch] = useState<string>('');
  const [showBranchMenu, setShowBranchMenu] = useState(false);

  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<{ content: string; explanation: string } | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const [commitMessage, setCommitMessage] = useState('');
  const [openPr, setOpenPr] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const target = fileEditorTarget;

  useEffect(() => {
    if (!target) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setProposal(null);
    setCommitMessage('');
    setInstruction(target.instruction || '');

    Promise.all([
      githubService.getFile(target.owner, target.repo, target.path, target.ref),
      githubService.listBranches(target.owner, target.repo).catch(() => []),
    ])
      .then(([file, branchList]) => {
        setOriginal(file.text);
        setContent(file.text);
        setFileSha(file.sha);
        setHtmlUrl(file.htmlUrl);
        setBranches(branchList);
        setBranch(target.ref || branchList.find((b: any) => ['main', 'master'].includes(b.name))?.name || branchList[0]?.name || '');
      })
      .catch((err) => {
        if (err instanceof GitHubNotConnectedError) {
          openFileEditor(null);
          openConnectModal(true);
        } else {
          setError(err?.message || 'Could not open this file');
        }
      })
      .finally(() => setLoading(false));
  }, [target?.owner, target?.repo, target?.path, target?.ref]);

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const isDirty = content !== original;

  if (!target) return null;

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const syncGutter = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  /** Turns the current textarea selection into a `path:start-end` chat reference. */
  const quoteSelection = () => {
    const el = textareaRef.current;
    if (!el) return;

    const before = content.slice(0, el.selectionStart);
    const startLine = before.split('\n').length;
    const selected = content.slice(el.selectionStart, el.selectionEnd);
    const endLine = startLine + Math.max(0, selected.split('\n').length - 1);

    const ref = endLine > startLine ? `${target.path}:${startLine}-${endLine}` : `${target.path}:${startLine}`;
    queueComposerInsert(ref);
    flash(`Added ${ref} to your message`);
  };

  const askAi = async () => {
    if (!instruction.trim()) return;
    setAiBusy('propose');
    try {
      const proposed = await githubService.aiProposeEdit(
        target.owner,
        target.repo,
        target.path,
        instruction.trim(),
        branch || undefined
      );
      setProposal({ content: proposed.proposed, explanation: proposed.explanation });
    } catch (err: any) {
      flash(err?.message || 'AI could not produce an edit');
    } finally {
      setAiBusy(null);
    }
  };

  const generateMessage = async () => {
    setAiBusy('message');
    try {
      const message = await githubService.aiCommitMessage(target.owner, target.repo, target.path, original, content);
      setCommitMessage(message);
    } catch (err: any) {
      flash(err?.message || 'Could not generate a commit message');
    } finally {
      setAiBusy(null);
    }
  };

  const commit = async () => {
    if (!commitMessage.trim()) {
      flash('A commit message is required');
      return;
    }
    setCommitting(true);
    try {
      const outcome = await githubService.commitFile(target.owner, target.repo, {
        path: target.path,
        content,
        message: commitMessage.trim(),
        sha: fileSha,
        branch: branch || undefined,
        openPullRequest: openPr,
      });
      setResult(outcome);
      setOriginal(content);
      flash(outcome.pullRequest ? `Pull request #${outcome.pullRequest.number} opened` : 'Committed');
    } catch (err: any) {
      flash(err?.message || 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-sm">
      <div className="bg-surface border border-line rounded-2xl w-full max-w-5xl h-[90vh] shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-line/60 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-raised border border-line-strong/60 flex items-center justify-center text-ink/85 shrink-0">
            <FileCode className="w-4 h-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs text-ink truncate">{target.path}</div>
            <div className="font-mono text-[10px] text-subtle truncate">
              {target.owner}/{target.repo}
              {isDirty && <span className="ml-2 text-amber-400">• unsaved changes</span>}
            </div>
          </div>

          {/* Branch selector */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowBranchMenu(!showBranchMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-raised hover:bg-hover border border-line-strong/60 text-[11px] font-mono text-ink/85 transition-colors"
            >
              <GitBranch className="w-3 h-3 text-subtle" />
              {branch || 'branch'}
              <ChevronDown className="w-3 h-3 text-subtle" />
            </button>

            {showBranchMenu && (
              <div className="absolute top-full right-0 mt-1 w-56 max-h-64 overflow-y-auto bg-surface border border-line rounded-xl shadow-2xl p-1 z-20 custom-scrollbar">
                {branches.map((b) => (
                  <button
                    key={b.name}
                    onClick={() => {
                      setShowBranchMenu(false);
                      openFileEditor({ ...target, ref: b.name });
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-mono transition-colors ${
                      b.name === branch ? 'bg-indigo-600/20 text-indigo-300' : 'text-ink/85 hover:bg-raised'
                    }`}
                  >
                    {b.name}
                    {b.protected && <span className="ml-1.5 text-[9px] text-amber-500/70">protected</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={quoteSelection}
            title="Quote the selected lines in your message"
            className="p-2 rounded-xl text-muted hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors shrink-0"
          >
            <MessageSquareQuote className="w-4 h-4" />
          </button>
          {htmlUrl && (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl text-muted hover:text-ink hover:bg-raised transition-colors shrink-0"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button
            onClick={() => openFileEditor(null)}
            className="p-2 rounded-xl text-muted hover:text-ink hover:bg-raised transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* AI instruction bar */}
        <div className="px-5 py-3 border-b border-line/60 bg-indigo-950/10">
          <div className="flex gap-2">
            <div className="flex-1 relative flex items-center">
              <Sparkles className="absolute left-3 w-3.5 h-3.5 text-indigo-400" />
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') askAi();
                }}
                placeholder="Describe the change — e.g. “add a 5s timeout to the fetch call and log failures”"
                className="w-full pl-9 pr-3 py-2 bg-canvas border border-line rounded-lg text-xs text-ink placeholder-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
            <button
              onClick={askAi}
              disabled={aiBusy === 'propose' || !instruction.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 hover:border-indigo-400/50 text-indigo-300 text-xs font-medium transition-colors disabled:opacity-40"
            >
              {aiBusy === 'propose' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              Propose edit
            </button>
          </div>

          {proposal && (
            <div className="mt-3 p-3 rounded-lg border border-indigo-500/30 bg-indigo-950/30">
              <div className="flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                <p className="flex-1 text-[11px] text-ink/85 leading-relaxed">{proposal.explanation}</p>
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  onClick={() => {
                    setContent(proposal.content);
                    setProposal(null);
                    flash('Applied to the editor — review before committing');
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors"
                >
                  <Check className="w-3 h-3" />
                  Apply to editor
                </button>
                <button
                  onClick={() => setProposal(null)}
                  className="px-2.5 py-1 rounded-lg text-muted hover:text-ink hover:bg-raised text-[11px] transition-colors"
                >
                  Discard
                </button>
                <span className="text-[10px] text-faint ml-auto">Nothing is committed until you say so.</span>
              </div>
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0 relative bg-canvas">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
            </div>
          ) : error ? (
            <div className="p-5">
              <div className="flex items-start gap-2 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {error}
              </div>
            </div>
          ) : (
            <div className="h-full flex font-mono text-[12px] leading-[1.6]">
              <div
                ref={gutterRef}
                className="shrink-0 overflow-hidden bg-surface/40 border-r border-line py-3 text-right select-none"
                style={{ width: `${String(lineCount).length + 3}ch` }}
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className="px-2 text-faint">
                    {i + 1}
                  </div>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onScroll={syncGutter}
                spellCheck={false}
                className="flex-1 px-3 py-3 bg-transparent text-ink/85 resize-none focus:outline-none leading-[1.6] whitespace-pre"
                style={{ tabSize: 2 }}
              />
            </div>
          )}
        </div>

        {/* Commit bar */}
        {!loading && !error && (
          <div className="border-t border-line/60 bg-canvas/60 p-4 space-y-3">
            {result ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0 text-xs text-emerald-200">
                  {result.pullRequest ? (
                    <>
                      Opened pull request <span className="font-semibold">#{result.pullRequest.number}</span> from{' '}
                      <span className="font-mono">{result.branch}</span>
                    </>
                  ) : (
                    <>
                      Committed <span className="font-mono">{result.commit?.sha?.slice(0, 7)}</span> to{' '}
                      <span className="font-mono">{result.branch}</span>
                    </>
                  )}
                </div>
                {result.pullRequest && (
                  <button
                    onClick={() => {
                      queueComposerInsert(`${target.owner}/${target.repo}#${result.pullRequest.number}`);
                      openFileEditor(null);
                      openPullRequest({ owner: target.owner, repo: target.repo, number: result.pullRequest.number });
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium transition-colors shrink-0"
                  >
                    Open & share
                  </button>
                )}
                <a
                  href={result.pullRequest?.htmlUrl || result.commit?.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-emerald-400/70 hover:text-emerald-300 transition-colors shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message…"
                    className="flex-1 px-3 py-2 bg-canvas border border-line rounded-lg text-xs text-ink placeholder-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <button
                    onClick={generateMessage}
                    disabled={aiBusy === 'message' || !isDirty}
                    title={isDirty ? 'Generate a commit message from the diff' : 'Make a change first'}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line hover:border-indigo-500/40 text-muted hover:text-indigo-300 text-xs transition-colors disabled:opacity-40"
                  >
                    {aiBusy === 'message' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Suggest
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setOpenPr(!openPr)}
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        openPr ? 'bg-indigo-600 border-indigo-500' : 'bg-canvas border-line-strong'
                      }`}
                    >
                      {openPr && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <span className="text-[11px] text-muted">
                      Open a pull request instead of committing to <span className="font-mono text-ink/85">{branch}</span>
                    </span>
                  </label>

                  {isDirty && (
                    <button
                      onClick={() => setContent(original)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-subtle hover:text-ink/85 hover:bg-raised text-[11px] transition-colors"
                    >
                      <Undo2 className="w-3 h-3" />
                      Revert
                    </button>
                  )}

                  <button
                    onClick={commit}
                    disabled={committing || !isDirty || !commitMessage.trim()}
                    className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-raised disabled:text-faint text-white text-xs font-semibold transition-colors"
                  >
                    {committing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : openPr ? (
                      <GitPullRequestCreate className="w-3.5 h-3.5" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    {openPr ? 'Commit & open PR' : 'Commit to branch'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {toast && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-raised border border-line-strong text-xs text-ink shadow-2xl animate-in fade-in slide-in-from-bottom-2">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
