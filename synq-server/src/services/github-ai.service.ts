import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { GitHubClient } from './github.service';

const geminiKey = process.env.GEMINI_API_KEY;
const groqKey = process.env.GROQ_API_KEY;

const hasGemini = Boolean(geminiKey && geminiKey !== 'dummy_key');
const hasGroq = Boolean(groqKey && groqKey !== 'dummy_key');

export const isCodeAiAvailable = () => hasGemini || hasGroq;

const genAI = hasGemini ? new GoogleGenerativeAI(geminiKey!) : null;
const groq = hasGroq ? new Groq({ apiKey: groqKey! }) : null;

/**
 * Runs a prompt through the best available model. Gemini handles the long
 * diff-shaped context; Groq is the fallback when only it is configured.
 */
const complete = async (prompt: string, opts: { json?: boolean; temperature?: number } = {}): Promise<string> => {
  const { json = false, temperature = 0.2 } = opts;

  if (genAI) {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  }

  if (groq) {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature,
      ...(json ? { response_format: { type: 'json_object' as const } } : {}),
    });
    return (completion.choices[0]?.message?.content || '').trim();
  }

  throw new Error('No AI provider configured. Set GEMINI_API_KEY or GROQ_API_KEY.');
};

/** Strips markdown fences some models wrap JSON in. */
const parseJson = <T>(raw: string, fallback: T): T => {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
};

const MAX_DIFF_CHARS = 60_000;

/**
 * Caps a unified diff at a token budget while keeping every file's header, so
 * the model still sees the full shape of the change even when bodies are cut.
 */
export const truncateDiff = (diff: string, budget = MAX_DIFF_CHARS): string => {
  if (diff.length <= budget) return diff;

  const perFile = diff.split(/^diff --git /m).filter(Boolean);
  const share = Math.max(1200, Math.floor(budget / Math.max(perFile.length, 1)));

  const trimmed = perFile.map((chunk) => {
    const body = `diff --git ${chunk}`;
    if (body.length <= share) return body;
    const lines = body.split('\n');
    const kept = lines.slice(0, Math.max(20, Math.floor(share / 60)));
    return `${kept.join('\n')}\n… [${lines.length - kept.length} more lines truncated]`;
  });

  const joined = trimmed.join('\n');
  return joined.length > budget ? `${joined.slice(0, budget)}\n… [diff truncated]` : joined;
};

export interface ReviewFinding {
  severity: 'critical' | 'major' | 'minor' | 'nit';
  file: string;
  line?: number;
  title: string;
  detail: string;
  suggestion?: string;
}

export interface PullRequestReview {
  verdict: 'approve' | 'comment' | 'request_changes';
  summary: string;
  findings: ReviewFinding[];
  testGaps: string[];
}

/**
 * Reviews a pull request diff and returns structured findings that the chat UI
 * renders as a checklist and can post back to GitHub as a formal review.
 */
