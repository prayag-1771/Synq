/**
 * Git reference parser.
 *
 * Extracts GitHub references out of free-form chat text so a message like
 *   "the regression came from #412, look at src/db/redis.ts:40-58"
 * becomes a set of structured, resolvable references.
 *
 * This runs in the browser on purpose. Direct messages are end-to-end
 * encrypted, so plaintext exists only here — the server receives the extracted
 * reference tokens (owner/repo/number), never the message itself.
 *
 * Mirrored from `synq-server/src/utils/gitRefParser.ts`; keep the two in sync.
 */

export type GitRefKind =
  | 'pull'
  | 'issue'
  | 'commit'
  | 'file'
  | 'repo'
  | 'compare'
  | 'branch'
  | 'run';

export interface ParsedGitRef {
  /** Exact source text that produced this reference. */
  raw: string;
  /** Character offset of `raw` within the source string. */
  index: number;
  kind: GitRefKind;
  owner: string;
  repo: string;
  number?: number;
  sha?: string;
  path?: string;
  /** Branch, tag or sha a file path is pinned to. */
  ref?: string;
  startLine?: number;
  endLine?: number;
  base?: string;
  head?: string;
  runId?: number;
  /** Stable identity used for caching + de-duplication. */
  key: string;
}

export interface DefaultRepo {
  owner: string;
  repo: string;
}

export const buildRefKey = (ref: Omit<ParsedGitRef, 'key' | 'raw' | 'index'>): string => {
  const base = `${ref.owner}/${ref.repo}`;
  switch (ref.kind) {
    case 'pull':
      return `pull:${base}#${ref.number}`;
    case 'issue':
      return `issue:${base}#${ref.number}`;
    case 'commit':
      return `commit:${base}@${ref.sha}`;
    case 'file':
      return `file:${base}:${ref.ref || 'HEAD'}:${ref.path}:${ref.startLine || ''}-${ref.endLine || ''}`;
    case 'compare':
      return `compare:${base}:${ref.base}...${ref.head}`;
    case 'branch':
      return `branch:${base}:${ref.ref}`;
    case 'run':
      return `run:${base}:${ref.runId}`;
    default:
      return `repo:${base}`;
  }
};

/**
 * Replaces the interior of fenced blocks and inline code spans with spaces so
 * that a `#123` inside a code sample is never mistaken for an issue reference.
 * Offsets of the surrounding text are preserved.
 */
export const maskCodeSpans = (text: string): string => {
  const blank = (match: string) => ' '.repeat(match.length);
  return text
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank);
};

interface Matcher {
  pattern: RegExp;
  /** Higher wins when two matches overlap. */
  priority: number;
  build: (m: RegExpExecArray, defaultRepo?: DefaultRepo) => Omit<ParsedGitRef, 'raw' | 'index' | 'key'> | null;
}

const HOST = 'https?:\\/\\/(?:www\\.)?github\\.com';
const SEG = '[\\w.-]+';

