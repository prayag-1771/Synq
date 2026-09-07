import { Request, Response } from 'express';
import { prisma } from '../db/db';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { eventBus } from '../events/eventBus';
import { encryptSecret, decryptSecret, generateWebhookSecret, verifyGithubSignature } from '../utils/crypto.util';
import { GitHubClient, GitHubApiError, resolveReference, ResolvedRefCard } from '../services/github.service';
import { ParsedGitRef, GitRefKind } from '../utils/gitRefParser';
import * as codeAi from '../services/github-ai.service';

const NAME_PATTERN = /^[\w.-]{1,100}$/;

const isSafeName = (value: unknown): value is string => typeof value === 'string' && NAME_PATTERN.test(value);

const fail = (res: Response, error: unknown, fallback = 'GitHub request failed') => {
  if (error instanceof GitHubApiError) {
    return res.status(error.status === 401 ? 401 : error.status).json({ message: error.message, details: error.details });
  }
  console.error(`[GitHub] ${fallback}:`, error);
  return res.status(500).json({ message: (error as Error)?.message || fallback });
};

/**
 * Loads the caller's GitHub credentials and returns a ready client.
 * Responds 428 when the user has not connected an account yet — the client
 * uses that status to open the connect dialog.
 */
const getClient = async (req: AuthenticatedRequest, res: Response): Promise<GitHubClient | null> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return null;
  }

  const account = await prisma.gitHubAccount.findUnique({ where: { userId } });
  if (!account) {
    res.status(428).json({ message: 'GitHub account not connected', code: 'GITHUB_NOT_CONNECTED' });
    return null;
  }

  try {
    return new GitHubClient(decryptSecret(account.accessToken));
  } catch {
    res.status(500).json({ message: 'Stored GitHub token could not be decrypted. Reconnect your account.' });
    return null;
  }
};

/** Confirms the caller actually belongs to the chat they are acting on. */
const assertParticipant = async (chatId: string, userId: string): Promise<boolean> => {
  const participant = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  return Boolean(participant);
};

// ===========================================================================
// Account connection
// ===========================================================================

export const getStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const account = await prisma.gitHubAccount.findUnique({ where: { userId } });

    return res.status(200).json({
      connected: Boolean(account),
      login: account?.githubLogin || null,
      avatarUrl: account?.avatarUrl || null,
      tokenType: account?.tokenType || null,
      scopes: account?.scopes || null,
      connectedAt: account?.createdAt || null,
      oauthAvailable: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      aiAvailable: codeAi.isCodeAiAvailable(),
    });
  } catch (error) {
    return fail(res, error, 'Failed to read GitHub status');
  }
};

/**
 * Connects an account with a personal access token. Works with both classic
 * (`repo` scope) and fine-grained tokens, and requires no GitHub App setup.
 */
export const connectWithToken = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.length < 20) {
      return res.status(400).json({ message: 'A valid GitHub personal access token is required' });
    }

    const client = new GitHubClient(token.trim());
    const ghUser = await client.getAuthenticatedUser();

    const account = await prisma.gitHubAccount.upsert({
      where: { userId: req.user!.userId },
      create: {
        userId: req.user!.userId,
        githubLogin: ghUser.login,
        githubUserId: String(ghUser.id),
        avatarUrl: ghUser.avatar_url,
        accessToken: encryptSecret(token.trim()),
        tokenType: 'pat',
      },
      update: {
        githubLogin: ghUser.login,
        githubUserId: String(ghUser.id),
        avatarUrl: ghUser.avatar_url,
        accessToken: encryptSecret(token.trim()),
        tokenType: 'pat',
      },
    });

    return res.status(200).json({
      connected: true,
      login: account.githubLogin,
      avatarUrl: account.avatarUrl,
      tokenType: 'pat',
    });
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 401) {
      return res.status(400).json({ message: 'GitHub rejected that token. Check it has not expired and carries `repo` scope.' });
    }
    return fail(res, error, 'Failed to connect GitHub account');
  }
};