export const reviewPullRequest = async (
  client: GitHubClient,
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestReview> => {
  const [pull, diff] = await Promise.all([
    client.getPullRequest(owner, repo, number),
    client.getPullRequestDiff(owner, repo, number),
  ]);

  const prompt = `You are a meticulous senior engineer reviewing a pull request. Report only defects you can justify from the diff — no style preferences, no speculation, no praise.

Repository: ${owner}/${repo}
Pull request #${number}: ${pull.title}
Author: ${pull.user?.login}
Branch: ${pull.head?.ref} → ${pull.base?.ref}
Description: ${(pull.body || '(none)').slice(0, 1500)}

Unified diff:
${truncateDiff(diff)}

Return JSON exactly in this shape:
{
  "verdict": "approve" | "comment" | "request_changes",
  "summary": "2-3 sentences on what this PR does and whether it is safe to merge",
  "findings": [
    {
      "severity": "critical" | "major" | "minor" | "nit",
      "file": "path/from/the/diff.ts",
      "line": 42,
      "title": "short defect statement",
      "detail": "why it is wrong and what breaks, referencing the diff",
      "suggestion": "concrete fix (optional)"
    }
  ],
  "testGaps": ["behaviour changed by this PR that no test covers"]
}

Rules:
- "critical" means data loss, a security hole, or a guaranteed crash on a normal path.
- Only cite files and lines that appear in the diff.
- An empty findings array is the correct answer for a clean PR.`;

  const raw = await complete(prompt, { json: true, temperature: 0.1 });
  const parsed = parseJson<PullRequestReview>(raw, {
    verdict: 'comment',
    summary: 'The reviewer could not parse a structured response for this pull request.',
    findings: [],
    testGaps: [],
  });

  return {
    verdict: parsed.verdict || 'comment',
    summary: parsed.summary || '',
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    testGaps: Array.isArray(parsed.testGaps) ? parsed.testGaps : [],
  };
};

/**
 * Plain-language explanation of a pull request: what changed, why it matters,
 * and what a reviewer should look at first.
 */
export const summarizePullRequest = async (
  client: GitHubClient,
  owner: string,
  repo: string,
  number: number
): Promise<string> => {
  const [pull, files] = await Promise.all([
    client.getPullRequest(owner, repo, number),
    client.getPullRequestFiles(owner, repo, number).catch(() => [] as any[]),
  ]);

  const diff = await client.getPullRequestDiff(owner, repo, number).catch(() => '');

  const fileList = files
    .slice(0, 40)
    .map((f: any) => `- ${f.filename} (+${f.additions}/-${f.deletions}, ${f.status})`)
    .join('\n');

  const prompt = `Explain this pull request to a teammate who has not read the code. Be specific and concrete — name the actual functions and behaviours that changed.

Repository: ${owner}/${repo}
PR #${number}: ${pull.title} by ${pull.user?.login}
State: ${pull.merged ? 'merged' : pull.state}${pull.draft ? ' (draft)' : ''}
Branch: ${pull.head?.ref} → ${pull.base?.ref}
Size: +${pull.additions}/-${pull.deletions} across ${pull.changed_files} files
Description: ${(pull.body || '(none)').slice(0, 1200)}

Files changed:
${fileList}

Diff:
${truncateDiff(diff, 40_000)}

Respond in markdown with exactly these sections:
**What changed** — 2-4 bullets naming real functions/files.
**Why it matters** — 1-2 sentences on the user-visible or operational effect.
**Review focus** — the single riskiest part and what to check.
Keep the whole response under 200 words. No preamble.`;

  return complete(prompt, { temperature: 0.3 });
};

/** Explains a single commit or an arbitrary diff, optionally answering a question about it. */
export const explainDiff = async (diff: string, context: string, question?: string): Promise<string> => {
  const prompt = `You are explaining a code change to a teammate in a chat conversation.

${context}

Diff:
${truncateDiff(diff, 40_000)}

${question ? `Answer this specific question about the change: ${question}` : 'Explain what this change does and why, in under 150 words.'}
Use markdown. Reference concrete file and function names. No preamble.`;

  return complete(prompt, { temperature: 0.3 });
};

/** Drafts a PR description from the actual diff, for PRs opened with an empty body. */
export const draftPullRequestDescription = async (
  client: GitHubClient,
  owner: string,
  repo: string,
  number: number
): Promise<string> => {
  const [pull, diff] = await Promise.all([
    client.getPullRequest(owner, repo, number),
    client.getPullRequestDiff(owner, repo, number),
  ]);

  const prompt = `Write the pull request description for this change.

Title: ${pull.title}
Branch: ${pull.head?.ref} → ${pull.base?.ref}

Diff:
${truncateDiff(diff, 40_000)}

Produce markdown with these sections and nothing else:
## Summary
(2-3 sentences)
## Changes
(bulleted, one line per meaningful change, naming files)
## Testing
(what a reviewer should run or check)

Be factual — describe only what the diff actually does.`;

  return complete(prompt, { temperature: 0.3 });
};

/** Generates a conventional-commit message for an edit made from the chat UI. */
export const generateCommitMessage = async (path: string, before: string, after: string): Promise<string> => {
  const prompt = `Write a single-line conventional commit message (max 72 chars) for this edit to ${path}.

BEFORE:
${before.slice(0, 6000)}

AFTER:
${after.slice(0, 6000)}

Respond with the commit message only — no quotes, no explanation, no trailing period.`;

  const message = await complete(prompt, { temperature: 0.2 });
  return message.split('\n')[0].replace(/^["'`]|["'`]$/g, '').slice(0, 100);
};

export interface DraftedIssue {
  title: string;
  body: string;
  labels: string[];
}

/**
 * Converts a chat discussion into a well-formed GitHub issue. This is the
 * "we talked about it, now make it real" path that Slack has no answer for.
 */
export const draftIssueFromDiscussion = async (transcript: string, repoFullName: string): Promise<DraftedIssue> => {
  const prompt = `Turn this team chat discussion into a GitHub issue for the repository ${repoFullName}.

Discussion:
${transcript.slice(0, 12000)}

Return JSON:
{
  "title": "imperative, specific, under 80 chars",
  "body": "markdown with ## Context, ## Problem, ## Proposed approach, ## Acceptance criteria — using only facts stated in the discussion",
  "labels": ["bug" | "enhancement" | "documentation" | "question" | other sensible labels]
}

Do not invent requirements that nobody mentioned. If something is unresolved, list it under an '## Open questions' section instead of guessing.`;

  const raw = await complete(prompt, { json: true, temperature: 0.3 });
  const parsed = parseJson<DraftedIssue>(raw, {
    title: 'Issue drafted from Synq discussion',
    body: transcript.slice(0, 4000),
    labels: [],
  });

  return {
    title: (parsed.title || 'Issue from Synq discussion').slice(0, 120),
    body: parsed.body || '',
    labels: Array.isArray(parsed.labels) ? parsed.labels.slice(0, 6) : [],
  };
};

/**
 * Repo-aware question answering. Uses GitHub code search to pull the most
 * relevant files, then reasons over their real contents — so answers cite code
 * that actually exists rather than plausible-looking invention.
 */
export const answerRepoQuestion = async (
  client: GitHubClient,
  owner: string,
  repo: string,
  question: string
): Promise<{ answer: string; sources: { path: string; url: string }[] }> => {
  // 1. Ask the model for search terms rather than searching the raw question.
  const termsRaw = await complete(
    `A developer asked: "${question}"

Give 1-3 GitHub code-search keywords most likely to appear in the source files that answer it (identifiers, function names, config keys — not English prose).
Return JSON: {"terms": ["term1", "term2"]}`,
    { json: true, temperature: 0.1 }
  );
  const { terms } = parseJson<{ terms: string[] }>(termsRaw, { terms: [question.split(/\s+/).slice(0, 3).join(' ')] });

  // 2. Fetch matching files.
  const sources: { path: string; url: string; text: string }[] = [];
  for (const term of (terms || []).slice(0, 3)) {
    try {
      const results = await client.searchCode(`${term} repo:${owner}/${repo}`, 4);
      for (const item of results.items || []) {
        if (sources.some((s) => s.path === item.path)) continue;
        try {
          const file = await client.getFileText(owner, repo, item.path);
          sources.push({ path: item.path, url: item.html_url, text: file.text.slice(0, 12000) });
        } catch {
          /* binary or too large — skip */
        }
        if (sources.length >= 6) break;
      }
    } catch {
      /* search unavailable for this term */
    }
    if (sources.length >= 6) break;
  }

  if (sources.length === 0) {
    return {
      answer: `I could not find code in **${owner}/${repo}** matching that question. Try naming a file, function, or symbol directly.`,
      sources: [],
    };
  }

  const context = sources
    .map((s) => `--- FILE: ${s.path} ---\n${s.text}`)
    .join('\n\n');

  const answer = await complete(
    `Answer the developer's question using ONLY the repository files below. Cite file paths inline as \`path/to/file.ts\`. If the files do not contain the answer, say so plainly.

Repository: ${owner}/${repo}
Question: ${question}

${context}

Answer in markdown, under 250 words. Be concrete: name functions, line behaviour, and actual values.`,
    { temperature: 0.2 }
  );

  return { answer, sources: sources.map(({ path, url }) => ({ path, url })) };
};

/**
 * Proposes an edit to a file from a natural-language instruction and returns
 * the full new file content, ready to be committed or opened as a PR.
 */
export const proposeCodeEdit = async (
  path: string,
  currentContent: string,
  instruction: string
): Promise<{ content: string; explanation: string }> => {
  const prompt = `You are editing a file in a real repository. Apply the requested change and return the COMPLETE updated file.

File: ${path}
Instruction: ${instruction}

Current content:
${currentContent.slice(0, 40000)}

Return JSON:
{
  "content": "the complete updated file content, byte-for-byte, with the change applied",
  "explanation": "one or two sentences describing exactly what you changed"
}

Rules:
- Preserve the file's existing indentation, quote style and conventions.
- Change only what the instruction requires; leave every other line untouched.
- Never truncate the file or replace omitted regions with comments.`;

  const raw = await complete(prompt, { json: true, temperature: 0.1 });
  const parsed = parseJson<{ content: string; explanation: string }>(raw, {
    content: '',
    explanation: '',
  });

  if (!parsed.content) {
    throw new Error('The model did not return a usable file. Try a more specific instruction.');
  }

  return parsed;
};