const MATCHERS: Matcher[] = [
  // https://github.com/owner/repo/pull/123
  {
    pattern: new RegExp(`${HOST}\\/(${SEG})\\/(${SEG})\\/pull\\/(\\d+)(?:\\/[\\w]*)?(?:#[\\w-]+)?`, 'g'),
    priority: 100,
    build: (m) => ({ kind: 'pull', owner: m[1], repo: m[2], number: parseInt(m[3], 10) }),
  },
  // https://github.com/owner/repo/issues/123
  {
    pattern: new RegExp(`${HOST}\\/(${SEG})\\/(${SEG})\\/issues\\/(\\d+)(?:#[\\w-]+)?`, 'g'),
    priority: 100,
    build: (m) => ({ kind: 'issue', owner: m[1], repo: m[2], number: parseInt(m[3], 10) }),
  },
  // https://github.com/owner/repo/commit/<sha>
  {
    pattern: new RegExp(`${HOST}\\/(${SEG})\\/(${SEG})\\/commits?\\/([0-9a-f]{7,40})`, 'g'),
    priority: 100,
    build: (m) => ({ kind: 'commit', owner: m[1], repo: m[2], sha: m[3] }),
  },
  // https://github.com/owner/repo/blob/<ref>/<path>#L10-L20
  {
    pattern: new RegExp(
      `${HOST}\\/(${SEG})\\/(${SEG})\\/blob\\/([^\\/\\s]+)\\/([^\\s#?]+)(?:#L(\\d+)(?:-L(\\d+))?)?`,
      'g'
    ),
    priority: 100,
    build: (m) => ({
      kind: 'file',
      owner: m[1],
      repo: m[2],
      ref: m[3],
      path: m[4],
      startLine: m[5] ? parseInt(m[5], 10) : undefined,
      endLine: m[6] ? parseInt(m[6], 10) : undefined,
    }),
  },
  // https://github.com/owner/repo/compare/base...head
  {
    pattern: new RegExp(`${HOST}\\/(${SEG})\\/(${SEG})\\/compare\\/([^\\s]+?)\\.\\.\\.([^\\s#?]+)`, 'g'),
    priority: 100,
    build: (m) => ({ kind: 'compare', owner: m[1], repo: m[2], base: m[3], head: m[4] }),
  },
  // https://github.com/owner/repo/actions/runs/123456
  {
    pattern: new RegExp(`${HOST}\\/(${SEG})\\/(${SEG})\\/actions\\/runs\\/(\\d+)`, 'g'),
    priority: 100,
    build: (m) => ({ kind: 'run', owner: m[1], repo: m[2], runId: parseInt(m[3], 10) }),
  },
  // https://github.com/owner/repo/tree/branch
  {
    pattern: new RegExp(`${HOST}\\/(${SEG})\\/(${SEG})\\/tree\\/([^\\s#?]+)`, 'g'),
    priority: 100,
    build: (m) => ({ kind: 'branch', owner: m[1], repo: m[2], ref: m[3] }),
  },
  // https://github.com/owner/repo
  {
    pattern: new RegExp(`${HOST}\\/(${SEG})\\/(${SEG})\\/?(?![\\w\\/])`, 'g'),
    priority: 50,
    build: (m) => ({ kind: 'repo', owner: m[1], repo: m[2] }),
  },
  // owner/repo#123
  {
    pattern: new RegExp(`(?:^|[\\s(\\[])(${SEG})\\/(${SEG})#(\\d+)\\b`, 'g'),
    priority: 80,
    build: (m) => ({ kind: 'issue', owner: m[1], repo: m[2], number: parseInt(m[3], 10) }),
  },
  // owner/repo@<sha>
  {
    pattern: new RegExp(`(?:^|[\\s(\\[])(${SEG})\\/(${SEG})@([0-9a-f]{7,40})\\b`, 'g'),
    priority: 80,
    build: (m) => ({ kind: 'commit', owner: m[1], repo: m[2], sha: m[3] }),
  },
  // src/services/socket.ts:42-88 — a line range in the linked repo
  {
    pattern: /(?:^|[\s(\[])((?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]{1,10}):(\d+)(?:-(\d+))?\b/g,
    priority: 60,
    build: (m, defaultRepo) =>
      defaultRepo
        ? {
            kind: 'file' as const,
            owner: defaultRepo.owner,
            repo: defaultRepo.repo,
            path: m[1],
            startLine: parseInt(m[2], 10),
            endLine: m[3] ? parseInt(m[3], 10) : undefined,
          }
        : null,
  },
  // #123 — resolved against the repo linked to the conversation
  {
    pattern: /(?:^|[\s(\[])#(\d+)\b/g,
    priority: 40,
    build: (m, defaultRepo) =>
      defaultRepo
        ? { kind: 'issue' as const, owner: defaultRepo.owner, repo: defaultRepo.repo, number: parseInt(m[1], 10) }
        : null,
  },
  // GH-123
  {
    pattern: /(?:^|[\s(\[])GH-(\d+)\b/g,
    priority: 40,
    build: (m, defaultRepo) =>
      defaultRepo
        ? { kind: 'issue' as const, owner: defaultRepo.owner, repo: defaultRepo.repo, number: parseInt(m[1], 10) }
        : null,
  },
  // @<sha> — a commit in the linked repo
  {
    pattern: /(?:^|[\s(\[])@([0-9a-f]{7,40})\b/g,
    priority: 40,
    build: (m, defaultRepo) =>
      defaultRepo ? { kind: 'commit' as const, owner: defaultRepo.owner, repo: defaultRepo.repo, sha: m[1] } : null,
  },
];

/**
 * Extracts every GitHub reference in `text`, ignoring code blocks. Overlapping
 * matches are resolved in favour of the more specific (higher priority) matcher.
 */
export const parseGitRefs = (text: string, defaultRepo?: DefaultRepo): ParsedGitRef[] => {
  if (!text) return [];
  const haystack = maskCodeSpans(text);

  interface Candidate extends ParsedGitRef {
    priority: number;
    end: number;
  }

  const candidates: Candidate[] = [];

  for (const matcher of MATCHERS) {
    matcher.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.pattern.exec(haystack)) !== null) {
      const built = matcher.build(match, defaultRepo);
      if (!built) continue;

      // Leading delimiters are part of the match but not part of the reference.
      const leading = match[0].length - match[0].replace(/^[\s(\[]+/, '').length;
      const rawStart = match.index + leading;
      const end = match.index + match[0].length;

      candidates.push({
        ...built,
        raw: text.slice(rawStart, end),
        index: rawStart,
        end,
        priority: matcher.priority,
        key: buildRefKey(built),
      });
    }
  }

  // Prefer higher priority, then longer matches, then earlier position.
  candidates.sort((a, b) => b.priority - a.priority || b.raw.length - a.raw.length || a.index - b.index);

  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some((a) => candidate.index < a.end && a.index < candidate.end);
    if (!overlaps) accepted.push(candidate);
  }

  return accepted
    .sort((a, b) => a.index - b.index)
    .map(({ priority, end, ...ref }) => ref);
};

/** Unique references, de-duplicated by cache key, preserving first occurrence. */
export const uniqueRefs = (refs: ParsedGitRef[]): ParsedGitRef[] => {
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
};