/** Builds the OAuth authorize URL when a GitHub OAuth App is configured. */
export const getOAuthUrl = async (req: AuthenticatedRequest, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(501).json({ message: 'OAuth is not configured on this server. Connect with a personal access token instead.' });
  }

  const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/github/callback`;
  const scope = 'repo read:org read:user';
  const state = Buffer.from(`${req.user!.userId}:${Date.now()}`).toString('base64url');

  const url =
    `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}`;

  return res.status(200).json({ url, state });
};

/** Exchanges an OAuth callback code for an access token and stores it. */
export const completeOAuth = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code } = req.body;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(501).json({ message: 'OAuth is not configured on this server.' });
    }
    if (!code) {
      return res.status(400).json({ message: 'Missing OAuth code' });
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/github/callback`,
      }),
    });

    const tokenData: any = await tokenResponse.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ message: tokenData.error_description || 'GitHub did not return an access token' });
    }

    const client = new GitHubClient(tokenData.access_token);
    const ghUser = await client.getAuthenticatedUser();

    await prisma.gitHubAccount.upsert({
      where: { userId: req.user!.userId },
      create: {
        userId: req.user!.userId,
        githubLogin: ghUser.login,
        githubUserId: String(ghUser.id),
        avatarUrl: ghUser.avatar_url,
        accessToken: encryptSecret(tokenData.access_token),
        tokenType: 'oauth',
        scopes: tokenData.scope || null,
      },
      update: {
        githubLogin: ghUser.login,
        githubUserId: String(ghUser.id),
        avatarUrl: ghUser.avatar_url,
        accessToken: encryptSecret(tokenData.access_token),
        tokenType: 'oauth',
        scopes: tokenData.scope || null,
      },
    });

    return res.status(200).json({ connected: true, login: ghUser.login, avatarUrl: ghUser.avatar_url, tokenType: 'oauth' });
  } catch (error) {
    return fail(res, error, 'OAuth exchange failed');
  }
};

export const disconnect = async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.gitHubAccount.deleteMany({ where: { userId: req.user!.userId } });
    return res.status(200).json({ connected: false });
  } catch (error) {
    return fail(res, error, 'Failed to disconnect GitHub');
  }
};

// ===========================================================================
// Repository linking
// ===========================================================================

export const listUserRepositories = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const repos = await client.listRepositories();
    return res.status(200).json({
      repositories: repos.map((r: any) => ({
        fullName: r.full_name,
        owner: r.owner?.login,
        name: r.name,
        description: r.description,
        isPrivate: r.private,
        defaultBranch: r.default_branch,
        language: r.language,
        htmlUrl: r.html_url,
        updatedAt: r.updated_at,
        stars: r.stargazers_count,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to list repositories');
  }
};

export const listChatRepositories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId } = req.params;
    if (!(await assertParticipant(chatId, req.user!.userId))) {
      return res.status(403).json({ message: 'Forbidden: You are not in this chat' });
    }

    const links = await prisma.chatRepository.findMany({
      where: { chatId },
      include: { repository: true, linkedBy: { select: { id: true, username: true } } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    return res.status(200).json({
      repositories: links.map((link) => ({
        linkId: link.id,
        repositoryId: link.repositoryId,
        fullName: link.repository.fullName,
        owner: link.repository.owner,
        name: link.repository.name,
        description: link.repository.description,
        defaultBranch: link.repository.defaultBranch,
        isPrivate: link.repository.isPrivate,
        htmlUrl: link.repository.htmlUrl,
        language: link.repository.language,
        isPrimary: link.isPrimary,
        webhookActive: Boolean(link.webhookId),
        linkedBy: link.linkedBy.username,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to list linked repositories');
  }
};

/**
 * Links a repository to a conversation and, when asked, installs a webhook so
 * pull requests, pushes and CI results stream into the chat.
 */
export const linkRepository = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { chatId } = req.params;
    const { fullName, installWebhook = false } = req.body;
    const userId = req.user!.userId;

    if (!(await assertParticipant(chatId, userId))) {
      return res.status(403).json({ message: 'Forbidden: You are not in this chat' });
    }
    if (typeof fullName !== 'string' || !fullName.includes('/')) {
      return res.status(400).json({ message: 'fullName must look like "owner/repo"' });
    }

    const [owner, name] = fullName.split('/');
    if (!isSafeName(owner) || !isSafeName(name)) {
      return res.status(400).json({ message: 'Invalid repository name' });
    }

    const ghRepo = await client.getRepository(owner, name);

    const repository = await prisma.repository.upsert({
      where: { fullName: ghRepo.full_name },
      create: {
        owner: ghRepo.owner.login,
        name: ghRepo.name,
        fullName: ghRepo.full_name,
        description: ghRepo.description,
        defaultBranch: ghRepo.default_branch,
        isPrivate: ghRepo.private,
        htmlUrl: ghRepo.html_url,
        language: ghRepo.language,
      },
      update: {
        description: ghRepo.description,
        defaultBranch: ghRepo.default_branch,
        isPrivate: ghRepo.private,
        language: ghRepo.language,
      },
    });

    const existingLinks = await prisma.chatRepository.count({ where: { chatId } });

    const link = await prisma.chatRepository.upsert({
      where: { chatId_repositoryId: { chatId, repositoryId: repository.id } },
      create: {
        chatId,
        repositoryId: repository.id,
        linkedById: userId,
        isPrimary: existingLinks === 0,
      },
      update: {},
    });

    // Optional webhook install — needs admin rights on the repo, so a failure
    // here degrades to "linked, but no live events" rather than blocking.
    let webhookError: string | null = null;
    if (installWebhook && !link.webhookId) {
      const publicUrl = process.env.PUBLIC_SERVER_URL;
      if (!publicUrl) {
        webhookError = 'PUBLIC_SERVER_URL is not set on the server, so GitHub cannot reach the webhook endpoint.';
      } else {
        try {
          const secret = generateWebhookSecret();
          const hook = await client.createWebhook(
            owner,
            name,
            `${publicUrl.replace(/\/$/, '')}/api/github/webhook/${link.id}`,
            secret,
            ['pull_request', 'push', 'issues', 'issue_comment', 'pull_request_review', 'check_suite', 'workflow_run', 'release']
          );
          await prisma.chatRepository.update({
            where: { id: link.id },
            data: { webhookId: String(hook.id), webhookSecret: encryptSecret(secret) },
          });
        } catch (hookErr: any) {
          webhookError =
            hookErr instanceof GitHubApiError && hookErr.status === 404
              ? 'Webhook not installed — you need admin permission on this repository.'
              : hookErr?.message || 'Webhook installation failed.';
        }
      }
    }

    eventBus
      .publish('github.repo.linked', { chatId, repoFullName: repository.fullName, linkedById: userId })
      .catch(console.error);

    return res.status(201).json({
      linkId: link.id,
      repositoryId: repository.id,
      fullName: repository.fullName,
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      isPrimary: link.isPrimary,
      webhookActive: Boolean(link.webhookId) || (installWebhook && !webhookError),
      webhookError,
    });
  } catch (error) {
    return fail(res, error, 'Failed to link repository');
  }
};

export const updateRepositoryLink = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId, repositoryId } = req.params;
    const { isPrimary, notifyEvents } = req.body;

    if (!(await assertParticipant(chatId, req.user!.userId))) {
      return res.status(403).json({ message: 'Forbidden: You are not in this chat' });
    }

    if (isPrimary === true) {
      await prisma.chatRepository.updateMany({ where: { chatId }, data: { isPrimary: false } });
    }

    const updated = await prisma.chatRepository.update({
      where: { chatId_repositoryId: { chatId, repositoryId } },
      data: {
        ...(typeof isPrimary === 'boolean' ? { isPrimary } : {}),
        ...(typeof notifyEvents === 'string' ? { notifyEvents } : {}),
      },
    });

    return res.status(200).json({ linkId: updated.id, isPrimary: updated.isPrimary, notifyEvents: updated.notifyEvents });
  } catch (error) {
    return fail(res, error, 'Failed to update repository link');
  }
};

export const unlinkRepository = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId, repositoryId } = req.params;
    const userId = req.user!.userId;

    if (!(await assertParticipant(chatId, userId))) {
      return res.status(403).json({ message: 'Forbidden: You are not in this chat' });
    }

    const link = await prisma.chatRepository.findUnique({
      where: { chatId_repositoryId: { chatId, repositoryId } },
      include: { repository: true },
    });
    if (!link) return res.status(404).json({ message: 'Repository is not linked to this chat' });

    // Best-effort webhook removal so we do not leave orphaned hooks behind.
    if (link.webhookId) {
      const account = await prisma.gitHubAccount.findUnique({ where: { userId } });
      if (account) {
        try {
          const client = new GitHubClient(decryptSecret(account.accessToken));
          await client.deleteWebhook(link.repository.owner, link.repository.name, Number(link.webhookId));
        } catch (err) {
          console.warn('[GitHub] Could not remove webhook on unlink:', (err as Error).message);
        }
      }
    }

    await prisma.chatRepository.delete({ where: { id: link.id } });
    return res.status(200).json({ unlinked: true });
  } catch (error) {
    return fail(res, error, 'Failed to unlink repository');
  }
};

