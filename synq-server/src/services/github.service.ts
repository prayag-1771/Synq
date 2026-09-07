import { ParsedGitRef } from '../utils/gitRefParser';

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'Synq-Collaboration-Platform';

export class GitHubApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  accept?: string;
  /** Return the raw text body instead of parsing JSON (used for diffs/patches). */
  raw?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * A minimal, dependency-free GitHub REST client scoped to a single user token.
 * Everything the chat surface needs — pull requests, issues, commits, file
 * contents, checks, merges and commits back to the repo — routes through here.
 */
export class GitHubClient {
  constructor(private readonly token: string) {}

  async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, accept = 'application/vnd.github+json', raw = false, query } = options;

    let url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      let details: any = text;
      try {
        details = JSON.parse(text);
      } catch {
        /* plain text error */
      }

      const remaining = response.headers.get('x-ratelimit-remaining');
      if (response.status === 403 && remaining === '0') {
        const resetAt = Number(response.headers.get('x-ratelimit-reset') || 0) * 1000;
        throw new GitHubApiError(
          429,
          `GitHub rate limit exhausted. Resets at ${new Date(resetAt).toLocaleTimeString()}.`,
          details
        );
      }

      throw new GitHubApiError(
        response.status,
        details?.message || `GitHub API request failed (${response.status})`,
        details
      );
    }

    if (response.status === 204) return undefined as T;
    return (raw ? await response.text() : await response.json()) as T;
  }

  // ---------------------------------------------------------------- identity

  getAuthenticatedUser() {
    return this.request<any>('/user');
  }

  listRepositories(page = 1, perPage = 100) {
    return this.request<any[]>('/user/repos', {
      query: { sort: 'updated', per_page: perPage, page, affiliation: 'owner,collaborator,organization_member' },
    });
  }

  getRepository(owner: string, repo: string) {
    return this.request<any>(`/repos/${owner}/${repo}`);
  }

  // ----------------------------------------------------------- pull requests

  listPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open', perPage = 30) {
    return this.request<any[]>(`/repos/${owner}/${repo}/pulls`, {
      query: { state, per_page: perPage, sort: 'updated', direction: 'desc' },
    });
  }

  getPullRequest(owner: string, repo: string, number: number) {
    return this.request<any>(`/repos/${owner}/${repo}/pulls/${number}`);
  }

  getPullRequestFiles(owner: string, repo: string, number: number, perPage = 100) {
    return this.request<any[]>(`/repos/${owner}/${repo}/pulls/${number}/files`, { query: { per_page: perPage } });
  }

  getPullRequestDiff(owner: string, repo: string, number: number) {
    return this.request<string>(`/repos/${owner}/${repo}/pulls/${number}`, {
      accept: 'application/vnd.github.v3.diff',
      raw: true,
    });
  }

  getPullRequestReviews(owner: string, repo: string, number: number) {
    return this.request<any[]>(`/repos/${owner}/${repo}/pulls/${number}/reviews`);
  }

  getPullRequestCommits(owner: string, repo: string, number: number) {
    return this.request<any[]>(`/repos/${owner}/${repo}/pulls/${number}/commits`, { query: { per_page: 100 } });
  }

  mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    payload: { merge_method?: 'merge' | 'squash' | 'rebase'; commit_title?: string; commit_message?: string; sha?: string }
  ) {
    return this.request<any>(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
      method: 'PUT',
      body: payload,
    });
  }

  createReview(
    owner: string,
    repo: string,
    number: number,
    payload: { body?: string; event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; comments?: any[] }
  ) {
    return this.request<any>(`/repos/${owner}/${repo}/pulls/${number}/reviews`, { method: 'POST', body: payload });
  }

  createPullRequest(
    owner: string,
    repo: string,
    payload: { title: string; head: string; base: string; body?: string; draft?: boolean }
  ) {
    return this.request<any>(`/repos/${owner}/${repo}/pulls`, { method: 'POST', body: payload });
  }

  updatePullRequest(owner: string, repo: string, number: number, payload: Record<string, any>) {
    return this.request<any>(`/repos/${owner}/${repo}/pulls/${number}`, { method: 'PATCH', body: payload });
  }

  // ------------------------------------------------------------------ issues

  listIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open', perPage = 30) {
    return this.request<any[]>(`/repos/${owner}/${repo}/issues`, {
      query: { state, per_page: perPage, sort: 'updated', direction: 'desc' },
    });
  }

  getIssue(owner: string, repo: string, number: number) {
    return this.request<any>(`/repos/${owner}/${repo}/issues/${number}`);
  }

  createIssue(owner: string, repo: string, payload: { title: string; body?: string; labels?: string[]; assignees?: string[] }) {
    return this.request<any>(`/repos/${owner}/${repo}/issues`, { method: 'POST', body: payload });
  }

  updateIssue(owner: string, repo: string, number: number, payload: Record<string, any>) {
    return this.request<any>(`/repos/${owner}/${repo}/issues/${number}`, { method: 'PATCH', body: payload });
  }

  createIssueComment(owner: string, repo: string, number: number, body: string) {
    return this.request<any>(`/repos/${owner}/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } });
  }

  listIssueComments(owner: string, repo: string, number: number) {
    return this.request<any[]>(`/repos/${owner}/${repo}/issues/${number}/comments`, { query: { per_page: 50 } });
  }

  // ----------------------------------------------------------------- commits

  listCommits(owner: string, repo: string, sha?: string, perPage = 30) {
    return this.request<any[]>(`/repos/${owner}/${repo}/commits`, { query: { sha, per_page: perPage } });
  }

  getCommit(owner: string, repo: string, sha: string) {
    return this.request<any>(`/repos/${owner}/${repo}/commits/${sha}`);
  }

  getCommitDiff(owner: string, repo: string, sha: string) {
    return this.request<string>(`/repos/${owner}/${repo}/commits/${sha}`, {
      accept: 'application/vnd.github.v3.diff',
      raw: true,
    });
  }

  compareCommits(owner: string, repo: string, base: string, head: string) {
    return this.request<any>(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  }

  // ------------------------------------------------------- contents & trees

  /** Raw file/directory metadata. For files, `content` is base64. */
  getContents(owner: string, repo: string, path: string, ref?: string) {
    return this.request<any>(`/repos/${owner}/${repo}/contents/${encodeContentPath(path)}`, { query: { ref } });
  }

  async getFileText(owner: string, repo: string, path: string, ref?: string): Promise<{ text: string; sha: string; htmlUrl: string }> {
    const data = await this.getContents(owner, repo, path, ref);
    if (Array.isArray(data)) {
      throw new GitHubApiError(400, `${path} is a directory, not a file`);
    }
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new GitHubApiError(415, `${path} is not a readable text file`);
    }
    return {
      text: Buffer.from(data.content, 'base64').toString('utf8'),
      sha: data.sha,
      htmlUrl: data.html_url,
    };
  }

  /** Creates or updates a file. `sha` is required when overwriting. */
  putFile(
    owner: string,
    repo: string,
    path: string,
    payload: { message: string; content: string; branch?: string; sha?: string }
  ) {
    return this.request<any>(`/repos/${owner}/${repo}/contents/${encodeContentPath(path)}`, {
      method: 'PUT',
      body: { ...payload, content: Buffer.from(payload.content, 'utf8').toString('base64') },
    });
  }

  listBranches(owner: string, repo: string, perPage = 100) {
    return this.request<any[]>(`/repos/${owner}/${repo}/branches`, { query: { per_page: perPage } });
  }

  getRef(owner: string, repo: string, ref: string) {
    return this.request<any>(`/repos/${owner}/${repo}/git/ref/${ref}`);
  }

  createBranch(owner: string, repo: string, branch: string, fromSha: string) {
    return this.request<any>(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha: fromSha },
    });
  }

  getTree(owner: string, repo: string, ref: string, recursive = false) {
    return this.request<any>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}`, {
      query: { recursive: recursive ? '1' : undefined },
    });
  }

  // ------------------------------------------------------------ checks & CI

  listCheckRuns(owner: string, repo: string, ref: string) {
    return this.request<any>(`/repos/${owner}/${repo}/commits/${ref}/check-runs`, { query: { per_page: 50 } });
  }

  getCombinedStatus(owner: string, repo: string, ref: string) {
    return this.request<any>(`/repos/${owner}/${repo}/commits/${ref}/status`);
  }

  getWorkflowRun(owner: string, repo: string, runId: number) {
    return this.request<any>(`/repos/${owner}/${repo}/actions/runs/${runId}`);
  }

  listWorkflowRuns(owner: string, repo: string, perPage = 20) {
    return this.request<any>(`/repos/${owner}/${repo}/actions/runs`, { query: { per_page: perPage } });
  }

  // ------------------------------------------------------------------ search

  searchCode(query: string, perPage = 20) {
    return this.request<any>('/search/code', { query: { q: query, per_page: perPage } });
  }

  searchIssues(query: string, perPage = 20) {
    return this.request<any>('/search/issues', { query: { q: query, per_page: perPage, sort: 'updated' } });
  }

  // ---------------------------------------------------------------- webhooks

  listWebhooks(owner: string, repo: string) {
    return this.request<any[]>(`/repos/${owner}/${repo}/hooks`);
  }

  createWebhook(owner: string, repo: string, url: string, secret: string, events: string[]) {
    return this.request<any>(`/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      body: {
        name: 'web',
        active: true,
        events,
        config: { url, content_type: 'json', secret, insecure_ssl: '0' },
      },
    });
  }

  deleteWebhook(owner: string, repo: string, hookId: number) {
    return this.request<void>(`/repos/${owner}/${repo}/hooks/${hookId}`, { method: 'DELETE' });
  }
}

/** Encodes a repo path for the contents API while keeping `/` separators intact. */
const encodeContentPath = (path: string): string =>
  path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

export interface ResolvedRefCard {
  key: string;
  kind: string;
  owner: string;
  repo: string;
  title: string;
  subtitle?: string;
  url: string;
  state?: string;
  /** Normalised state used for colour coding on the client. */
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
  /** Snippet lines for file references. */
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

const languageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', py: 'python', rb: 'ruby',
    go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp',
    php: 'php', swift: 'swift', sql: 'sql', sh: 'bash', yml: 'yaml', yaml: 'yaml', json: 'json',
    md: 'markdown', css: 'css', scss: 'scss', html: 'html', prisma: 'prisma', toml: 'toml',
  };
  return map[ext] || ext || 'text';
};

const issueTone = (item: any): ResolvedRefCard['tone'] => {
  if (item.merged_at || item.merged) return 'merged';
  if (item.draft) return 'draft';
  if (item.state === 'closed') return 'closed';
  return 'open';
};

const summariseChecks = (checkRuns: any): ResolvedRefCard['checks'] => {
  const runs: any[] = checkRuns?.check_runs || [];
  if (runs.length === 0) return undefined;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const run of runs) {
    if (run.status !== 'completed') pending++;
    else if (['success', 'neutral', 'skipped'].includes(run.conclusion)) passed++;
    else failed++;
  }
  return { total: runs.length, passed, failed, pending };
};

/**
 * Turns a parsed reference into a display-ready card by calling GitHub.
 * A reference that cannot be resolved returns a card carrying `error` rather
 * than throwing, so one bad reference never breaks a whole message.
 */
export const resolveReference = async (client: GitHubClient, ref: ParsedGitRef): Promise<ResolvedRefCard> => {
  const base: ResolvedRefCard = {
    key: ref.key,
    kind: ref.kind,
    owner: ref.owner,
    repo: ref.repo,
    title: `${ref.owner}/${ref.repo}`,
    url: `https://github.com/${ref.owner}/${ref.repo}`,
  };

  try {
    switch (ref.kind) {
      case 'pull':
      case 'issue': {
        // `#123` is ambiguous: GitHub numbers issues and PRs in one sequence.
        // The issues endpoint answers for both and tells us which one it is.
        const item = await client.getIssue(ref.owner, ref.repo, ref.number!);
        const isPull = Boolean(item.pull_request);

        let pull: any = null;
        let checks: ResolvedRefCard['checks'];
        if (isPull) {
          pull = await client.getPullRequest(ref.owner, ref.repo, ref.number!).catch(() => null);
          if (pull?.head?.sha) {
            const runs = await client.listCheckRuns(ref.owner, ref.repo, pull.head.sha).catch(() => null);
            checks = summariseChecks(runs);
          }
        }

        return {
          ...base,
          kind: isPull ? 'pull' : 'issue',
          number: item.number,
          title: item.title,
          subtitle: `${ref.owner}/${ref.repo}#${item.number}`,
          url: item.html_url,
          state: pull?.merged ? 'merged' : item.state,
          tone: issueTone(pull || item),
          author: item.user ? { login: item.user.login, avatarUrl: item.user.avatar_url } : undefined,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          labels: (item.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
          body: (item.body || '').slice(0, 600),
          stats: {
            comments: item.comments,
            additions: pull?.additions,
            deletions: pull?.deletions,
            changedFiles: pull?.changed_files,
          },
          branch: pull ? { head: pull.head?.ref, base: pull.base?.ref } : undefined,
          mergeable: pull?.mergeable ?? null,
          merged: Boolean(pull?.merged),
          checks,
        };
      }

      case 'commit': {
        const commit = await client.getCommit(ref.owner, ref.repo, ref.sha!);
        const [subject, ...rest] = (commit.commit?.message || '').split('\n');
        return {
          ...base,
          kind: 'commit',
          sha: commit.sha,
          title: subject || commit.sha.slice(0, 7),
          subtitle: `${ref.owner}/${ref.repo}@${commit.sha.slice(0, 7)}`,
          url: commit.html_url,
          tone: 'neutral',
          author: commit.author
            ? { login: commit.author.login, avatarUrl: commit.author.avatar_url }
            : { login: commit.commit?.author?.name || 'unknown', avatarUrl: '' },
          createdAt: commit.commit?.author?.date,
          body: rest.join('\n').trim().slice(0, 400),
          stats: {
            additions: commit.stats?.additions,
            deletions: commit.stats?.deletions,
            changedFiles: commit.files?.length,
          },
        };
      }

      case 'file': {
        const { text, htmlUrl } = await client.getFileText(ref.owner, ref.repo, ref.path!, ref.ref);
        const lines = text.split('\n');
        const start = Math.max(1, ref.startLine || 1);
        const end = Math.min(lines.length, ref.endLine || (ref.startLine ? ref.startLine + 8 : 12));
        const snippet = lines.slice(start - 1, end).map((textLine, i) => ({ line: start + i, text: textLine }));

        const anchor = ref.startLine ? `#L${start}${ref.endLine ? `-L${end}` : ''}` : '';
        return {
          ...base,
          kind: 'file',
          path: ref.path,
          title: ref.path!.split('/').pop() || ref.path!,
          subtitle: `${ref.owner}/${ref.repo} · ${ref.path}${ref.startLine ? `:${start}${ref.endLine ? `-${end}` : ''}` : ''}`,
          url: `${htmlUrl.split('#')[0]}${anchor}`,
          startLine: ref.startLine,
          endLine: ref.endLine,
          language: languageFromPath(ref.path!),
          snippet,
          tone: 'neutral',
        };
      }

      case 'compare': {
        const comparison = await client.compareCommits(ref.owner, ref.repo, ref.base!, ref.head!);
        return {
          ...base,
          kind: 'compare',
          title: `${ref.base}...${ref.head}`,
          subtitle: `${comparison.total_commits} commit${comparison.total_commits === 1 ? '' : 's'} · ${ref.owner}/${ref.repo}`,
          url: comparison.html_url,
          tone: 'neutral',
          branch: { base: ref.base, head: ref.head },
          stats: {
            additions: (comparison.files || []).reduce((sum: number, f: any) => sum + (f.additions || 0), 0),
            deletions: (comparison.files || []).reduce((sum: number, f: any) => sum + (f.deletions || 0), 0),
            changedFiles: (comparison.files || []).length,
          },
        };
      }

      case 'branch': {
        const branch = await client.request<any>(
          `/repos/${ref.owner}/${ref.repo}/branches/${encodeURIComponent(ref.ref!)}`
        );
        return {
          ...base,
          kind: 'branch',
          title: branch.name,
          subtitle: `${ref.owner}/${ref.repo} · ${branch.commit?.sha?.slice(0, 7)}`,
          url: `https://github.com/${ref.owner}/${ref.repo}/tree/${branch.name}`,
          tone: branch.protected ? 'neutral' : 'open',
          body: branch.commit?.commit?.message?.split('\n')[0],
        };
      }

      case 'run': {
        const run = await client.getWorkflowRun(ref.owner, ref.repo, ref.runId!);
        const succeeded = run.conclusion === 'success';
        return {
          ...base,
          kind: 'run',
          title: run.name || `Workflow run #${run.run_number}`,
          subtitle: `${run.head_branch} · ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}`,
          url: run.html_url,
          state: run.conclusion || run.status,
          tone: run.status !== 'completed' ? 'neutral' : succeeded ? 'success' : 'failure',
          createdAt: run.created_at,
          author: run.actor ? { login: run.actor.login, avatarUrl: run.actor.avatar_url } : undefined,
        };
      }

      case 'repo':
      default: {
        const repository = await client.getRepository(ref.owner, ref.repo);
        return {
          ...base,
          kind: 'repo',
          title: repository.full_name,
          subtitle: repository.description || repository.language || 'Repository',
          url: repository.html_url,
          tone: 'neutral',
          stats: { comments: repository.open_issues_count },
        };
      }
    }
  } catch (error: any) {
    return {
      ...base,
      title: describeRef(ref),
      subtitle: `${ref.owner}/${ref.repo}`,
      error:
        error instanceof GitHubApiError && error.status === 404
          ? 'Not found — the reference may be private or deleted'
          : error?.message || 'Could not resolve this reference',
    };
  }
};

/** Human-readable label for a reference, used in errors and AI prompts. */
export const describeRef = (ref: ParsedGitRef): string => {
  switch (ref.kind) {
    case 'pull':
    case 'issue':
      return `${ref.owner}/${ref.repo}#${ref.number}`;
    case 'commit':
      return `${ref.owner}/${ref.repo}@${ref.sha?.slice(0, 7)}`;
    case 'file':
      return `${ref.path}${ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}`;
    case 'compare':
      return `${ref.base}...${ref.head}`;
    case 'branch':
      return `branch ${ref.ref}`;
    case 'run':
      return `workflow run ${ref.runId}`;
    default:
      return `${ref.owner}/${ref.repo}`;
  }
};
