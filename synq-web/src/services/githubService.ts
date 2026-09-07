import { apiService } from './apiService';
import { localDb, CachedGitRef } from '../db/localDb';
import { ParsedGitRef } from '../lib/gitRefParser';

export interface ResolvedRefCard {
  key: string;
  kind: string;
  owner: string;
  repo: string;
  title: string;
  subtitle?: string;
  url: string;
  state?: string;
  tone?: 'open' | 'merged' | 'closed' | 'draft' | 'success' | 'failure' | 'neutral';
  author?: { login: string; avatarUrl: string };
  createdAt?: string;
  updatedAt?: string;
  number?: number;
  sha?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  snippet?: { line: number; text: string }[];
  stats?: { additions?: number; deletions?: number; changedFiles?: number; comments?: number };
  labels?: { name: string; color: string }[];
  checks?: { total: number; passed: number; failed: number; pending: number };
  branch?: { head?: string; base?: string };
  body?: string;
  mergeable?: boolean | null;
  merged?: boolean;
  error?: string;
}

export interface GitHubStatus {
  connected: boolean;
  login: string | null;
  avatarUrl: string | null;
  tokenType: string | null;
  scopes: string | null;
  connectedAt: string | null;
  oauthAvailable: boolean;
  aiAvailable: boolean;
}

export interface LinkedRepo {
  linkId: string;
  repositoryId: string;
  fullName: string;
  owner: string;
  name: string;
  description?: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  htmlUrl: string;
  language?: string | null;
  isPrimary: boolean;
  webhookActive: boolean;
  linkedBy?: string;
}

export class GitHubNotConnectedError extends Error {
  constructor() {
    super('GitHub account is not connected');
    this.name = 'GitHubNotConnectedError';
  }
}

/** Unwraps a response, turning the 428 handshake into a typed error. */
const unwrap = async <T>(res: Response): Promise<T> => {
  if (res.status === 428) throw new GitHubNotConnectedError();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `Request failed (${res.status})`);
  return data as T;
};

const REF_TTL_MS = 5 * 60 * 1000;

class GitHubService {
  /** De-duplicates concurrent resolutions of the same reference across components. */
  private inFlight = new Map<string, Promise<ResolvedRefCard | null>>();

  // ------------------------------------------------------------- connection

  async getStatus(): Promise<GitHubStatus> {
    const res = await apiService.get('/github/status');
    return unwrap<GitHubStatus>(res);
  }

  async connectWithToken(token: string) {
    const res = await apiService.post('/github/connect', { token });
    return unwrap<{ connected: boolean; login: string; avatarUrl: string }>(res);
  }

  async getOAuthUrl() {
    const res = await apiService.get('/github/oauth/url');
    return unwrap<{ url: string; state: string }>(res);
  }

  async completeOAuth(code: string) {
    const res = await apiService.post('/github/oauth/callback', { code });
    return unwrap<{ connected: boolean; login: string }>(res);
  }

  async disconnect() {
    const res = await apiService.delete('/github/disconnect');
    return unwrap<{ connected: boolean }>(res);
  }

  // ----------------------------------------------------------- repositories

  async listMyRepositories() {
    const res = await apiService.get('/github/repos');
    const data = await unwrap<{ repositories: any[] }>(res);
    return data.repositories;
  }

  async listChatRepositories(chatId: string): Promise<LinkedRepo[]> {
    const res = await apiService.get(`/github/chats/${chatId}/repos`);
    const data = await unwrap<{ repositories: LinkedRepo[] }>(res);

    // Mirror into Dexie so shorthand references resolve instantly on reload.
    await localDb.repoLinks.where('chatId').equals(chatId).delete();
    if (data.repositories.length > 0) {
      await localDb.repoLinks.bulkPut(
        data.repositories.map((r) => ({
          id: `${chatId}:${r.repositoryId}`,
          chatId,
          repositoryId: r.repositoryId,
          fullName: r.fullName,
          owner: r.owner,
          name: r.name,
          defaultBranch: r.defaultBranch,
          description: r.description,
          language: r.language,
          htmlUrl: r.htmlUrl,
          isPrimary: r.isPrimary,
          webhookActive: r.webhookActive,
        }))
      );
    }

    return data.repositories;
  }

  async linkRepository(chatId: string, fullName: string, installWebhook = false) {
    const res = await apiService.post(`/github/chats/${chatId}/repos`, { fullName, installWebhook });
    return unwrap<LinkedRepo & { webhookError?: string | null }>(res);
  }

  async unlinkRepository(chatId: string, repositoryId: string) {
    const res = await apiService.delete(`/github/chats/${chatId}/repos/${repositoryId}`);
    await localDb.repoLinks.delete(`${chatId}:${repositoryId}`);
    return unwrap<{ unlinked: boolean }>(res);
  }

