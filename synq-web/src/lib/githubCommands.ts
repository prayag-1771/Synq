import { githubService, LinkedRepo } from '../services/githubService';
import { localDb } from '../db/localDb';

export interface GithubCommandContext {
  connected: boolean;
  repos: LinkedRepo[];
}

export const GITHUB_COMMANDS = ['/pr', '/review', '/commit', '/issue', '/gh', '/repo'] as const;

/**
 * Slash commands that reach into the repository linked to a conversation.
 *
 * Each returns markdown that the chat writes back into the placeholder AI
 * message. Responses deliberately end with a bare reference (`owner/repo#123`)
 * so the message renderer unfurls it into a live, actionable card.
 */
export const runGithubCommand = async (
  command: string,
  args: string,
  chatId: string,
  ctx: GithubCommandContext
): Promise<string> => {
  if (!ctx.connected) {
    return 'Connect a GitHub account first — open the GitHub panel from the conversation header.';
  }

  const primary = ctx.repos.find((r) => r.isPrimary) || ctx.repos[0];
  if (!primary) {
    return 'No repository is linked to this conversation. Open the GitHub panel and link one to use `/pr`, `/review` and `/gh`.';
  }

  const { owner, name: repo, fullName } = primary;

  switch (command) {
    case '/repo': {
      const lines = ctx.repos.map(
        (r) =>
          `${r.isPrimary ? '★' : '·'} **${r.fullName}** — default branch \`${r.defaultBranch}\`` +
          `${r.webhookActive ? ' · live activity on' : ''}`
      );
      return (
        `**Linked repositories**\n\n${lines.join('\n')}\n\n` +
        `Shorthand resolves against **${fullName}** — try \`#123\`, \`@abc1234\`, or \`src/services/socket.ts:40-60\`.`
      );
    }

    case '/pr': {
      const number = parseInt(args.replace('#', '').trim(), 10);
      if (!number) return 'Usage: `/pr <number>` — for example `/pr 412`';

      const summary = await githubService.aiSummarizePullRequest(owner, repo, number);
      return `${summary}\n\n${owner}/${repo}#${number}`;
    }

    case '/review': {
      const number = parseInt(args.replace('#', '').trim(), 10);
      if (!number) return 'Usage: `/review <number>` — runs an AI review over the real diff';

      const review = await githubService.aiReviewPullRequest(owner, repo, number);
      const parts: string[] = [
        `**AI review — ${fullName}#${number}** *(${review.verdict.replace('_', ' ')})*`,
        '',
        review.summary,
      ];

      if (review.findings.length > 0) {
        parts.push('', '**Findings**');
        for (const finding of review.findings) {
          const location = `${finding.file}${finding.line ? `:${finding.line}` : ''}`;
          parts.push('', `[${finding.severity}] \`${location}\` — **${finding.title}**`, finding.detail);
          if (finding.suggestion) parts.push(`→ ${finding.suggestion}`);
        }
      } else {
        parts.push('', 'No defects found in the diff.');
      }

      if (review.testGaps.length > 0) {
        parts.push('', '**Untested behaviour**', ...review.testGaps.map((gap) => `• ${gap}`));
      }

      parts.push('', `${owner}/${repo}#${number}`);
      return parts.join('\n');
    }

    case '/commit': {
      const sha = args.trim().replace(/^@/, '');
      if (!sha) return 'Usage: `/commit <sha>` — explains what a commit actually changed';

      const result = await githubService.aiExplainCommit(owner, repo, sha);
      return `**${result.message}**\n\n${result.explanation}\n\n${owner}/${repo}@${sha.slice(0, 7)}`;
    }

    case '/issue': {
      const recent = (await localDb.messages.where('chatId').equals(chatId).sortBy('createdAt'))
        .filter((m) => m.senderId !== 'SYSTEM_AI')
        .slice(-40);

      if (recent.length === 0) return 'There is nothing in this conversation to turn into an issue yet.';

      const transcript = recent.map((m) => `${m.senderName}: ${m.content}`).join('\n');
      const result = await githubService.aiDraftIssue(owner, repo, transcript, true);

      if (!result.issue) return 'The issue draft came back empty — try again with more context in the conversation.';
      return (
        `Opened **${fullName}#${result.issue.number}** — ${result.issue.title}\n\n` +
        `${owner}/${repo}#${result.issue.number}`
      );
    }

    case '/gh': {
      if (!args) return 'Usage: `/gh <question>` — e.g. `/gh where do we verify the webhook signature?`';

      const result = await githubService.aiAskRepo(owner, repo, args);
      const sources =
        result.sources.length > 0
          ? `\n\n*Read from:* ${result.sources.map((src) => `\`${src.path}\``).join(', ')}`
          : '';
      return `${result.answer}${sources}`;
    }

    default:
      return 'Unknown GitHub command.';
  }
};