// ===========================================================================
// Reference resolution
// ===========================================================================

interface CacheEntry {
  card: ResolvedRefCard;
  expiresAt: number;
}

const refCache = new Map<string, CacheEntry>();
const REF_CACHE_TTL_MS = 60_000;
const REF_CACHE_MAX = 2000;

const cacheGet = (key: string): ResolvedRefCard | null => {
  const hit = refCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    refCache.delete(key);
    return null;
  }
  return hit.card;
};

const cacheSet = (key: string, card: ResolvedRefCard) => {
  if (refCache.size >= REF_CACHE_MAX) {
    // Cheap eviction: drop the oldest inserted quarter.
    const keys = Array.from(refCache.keys()).slice(0, Math.floor(REF_CACHE_MAX / 4));
    keys.forEach((k) => refCache.delete(k));
  }
  refCache.set(key, { card, expiresAt: Date.now() + REF_CACHE_TTL_MS });
};

const VALID_KINDS: GitRefKind[] = ['pull', 'issue', 'commit', 'file', 'repo', 'compare', 'branch', 'run'];

/**
 * Resolves references extracted client-side into rich cards.
 *
 * Direct messages are end-to-end encrypted, so the browser parses the plaintext
 * and sends only the reference tokens here — the server never sees message text.
 */