  async setPrimaryRepository(chatId: string, repositoryId: string) {
    const res = await apiService.put(`/github/chats/${chatId}/repos/${repositoryId}`, { isPrimary: true });
    return unwrap<any>(res);
  }

  async getChatActivity(chatId: string) {
    const res = await apiService.get(`/github/chats/${chatId}/activity`);
    const data = await unwrap<{ events: any[] }>(res);
    return data.events;
  }

  // ------------------------------------------------------ reference resolve

  /**
   * Resolves parsed references into cards, serving warm entries from IndexedDB
   * and batching the rest into a single request.
   */
  async resolveRefs(refs: ParsedGitRef[]): Promise<Map<string, ResolvedRefCard>> {
    const resolved = new Map<string, ResolvedRefCard>();
    if (refs.length === 0) return resolved;

    const now = Date.now();
    const misses: ParsedGitRef[] = [];

    const cached = await localDb.gitRefs.bulkGet(refs.map((r) => r.key));
    cached.forEach((entry: CachedGitRef | undefined, i: number) => {
      if (entry && now - entry.fetchedAt < REF_TTL_MS) {
        resolved.set(entry.key, entry.card);
      } else {
        misses.push(refs[i]);
      }
    });

    if (misses.length === 0) return resolved;

    // Serve stale-while-revalidate: any pending fetch for the same key is reused.
    const pending = misses.filter((r) => this.inFlight.has(r.key));
    const toFetch = misses.filter((r) => !this.inFlight.has(r.key));

    if (toFetch.length > 0) {
      const request = this.fetchRefs(toFetch);
      toFetch.forEach((ref) => {
        this.inFlight.set(
          ref.key,
          request.then((map) => map.get(ref.key) || null).finally(() => this.inFlight.delete(ref.key))
        );
      });
    }

    await Promise.all(
      [...pending, ...toFetch].map(async (ref) => {
        const card = await this.inFlight.get(ref.key)?.catch(() => null);
        if (card) resolved.set(ref.key, card);
      })
    );

    return resolved;
  }

  private async fetchRefs(refs: ParsedGitRef[]): Promise<Map<string, ResolvedRefCard>> {
    const map = new Map<string, ResolvedRefCard>();

    // Only the reference tokens leave the browser — never the message text.
    const payload = refs.slice(0, 25).map((r) => ({
      key: r.key,
      kind: r.kind,
      owner: r.owner,
      repo: r.repo,
      number: r.number,
      sha: r.sha,
      path: r.path,
      ref: r.ref,
      startLine: r.startLine,
      endLine: r.endLine,
      base: r.base,
      head: r.head,
      runId: r.runId,
    }));

    const res = await apiService.post('/github/resolve', { refs: payload });
    if (res.status === 428) throw new GitHubNotConnectedError();
    if (!res.ok) return map;

    const data = await res.json();
    const fetchedAt = Date.now();
    const toCache: CachedGitRef[] = [];

    for (const card of data.cards || []) {
      map.set(card.key, card);
      if (!card.error) toCache.push({ key: card.key, card, fetchedAt });
    }
    if (toCache.length > 0) await localDb.gitRefs.bulkPut(toCache);

    return map;
  }

  /** Drops cached cards so the next render pulls fresh state (after a merge, say). */
  async invalidateRefs(keys?: string[]) {
    if (keys?.length) await localDb.gitRefs.bulkDelete(keys);
    else await localDb.gitRefs.clear();
  }

  // ------------------------------------------------------------ pull requests

