import { Router } from 'express';
import express from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import * as github from '../controllers/github.controller';

const router = Router();

// Everything below requires an authenticated Synq user. GitHub authorisation is
// then enforced by the user's own token — you can only see what GitHub lets you.
router.use(authenticateJWT);

// --- Account connection ----------------------------------------------------
router.get('/status', github.getStatus);
router.post('/connect', github.connectWithToken);
router.get('/oauth/url', github.getOAuthUrl);
router.post('/oauth/callback', github.completeOAuth);
router.delete('/disconnect', github.disconnect);

// --- Repository links ------------------------------------------------------
router.get('/repos', github.listUserRepositories);
router.get('/chats/:chatId/repos', github.listChatRepositories);
router.post('/chats/:chatId/repos', github.linkRepository);
router.put('/chats/:chatId/repos/:repositoryId', github.updateRepositoryLink);
router.delete('/chats/:chatId/repos/:repositoryId', github.unlinkRepository);
router.get('/chats/:chatId/activity', github.listChatActivity);

// --- Reference resolution --------------------------------------------------
router.post('/resolve', github.resolveReferences);

// --- Pull requests ---------------------------------------------------------
router.get('/repos/:owner/:repo/pulls', github.listPullRequests);
router.get('/repos/:owner/:repo/pulls/:number', github.getPullRequestDetail);
router.get('/repos/:owner/:repo/pulls/:number/diff', github.getPullRequestDiff);
router.post('/repos/:owner/:repo/pulls/:number/merge', github.mergePullRequest);
router.post('/repos/:owner/:repo/pulls/:number/review', github.createReview);
router.post('/repos/:owner/:repo/pulls/:number/comment', github.createComment);

// --- Issues ----------------------------------------------------------------
router.get('/repos/:owner/:repo/issues', github.listIssues);
router.get('/repos/:owner/:repo/issues/:number', github.getPullRequestDetail);
router.post('/repos/:owner/:repo/issues', github.createIssue);
router.put('/repos/:owner/:repo/issues/:number/state', github.updateIssueState);
router.post('/repos/:owner/:repo/issues/:number/comment', github.createComment);

// --- Commits, branches, files ----------------------------------------------
router.get('/repos/:owner/:repo/commits', github.listCommits);
router.get('/repos/:owner/:repo/commits/:sha', github.getCommitDetail);
router.get('/repos/:owner/:repo/branches', github.listBranches);
router.get('/repos/:owner/:repo/tree', github.browseTree);
router.get('/repos/:owner/:repo/file', github.getFile);
router.put('/repos/:owner/:repo/file', github.commitFile);
router.get('/repos/:owner/:repo/search', github.searchCode);

// --- AI over repository context --------------------------------------------
router.post('/repos/:owner/:repo/ai/pulls/:number/review', github.aiReviewPullRequest);
router.post('/repos/:owner/:repo/ai/pulls/:number/summary', github.aiSummarizePullRequest);
router.post('/repos/:owner/:repo/ai/pulls/:number/describe', github.aiDescribePullRequest);
router.post('/repos/:owner/:repo/ai/commits/:sha/explain', github.aiExplainCommit);
router.post('/repos/:owner/:repo/ai/ask', github.aiAskRepo);
router.post('/repos/:owner/:repo/ai/draft-issue', github.aiDraftIssue);
router.post('/repos/:owner/:repo/ai/propose-edit', github.aiProposeEdit);
router.post('/repos/:owner/:repo/ai/commit-message', github.aiCommitMessage);

export default router;

/**
 * Webhook receiver. Mounted separately (and before the JSON body parser) so the
 * raw bytes survive for HMAC signature verification.
 */
export const githubWebhookRouter = Router();
githubWebhookRouter.post(
  '/webhook/:linkId',
  express.raw({ type: 'application/json', limit: '5mb' }),
  github.handleWebhook
);