export const resolveReferences = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { refs } = req.body;
    if (!Array.isArray(refs) || refs.length === 0) {
      return res.status(400).json({ message: 'refs must be a non-empty array' });
    }
    if (refs.length > 25) {
      return res.status(400).json({ message: 'Too many references in one request (max 25)' });
    }

    const userId = req.user!.userId;

    const cards = await Promise.all(
      refs.map(async (raw: any): Promise<ResolvedRefCard | null> => {
        if (!isSafeName(raw?.owner) || !isSafeName(raw?.repo) || !VALID_KINDS.includes(raw?.kind)) {
          return null;
        }

        const ref: ParsedGitRef = {
          raw: '',
          index: 0,
          key: String(raw.key || `${raw.kind}:${raw.owner}/${raw.repo}`),
          kind: raw.kind,
          owner: raw.owner,
          repo: raw.repo,
          number: typeof raw.number === 'number' ? raw.number : undefined,
          sha: typeof raw.sha === 'string' ? raw.sha : undefined,
          path: typeof raw.path === 'string' ? raw.path.replace(/^\/+/, '') : undefined,
          ref: typeof raw.ref === 'string' ? raw.ref : undefined,
          startLine: typeof raw.startLine === 'number' ? raw.startLine : undefined,
          endLine: typeof raw.endLine === 'number' ? raw.endLine : undefined,
          base: typeof raw.base === 'string' ? raw.base : undefined,
          head: typeof raw.head === 'string' ? raw.head : undefined,
          runId: typeof raw.runId === 'number' ? raw.runId : undefined,
        };

        const cacheKey = `${userId}:${ref.key}`;
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        const card = await resolveReference(client, ref);
        if (!card.error) cacheSet(cacheKey, card);
        return card;
      })
    );

    return res.status(200).json({ cards: cards.filter(Boolean) });
  } catch (error) {
    return fail(res, error, 'Failed to resolve references');
  }
};

// ===========================================================================
// Repository browsing
// ===========================================================================

export const listPullRequests = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const state = (req.query.state as 'open' | 'closed' | 'all') || 'open';
    const pulls = await client.listPullRequests(owner, repo, state);

    return res.status(200).json({
      pullRequests: pulls.map((p: any) => ({
        number: p.number,
        title: p.title,
        state: p.merged_at ? 'merged' : p.state,
        draft: p.draft,
        author: { login: p.user?.login, avatarUrl: p.user?.avatar_url },
        head: p.head?.ref,
        base: p.base?.ref,
        htmlUrl: p.html_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        labels: (p.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
        reviewers: (p.requested_reviewers || []).map((r: any) => r.login),
      })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to list pull requests');
  }
};

/**
 * Everything the detail view needs, in one round trip.
 *
 * GitHub numbers issues and pull requests in a single sequence, so `#123` is
 * ambiguous until it is fetched. The issues endpoint answers for both; when the
 * item turns out to be a pull request we enrich it with diff, reviews and CI.
 */
export const getPullRequestDetail = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const number = parseInt(req.params.number, 10);

    const item = await client.getIssue(owner, repo, number);
    const isPull = Boolean(item.pull_request);

    const comments = await client.listIssueComments(owner, repo, number).catch(() => [] as any[]);

    const base = {
      type: isPull ? 'pull' : 'issue',
      item: {
        number: item.number,
        title: item.title,
        body: item.body,
        state: item.state,
        author: { login: item.user?.login, avatarUrl: item.user?.avatar_url },
        htmlUrl: item.html_url,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        commentCount: item.comments,
        labels: (item.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
        assignees: (item.assignees || []).map((a: any) => ({ login: a.login, avatarUrl: a.avatar_url })),
      },
      comments: (comments as any[]).map((c: any) => ({
        id: c.id,
        body: c.body,
        author: { login: c.user?.login, avatarUrl: c.user?.avatar_url },
        createdAt: c.created_at,
        htmlUrl: c.html_url,
      })),
    };

    if (!isPull) {
      return res.status(200).json({ ...base, pullRequest: null, files: [], reviews: [], checks: [] });
    }

    const pull = await client.getPullRequest(owner, repo, number);

    const [files, reviews, checks] = await Promise.all([
      client.getPullRequestFiles(owner, repo, number).catch(() => [] as any[]),
      client.getPullRequestReviews(owner, repo, number).catch(() => [] as any[]),
      pull.head?.sha ? client.listCheckRuns(owner, repo, pull.head.sha).catch(() => null) : Promise.resolve(null),
    ]);

    return res.status(200).json({
      ...base,
      item: { ...base.item, state: pull.merged ? 'merged' : pull.state },
      pullRequest: {
        number: pull.number,
        state: pull.merged ? 'merged' : pull.state,
        draft: pull.draft,
        merged: pull.merged,
        mergeable: pull.mergeable,
        mergeableState: pull.mergeable_state,
        head: { ref: pull.head?.ref, sha: pull.head?.sha },
        base: { ref: pull.base?.ref },
        additions: pull.additions,
        deletions: pull.deletions,
        changedFiles: pull.changed_files,
        commits: pull.commits,
        requestedReviewers: (pull.requested_reviewers || []).map((r: any) => r.login),
      },
      files: (files as any[]).map((f: any) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        blobUrl: f.blob_url,
      })),
      reviews: (reviews as any[])
        .filter((r: any) => r.state !== 'PENDING')
        .map((r: any) => ({
          id: r.id,
          state: r.state,
          body: r.body,
          author: { login: r.user?.login, avatarUrl: r.user?.avatar_url },
          submittedAt: r.submitted_at,
        })),
      checks: ((checks as any)?.check_runs || []).map((c: any) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
        htmlUrl: c.html_url,
        startedAt: c.started_at,
        completedAt: c.completed_at,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to load pull request');
  }
};

export const getPullRequestDiff = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const diff = await client.getPullRequestDiff(owner, repo, parseInt(req.params.number, 10));
    return res.status(200).json({ diff });
  } catch (error) {
    return fail(res, error, 'Failed to fetch diff');
  }
};