  async listPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open') {
    const res = await apiService.get(`/github/repos/${owner}/${repo}/pulls?state=${state}`);
    const data = await unwrap<{ pullRequests: any[] }>(res);
    return data.pullRequests;
  }

  async getPullRequest(owner: string, repo: string, number: number) {
    const res = await apiService.get(`/github/repos/${owner}/${repo}/pulls/${number}`);
    return unwrap<any>(res);
  }

  async mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    method: 'merge' | 'squash' | 'rebase',
    title?: string
  ) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/pulls/${number}/merge`, { method, title });
    return unwrap<{ merged: boolean; sha: string; message: string }>(res);
  }

  async submitReview(
    owner: string,
    repo: string,
    number: number,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body?: string
  ) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/pulls/${number}/review`, { event, body });
    return unwrap<any>(res);
  }

  async comment(owner: string, repo: string, number: number, body: string) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/pulls/${number}/comment`, { body });
    return unwrap<any>(res);
  }

  // ------------------------------------------------------------------ issues

  async listIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open') {
    const res = await apiService.get(`/github/repos/${owner}/${repo}/issues?state=${state}`);
    const data = await unwrap<{ issues: any[] }>(res);
    return data.issues;
  }

  async createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[]) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/issues`, { title, body, labels });
    return unwrap<{ number: number; title: string; htmlUrl: string; state: string }>(res);
  }

  async setIssueState(owner: string, repo: string, number: number, state: 'open' | 'closed') {
    const res = await apiService.put(`/github/repos/${owner}/${repo}/issues/${number}/state`, { state });
    return unwrap<any>(res);
  }

  // -------------------------------------------------- commits, files, trees

  async listCommits(owner: string, repo: string, sha?: string) {
    const res = await apiService.get(`/github/repos/${owner}/${repo}/commits${sha ? `?sha=${encodeURIComponent(sha)}` : ''}`);
    const data = await unwrap<{ commits: any[] }>(res);
    return data.commits;
  }

  async getCommit(owner: string, repo: string, sha: string) {
    const res = await apiService.get(`/github/repos/${owner}/${repo}/commits/${sha}`);
    return unwrap<any>(res);
  }

  async listBranches(owner: string, repo: string) {
    const res = await apiService.get(`/github/repos/${owner}/${repo}/branches`);
    const data = await unwrap<{ branches: any[] }>(res);
    return data.branches;
  }

  async browseTree(owner: string, repo: string, path = '', ref?: string) {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (ref) params.set('ref', ref);
    const res = await apiService.get(`/github/repos/${owner}/${repo}/tree?${params.toString()}`);
    return unwrap<{ path: string; entries: any[] }>(res);
  }

  async getFile(owner: string, repo: string, path: string, ref?: string) {
    const params = new URLSearchParams({ path });
    if (ref) params.set('ref', ref);
    const res = await apiService.get(`/github/repos/${owner}/${repo}/file?${params.toString()}`);
    return unwrap<{ path: string; text: string; sha: string; htmlUrl: string }>(res);
  }

  async commitFile(
    owner: string,
    repo: string,
    payload: {
      path: string;
      content: string;
      message: string;
      sha?: string;
      branch?: string;
      openPullRequest?: boolean;
      newBranch?: string;
      pullRequestTitle?: string;
      pullRequestBody?: string;
    }
  ) {
    const res = await apiService.put(`/github/repos/${owner}/${repo}/file`, payload);
    return unwrap<{
      commit: { sha: string; htmlUrl: string; message: string };
      branch: string;
      pullRequest: { number: number; title: string; htmlUrl: string } | null;
    }>(res);
  }

  async searchCode(owner: string, repo: string, query: string) {
    const res = await apiService.get(`/github/repos/${owner}/${repo}/search?q=${encodeURIComponent(query)}`);
    return unwrap<{ total: number; results: any[] }>(res);
  }

  // ---------------------------------------------------------------------- AI

  async aiReviewPullRequest(owner: string, repo: string, number: number) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/ai/pulls/${number}/review`, {});
    return unwrap<{
      verdict: 'approve' | 'comment' | 'request_changes';
      summary: string;
      findings: {
        severity: 'critical' | 'major' | 'minor' | 'nit';
        file: string;
        line?: number;
        title: string;
        detail: string;
        suggestion?: string;
      }[];
      testGaps: string[];
    }>(res);
  }

  async aiSummarizePullRequest(owner: string, repo: string, number: number) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/ai/pulls/${number}/summary`, {});
    const data = await unwrap<{ summary: string }>(res);
    return data.summary;
  }

  async aiDescribePullRequest(owner: string, repo: string, number: number, apply = false) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/ai/pulls/${number}/describe`, { apply });
    return unwrap<{ description: string; applied: boolean }>(res);
  }

  async aiExplainCommit(owner: string, repo: string, sha: string, question?: string) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/ai/commits/${sha}/explain`, { question });
    return unwrap<{ explanation: string; sha: string; message: string }>(res);
  }

  async aiAskRepo(owner: string, repo: string, question: string) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/ai/ask`, { question });
    return unwrap<{ answer: string; sources: { path: string; url: string }[] }>(res);
  }

  async aiDraftIssue(owner: string, repo: string, transcript: string, create = false) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/ai/draft-issue`, { transcript, create });
    return unwrap<{
      draft: { title: string; body: string; labels: string[] };
      issue: { number: number; title: string; htmlUrl: string } | null;
    }>(res);
  }

  async aiProposeEdit(owner: string, repo: string, path: string, instruction: string, ref?: string) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/ai/propose-edit`, { path, instruction, ref });
    return unwrap<{ path: string; original: string; proposed: string; explanation: string; sha: string }>(res);
  }

  async aiCommitMessage(owner: string, repo: string, path: string, before: string, after: string) {
    const res = await apiService.post(`/github/repos/${owner}/${repo}/ai/commit-message`, { path, before, after });
    const data = await unwrap<{ message: string }>(res);
    return data.message;
  }
}

export const githubService = new GitHubService();
export default githubService;
