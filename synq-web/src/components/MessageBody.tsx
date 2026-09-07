'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { parseGitRefs, uniqueRefs, ParsedGitRef } from '../lib/gitRefParser';
import { githubService, ResolvedRefCard, GitHubNotConnectedError } from '../services/githubService';
import { useGitHubStore } from '../stores/githubStore';
import { RefChip, RefCard, GitHubMark } from './github/GitHubRefCard';

type Segment =
  | { type: 'code'; language: string; code: string }
  | { type: 'text'; text: string; refs: ParsedGitRef[] };

/** Splits a message into fenced code blocks and prose, preserving order. */
const splitSegments = (content: string, defaultRepo?: { owner: string; repo: string }): Segment[] => {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts
    .filter((part) => part.length > 0)
    .map((part): Segment => {
      if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
        const lines = part.slice(3, -3).trim().split('\n');
        const first = lines[0] || '';
        const hasLanguage = first.length > 0 && !first.includes(' ') && first.length < 15;
        return {
          type: 'code',
          language: hasLanguage ? first : 'code',
          code: hasLanguage ? lines.slice(1).join('\n') : lines.join('\n'),
        };
      }
      return { type: 'text', text: part, refs: parseGitRefs(part, defaultRepo) };
    });
};

/** Renders inline code spans and bold runs inside a stretch of prose. */
const renderInline = (text: string, keyPrefix: string): React.ReactNode[] =>
  text.split(/(`[^`\n]+`)/g).map((chunk, i) => {
    if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
      return (
        <code
          key={`${keyPrefix}-c${i}`}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-950 border border-slate-800 text-indigo-400 font-mono text-xs select-all"
        >
          {chunk.slice(1, -1)}
        </code>
      );
    }

    return chunk.split(/(\*\*[^*]+\*\*)/g).map((bold, j) =>
      bold.startsWith('**') && bold.endsWith('**') ? (
        <strong key={`${keyPrefix}-b${i}-${j}`} className="font-semibold text-white">
          {bold.slice(2, -2)}
        </strong>
      ) : (
        <React.Fragment key={`${keyPrefix}-t${i}-${j}`}>{bold}</React.Fragment>
      )
    );
  });

const CodeBlock = ({ language, code }: { language: string; code: string }) => {
  const [copied, setCopied] = useState(false);

  return (
    <div className="my-2 border border-slate-800 rounded-lg overflow-hidden bg-slate-950 font-mono text-xs text-slate-300">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[10px] text-slate-400 font-sans font-medium uppercase tracking-wider">
        <span>{language}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="px-2 py-0.5 hover:bg-slate-800 rounded text-slate-300 hover:text-white transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto whitespace-pre">
        <code className="block">{code}</code>
      </pre>
    </div>
  );
};

interface MessageBodyProps {
  content: string;
  chatId?: string | null;
  /** Suppresses reference unfurling — used for AI output that already renders cards. */
  disableRefs?: boolean;
}

/**
 * Renders a chat message: code blocks, inline formatting, and — the point of
 * the GitHub integration — live references. `#412`, `owner/repo@sha` and
 * `src/db/redis.ts:40-58` become clickable chips backed by real repository
 * state, with unfurled cards beneath the message.
 *
 * Parsing happens here, in the browser, because direct messages are E2EE and
 * this is the only place the plaintext exists.
 */
export default function MessageBody({ content, chatId, disableRefs = false }: MessageBodyProps) {
  const reposByChat = useGitHubStore((s) => s.reposByChat);
  const status = useGitHubStore((s) => s.status);
  const openConnectModal = useGitHubStore((s) => s.openConnectModal);

  const [cards, setCards] = useState<Map<string, ResolvedRefCard>>(new Map());
  const [resolving, setResolving] = useState(false);

  const defaultRepo = useMemo(() => {
    if (!chatId) return undefined;
    const repos = reposByChat[chatId];
    if (!repos || repos.length === 0) return undefined;
    const primary = repos.find((r) => r.isPrimary) || repos[0];
    return { owner: primary.owner, repo: primary.name };
  }, [chatId, reposByChat]);

  const segments = useMemo(
    () => splitSegments(content || '', disableRefs ? undefined : defaultRepo),
    [content, defaultRepo, disableRefs]
  );

  const allRefs = useMemo(() => {
    if (disableRefs) return [];
    const flat = segments.flatMap((s) => (s.type === 'text' ? s.refs : []));
    return uniqueRefs(flat);
  }, [segments, disableRefs]);

  const refSignature = allRefs.map((r) => r.key).join('|');
  const isConnected = Boolean(status?.connected);

  useEffect(() => {
    if (allRefs.length === 0 || !isConnected) {
      setCards(new Map());
      return;
    }

    let cancelled = false;
    setResolving(true);

    githubService
      .resolveRefs(allRefs)
      .then((resolved) => {
        if (!cancelled) setCards(resolved);
      })
      .catch((err) => {
        if (!(err instanceof GitHubNotConnectedError)) {
          console.error('[MessageBody] Failed to resolve GitHub references:', err);
        }
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });

    return () => {
      cancelled = true;
    };
    // refSignature captures the identity of every reference in this message.
  }, [refSignature, isConnected]);

  if (!content) return null;

  const body = segments.map((segment, segmentIndex) => {
    if (segment.type === 'code') {
      return <CodeBlock key={`seg-${segmentIndex}`} language={segment.language} code={segment.code} />;
    }

    if (segment.refs.length === 0) {
      return (
        <span key={`seg-${segmentIndex}`} className="whitespace-pre-wrap">
          {renderInline(segment.text, `s${segmentIndex}`)}
        </span>
      );
    }

    // Interleave prose with reference chips at their exact offsets.
    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    segment.refs.forEach((ref, refIndex) => {
      if (ref.index > cursor) {
        nodes.push(
          <React.Fragment key={`s${segmentIndex}-p${refIndex}`}>
            {renderInline(segment.text.slice(cursor, ref.index), `s${segmentIndex}-p${refIndex}`)}
          </React.Fragment>
        );
      }

      nodes.push(
        isConnected ? (
          <RefChip key={`s${segmentIndex}-r${refIndex}`} raw={ref.raw} card={cards.get(ref.key)} loading={resolving} />
        ) : (
          <button
            key={`s${segmentIndex}-r${refIndex}`}
            type="button"
            onClick={() => openConnectModal(true)}
            title="Connect GitHub to preview this reference"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/40 font-mono text-[11px] align-baseline transition-colors"
          >
            <GitHubMark className="w-3 h-3" />
            {ref.raw}
          </button>
        )
      );

      cursor = ref.index + ref.raw.length;
    });

    if (cursor < segment.text.length) {
      nodes.push(
        <React.Fragment key={`s${segmentIndex}-tail`}>
          {renderInline(segment.text.slice(cursor), `s${segmentIndex}-tail`)}
        </React.Fragment>
      );
    }

    return (
      <span key={`seg-${segmentIndex}`} className="whitespace-pre-wrap">
        {nodes}
      </span>
    );
  });

  const unfurled = isConnected
    ? allRefs.map((ref) => cards.get(ref.key)).filter((card): card is ResolvedRefCard => Boolean(card))
    : [];

  return (
    <>
      <div className="leading-relaxed">{body}</div>

      {unfurled.slice(0, 3).map((card) => (
        <RefCard key={card.key} card={card} />
      ))}

      {unfurled.length > 3 && (
        <div className="mt-1.5 text-[10px] text-slate-500 pl-1">
          +{unfurled.length - 3} more reference{unfurled.length - 3 === 1 ? '' : 's'} in this message
        </div>
      )}
    </>
  );
}