export const mergePullRequest = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const number = parseInt(req.params.number, 10);
    const { method = 'squash', title, message, sha } = req.body;

    if (!['merge', 'squash', 'rebase'].includes(method)) {
      return res.status(400).json({ message: 'method must be merge, squash or rebase' });
    }

    const result = await client.mergePullRequest(owner, repo, number, {
      merge_method: method,
      commit_title: title,
      commit_message: message,
      sha,
    });

    return res.status(200).json({ merged: result.merged, sha: result.sha, message: result.message });
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 405) {
      return res.status(409).json({ message: error.message || 'This pull request is not mergeable right now.' });
    }
    return fail(res, error, 'Failed to merge pull request');
  }
};

export const createReview = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const { event = 'COMMENT', body } = req.body;

    if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) {
      return res.status(400).json({ message: 'event must be APPROVE, REQUEST_CHANGES or COMMENT' });
    }
    if (event !== 'APPROVE' && !body?.trim()) {
      return res.status(400).json({ message: 'A comment body is required for this review type' });
    }

    const review = await client.createReview(owner, repo, parseInt(req.params.number, 10), { event, body });
    return res.status(201).json({ id: review.id, state: review.state, htmlUrl: review.html_url });
  } catch (error) {
    return fail(res, error, 'Failed to submit review');
  }
};

export const createComment = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ message: 'Comment body is required' });

    const comment = await client.createIssueComment(owner, repo, parseInt(req.params.number, 10), body);
    return res.status(201).json({ id: comment.id, htmlUrl: comment.html_url, createdAt: comment.created_at });
  } catch (error) {
    return fail(res, error, 'Failed to post comment');
  }
};

export const listIssues = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const state = (req.query.state as 'open' | 'closed' | 'all') || 'open';
    const issues = await client.listIssues(owner, repo, state);

    return res.status(200).json({
      issues: issues
        .filter((i: any) => !i.pull_request)
        .map((i: any) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          author: { login: i.user?.login, avatarUrl: i.user?.avatar_url },
          htmlUrl: i.html_url,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
          comments: i.comments,
          labels: (i.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
        })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to list issues');
  }
};

export const createIssue = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const { title, body, labels } = req.body;
    if (!title?.trim()) return res.status(400).json({ message: 'Issue title is required' });

    const issue = await client.createIssue(owner, repo, {
      title: title.trim(),
      body,
      labels: Array.isArray(labels) ? labels : undefined,
    });

    return res.status(201).json({ number: issue.number, title: issue.title, htmlUrl: issue.html_url, state: issue.state });
  } catch (error) {
    return fail(res, error, 'Failed to create issue');
  }
};

export const updateIssueState = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const { state } = req.body;
    if (!['open', 'closed'].includes(state)) {
      return res.status(400).json({ message: 'state must be open or closed' });
    }

    const issue = await client.updateIssue(owner, repo, parseInt(req.params.number, 10), { state });
    return res.status(200).json({ number: issue.number, state: issue.state });
  } catch (error) {
    return fail(res, error, 'Failed to update issue');
  }
};

export const listCommits = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const commits = await client.listCommits(owner, repo, req.query.sha as string | undefined);

    return res.status(200).json({
      commits: commits.map((c: any) => ({
        sha: c.sha,
        message: (c.commit?.message || '').split('\n')[0],
        author: {
          login: c.author?.login || c.commit?.author?.name,
          avatarUrl: c.author?.avatar_url || '',
        },
        date: c.commit?.author?.date,
        htmlUrl: c.html_url,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to list commits');
  }
};

export const getCommitDetail = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo, sha } = req.params;
    const commit = await client.getCommit(owner, repo, sha);

    return res.status(200).json({
      sha: commit.sha,
      message: commit.commit?.message,
      author: { login: commit.author?.login || commit.commit?.author?.name, avatarUrl: commit.author?.avatar_url || '' },
      date: commit.commit?.author?.date,
      htmlUrl: commit.html_url,
      stats: commit.stats,
      files: (commit.files || []).map((f: any) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to load commit');
  }
};

export const listBranches = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const branches = await client.listBranches(owner, repo);
    return res.status(200).json({
      branches: branches.map((b: any) => ({ name: b.name, sha: b.commit?.sha, protected: b.protected })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to list branches');
  }
};

/** Directory listing for the in-chat file browser. */
export const browseTree = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const path = ((req.query.path as string) || '').replace(/^\/+/, '');
    const ref = req.query.ref as string | undefined;

    const contents = await client.getContents(owner, repo, path, ref);
    const entries = Array.isArray(contents) ? contents : [contents];

    return res.status(200).json({
      path,
      entries: entries
        .map((e: any) => ({ name: e.name, path: e.path, type: e.type, size: e.size, sha: e.sha }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)),
    });
  } catch (error) {
    return fail(res, error, 'Failed to browse repository');
  }
};

export const getFile = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const path = (req.query.path as string || '').replace(/^\/+/, '');
    if (!path) return res.status(400).json({ message: 'path query parameter is required' });

    const file = await client.getFileText(owner, repo, path, req.query.ref as string | undefined);
    return res.status(200).json({ path, ...file });
  } catch (error) {
    return fail(res, error, 'Failed to read file');
  }
};

/**
 * Commits an edit made from the chat. Either writes straight to a branch, or —
 * the safer default — cuts a new branch and opens a pull request for review.
 */
export const commitFile = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const {
      path,
      content,
      message,
      sha,
      branch,
      openPullRequest = false,
      newBranch,
      pullRequestTitle,
      pullRequestBody,
    } = req.body;

    if (!path || typeof content !== 'string' || !message?.trim()) {
      return res.status(400).json({ message: 'path, content and message are required' });
    }

    const repository = await client.getRepository(owner, repo);
    const baseBranch = branch || repository.default_branch;

    let targetBranch = baseBranch;
    let fileSha = sha;

    if (openPullRequest) {
      targetBranch = (newBranch || `synq/${slugify(message)}-${Date.now().toString(36)}`).slice(0, 100);
      const baseRef = await client.getRef(owner, repo, `heads/${baseBranch}`);
      await client.createBranch(owner, repo, targetBranch, baseRef.object.sha);

      // The blob sha differs per branch, so re-read it on the new branch.
      try {
        const existing = await client.getContents(owner, repo, path, targetBranch);
        fileSha = Array.isArray(existing) ? undefined : existing.sha;
      } catch {
        fileSha = undefined; // new file
      }
    }

    const commit = await client.putFile(owner, repo, path, {
      message: message.trim(),
      content,
      branch: targetBranch,
      sha: fileSha,
    });

    let pullRequest: any = null;
    if (openPullRequest) {
      pullRequest = await client.createPullRequest(owner, repo, {
        title: pullRequestTitle?.trim() || message.trim(),
        head: targetBranch,
        base: baseBranch,
        body: pullRequestBody || `Edited from a Synq conversation.\n\n\`${path}\``,
      });
    }

    return res.status(201).json({
      commit: { sha: commit.commit?.sha, htmlUrl: commit.commit?.html_url, message: commit.commit?.message },
      branch: targetBranch,
      pullRequest: pullRequest
        ? { number: pullRequest.number, title: pullRequest.title, htmlUrl: pullRequest.html_url }
        : null,
    });
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 409) {
      return res.status(409).json({ message: 'The file changed on GitHub since you opened it. Reload and reapply your edit.' });
    }
    return fail(res, error, 'Failed to commit change');
  }
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'edit';

export const searchCode = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const q = req.query.q as string;
    if (!q?.trim()) return res.status(400).json({ message: 'q query parameter is required' });

    const results = await client.searchCode(`${q} repo:${owner}/${repo}`);
    return res.status(200).json({
      total: results.total_count,
      results: (results.items || []).map((i: any) => ({
        path: i.path,
        name: i.name,
        htmlUrl: i.html_url,
        repository: i.repository?.full_name,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Code search failed');
  }
};

/** Recent webhook activity for the repositories linked to a chat. */
export const listChatActivity = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chatId } = req.params;
    if (!(await assertParticipant(chatId, req.user!.userId))) {
      return res.status(403).json({ message: 'Forbidden: You are not in this chat' });
    }

    const links = await prisma.chatRepository.findMany({ where: { chatId }, select: { repositoryId: true } });
    if (links.length === 0) return res.status(200).json({ events: [] });

    const events = await prisma.gitHubEvent.findMany({
      where: { repositoryId: { in: links.map((l) => l.repositoryId) } },
      include: { repository: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.status(200).json({
      events: events.map((e) => ({
        id: e.id,
        repoFullName: e.repository.fullName,
        eventType: e.eventType,
        action: e.action,
        actorLogin: e.actorLogin,
        actorAvatar: e.actorAvatar,
        title: e.title,
        summary: e.summary,
        url: e.url,
        tone: e.tone,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Failed to load repository activity');
  }
};

// ===========================================================================
// AI over repository context
// ===========================================================================

export const aiReviewPullRequest = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    if (!codeAi.isCodeAiAvailable()) {
      return res.status(503).json({ message: 'Code AI is unavailable. Set GEMINI_API_KEY or GROQ_API_KEY.' });
    }
    const { owner, repo } = req.params;
    const review = await codeAi.reviewPullRequest(client, owner, repo, parseInt(req.params.number, 10));
    return res.status(200).json(review);
  } catch (error) {
    return fail(res, error, 'AI review failed');
  }
};

export const aiSummarizePullRequest = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const summary = await codeAi.summarizePullRequest(client, owner, repo, parseInt(req.params.number, 10));
    return res.status(200).json({ summary });
  } catch (error) {
    return fail(res, error, 'AI summary failed');
  }
};

export const aiDescribePullRequest = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const number = parseInt(req.params.number, 10);
    const description = await codeAi.draftPullRequestDescription(client, owner, repo, number);

    if (req.body?.apply === true) {
      await client.updatePullRequest(owner, repo, number, { body: description });
    }

    return res.status(200).json({ description, applied: req.body?.apply === true });
  } catch (error) {
    return fail(res, error, 'AI description failed');
  }
};

export const aiExplainCommit = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo, sha } = req.params;
    const { question } = req.body || {};

    const [commit, diff] = await Promise.all([
      client.getCommit(owner, repo, sha),
      client.getCommitDiff(owner, repo, sha),
    ]);

    const explanation = await codeAi.explainDiff(
      diff,
      `Repository: ${owner}/${repo}\nCommit ${sha.slice(0, 7)} by ${commit.author?.login || commit.commit?.author?.name}: ${
        (commit.commit?.message || '').split('\n')[0]
      }`,
      question
    );

    return res.status(200).json({ explanation, sha, message: (commit.commit?.message || '').split('\n')[0] });
  } catch (error) {
    return fail(res, error, 'AI explanation failed');
  }
};

export const aiAskRepo = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const { question } = req.body;
    if (!question?.trim()) return res.status(400).json({ message: 'question is required' });

    const result = await codeAi.answerRepoQuestion(client, owner, repo, question.trim());
    return res.status(200).json(result);
  } catch (error) {
    return fail(res, error, 'AI repository question failed');
  }
};

export const aiDraftIssue = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const { transcript, create = false } = req.body;
    if (!transcript?.trim()) return res.status(400).json({ message: 'transcript is required' });

    const draft = await codeAi.draftIssueFromDiscussion(transcript, `${owner}/${repo}`);

    if (create) {
      const issue = await client.createIssue(owner, repo, draft);
      return res.status(201).json({
        draft,
        issue: { number: issue.number, title: issue.title, htmlUrl: issue.html_url, state: issue.state },
      });
    }

    return res.status(200).json({ draft, issue: null });
  } catch (error) {
    return fail(res, error, 'AI issue draft failed');
  }
};

export const aiProposeEdit = async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req, res);
  if (!client) return;

  try {
    const { owner, repo } = req.params;
    const { path, ref, instruction } = req.body;
    if (!path || !instruction?.trim()) {
      return res.status(400).json({ message: 'path and instruction are required' });
    }

    const file = await client.getFileText(owner, repo, path.replace(/^\/+/, ''), ref);
    const proposal = await codeAi.proposeCodeEdit(path, file.text, instruction.trim());

    return res.status(200).json({
      path,
      original: file.text,
      proposed: proposal.content,
      explanation: proposal.explanation,
      sha: file.sha,
    });
  } catch (error) {
    return fail(res, error, 'AI edit proposal failed');
  }
};

export const aiCommitMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { path, before, after } = req.body;
    if (!path || typeof after !== 'string') {
      return res.status(400).json({ message: 'path and after are required' });
    }

    const message = await codeAi.generateCommitMessage(path, before || '', after);
    return res.status(200).json({ message });
  } catch (error) {
    return fail(res, error, 'Commit message generation failed');
  }
};

// ===========================================================================
// Webhooks
// ===========================================================================

interface NormalisedEvent {
  action?: string;
  actorLogin?: string;
  actorAvatar?: string;
  title?: string;
  summary?: string;
  url?: string;
  tone: 'open' | 'merged' | 'closed' | 'draft' | 'success' | 'failure' | 'neutral';
}

/** Flattens a GitHub webhook payload into the single shape the chat renders. */
export const normaliseWebhookEvent = (eventType: string, payload: any): NormalisedEvent => {
  const sender = payload?.sender;
  const actor = { actorLogin: sender?.login, actorAvatar: sender?.avatar_url };

  switch (eventType) {
    case 'pull_request': {
      const pr = payload.pull_request;
      const merged = payload.action === 'closed' && pr?.merged;
      return {
        ...actor,
        action: merged ? 'merged' : payload.action,
        title: pr?.title,
        summary: `${merged ? 'merged' : payload.action} pull request #${pr?.number} (${pr?.head?.ref} → ${pr?.base?.ref})`,
        url: pr?.html_url,
        tone: merged ? 'merged' : payload.action === 'closed' ? 'closed' : pr?.draft ? 'draft' : 'open',
      };
    }

    case 'pull_request_review': {
      const state = payload.review?.state;
      return {
        ...actor,
        action: state,
        title: payload.pull_request?.title,
        summary: `${state === 'approved' ? 'approved' : state === 'changes_requested' ? 'requested changes on' : 'reviewed'} #${payload.pull_request?.number}`,
        url: payload.review?.html_url,
        tone: state === 'approved' ? 'success' : state === 'changes_requested' ? 'failure' : 'neutral',
      };
    }

    case 'issues':
      return {
        ...actor,
        action: payload.action,
        title: payload.issue?.title,
        summary: `${payload.action} issue #${payload.issue?.number}`,
        url: payload.issue?.html_url,
        tone: payload.action === 'closed' ? 'closed' : 'open',
      };

    case 'issue_comment':
      return {
        ...actor,
        action: payload.action,
        title: payload.issue?.title,
        summary: `commented on #${payload.issue?.number}: ${(payload.comment?.body || '').slice(0, 120)}`,
        url: payload.comment?.html_url,
        tone: 'neutral',
      };

    case 'push': {
      const commits = payload.commits || [];
      const branch = (payload.ref || '').replace('refs/heads/', '');
      return {
        actorLogin: payload.pusher?.name || sender?.login,
        actorAvatar: sender?.avatar_url,
        action: 'push',
        title: commits[0]?.message?.split('\n')[0] || `${commits.length} commits`,
        summary: `pushed ${commits.length} commit${commits.length === 1 ? '' : 's'} to ${branch}`,
        url: payload.compare,
        tone: 'neutral',
      };
    }

    case 'check_suite':
    case 'workflow_run': {
      const run = payload.workflow_run || payload.check_suite;
      const conclusion = run?.conclusion;
      if (run?.status !== 'completed') {
        return { ...actor, action: run?.status, title: run?.name, summary: `CI ${run?.status}`, url: run?.html_url, tone: 'neutral' };
      }
      return {
        ...actor,
        action: conclusion,
        title: run?.name || 'CI',
        summary: `CI ${conclusion} on ${run?.head_branch}`,
        url: run?.html_url,
        tone: conclusion === 'success' ? 'success' : 'failure',
      };
    }

    case 'release':
      return {
        ...actor,
        action: payload.action,
        title: payload.release?.name || payload.release?.tag_name,
        summary: `${payload.action} release ${payload.release?.tag_name}`,
        url: payload.release?.html_url,
        tone: 'success',
      };

    default:
      return { ...actor, action: payload.action, title: eventType, summary: eventType, tone: 'neutral' };
  }
};

/**
 * Receives a GitHub webhook for one chat↔repo link. Mounted with a raw body
 * parser so the HMAC signature can be verified against the exact bytes sent.
 */
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const { linkId } = req.params;
    const eventType = req.header('x-github-event') || 'unknown';

    if (eventType === 'ping') return res.status(200).json({ pong: true });

    const link = await prisma.chatRepository.findUnique({
      where: { id: linkId },
      include: { repository: true },
    });

    if (!link || !link.webhookSecret) {
      return res.status(404).json({ message: 'Unknown webhook' });
    }

    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    let secret: string;
    try {
      secret = decryptSecret(link.webhookSecret);
    } catch {
      return res.status(500).json({ message: 'Webhook secret is unreadable' });
    }

    if (!verifyGithubSignature(rawBody, req.header('x-hub-signature-256'), secret)) {
      return res.status(401).json({ message: 'Invalid signature' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));

    const allowed = link.notifyEvents.split(',').map((e) => e.trim());
    if (allowed.length > 0 && !allowed.includes(eventType)) {
      return res.status(202).json({ ignored: true });
    }

    const normalised = normaliseWebhookEvent(eventType, payload);

    await prisma.gitHubEvent.create({
      data: {
        repositoryId: link.repositoryId,
        eventType,
        action: normalised.action,
        actorLogin: normalised.actorLogin,
        actorAvatar: normalised.actorAvatar,
        title: normalised.title,
        summary: normalised.summary,
        url: normalised.url,
        tone: normalised.tone,
        payload: payload as any,
      },
    });

    // Every chat linked to this repository sees the event, not just this link.
    const chatLinks = await prisma.chatRepository.findMany({
      where: { repositoryId: link.repositoryId },
      select: { chatId: true },
    });

    eventBus
      .publish('github.event', {
        repositoryId: link.repositoryId,
        repoFullName: link.repository.fullName,
        chatIds: chatLinks.map((l) => l.chatId),
        eventType,
        ...normalised,
      })
      .catch(console.error);

    return res.status(202).json({ received: true });
  } catch (error) {
    console.error('[GitHub] Webhook handling failed:', error);
    return res.status(500).json({ message: 'Webhook handling failed' });
  }
};
