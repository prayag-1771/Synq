'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Minus, MessageSquareQuote, FileCode } from 'lucide-react';

export interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  blobUrl?: string;
}

interface DiffLine {
  type: 'context' | 'add' | 'del' | 'hunk';
  oldLine?: number;
  newLine?: number;
  text: string;
}

/** Parses a unified patch into renderable lines with both line numberings. */
const parsePatch = (patch: string): DiffLine[] => {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      lines.push({ type: 'hunk', text: raw });
    } else if (raw.startsWith('+')) {
      lines.push({ type: 'add', newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'del', oldLine, text: raw.slice(1) });
      oldLine++;
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file"
      lines.push({ type: 'context', text: raw });
    } else {
      lines.push({ type: 'context', oldLine, newLine, text: raw.slice(1) });
      oldLine++;
      newLine++;
    }
  }

  return lines;
};

const STATUS_STYLES: Record<string, string> = {
  added: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  removed: 'text-rose-400 bg-rose-500/10 border-rose-500/25',
  modified: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  renamed: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
};

interface Props {
  files: DiffFile[];
  /** Called with a `path:line` reference when a line is quoted into the chat. */
  onQuoteLine?: (path: string, line: number) => void;
  defaultOpen?: number;
}

/**
 * Renders a pull request or commit diff with per-line "quote in chat" actions —
 * the mechanism for pointing a teammate at one exact line of one exact change.
 */
export default function DiffView({ files, onQuoteLine, defaultOpen = 3 }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(files.map((f, i) => [f.filename, i >= defaultOpen]))
  );

  const toggle = (filename: string) =>
    setCollapsed((prev) => ({ ...prev, [filename]: !prev[filename] }));

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-600 text-sm gap-2">
        <FileCode className="w-8 h-8 opacity-30" />
        No file changes to show.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <FileDiff
          key={file.filename}
          file={file}
          collapsed={collapsed[file.filename]}
          onToggle={() => toggle(file.filename)}
          onQuoteLine={onQuoteLine}
        />
      ))}
    </div>
  );
}

const FileDiff = ({
  file,
  collapsed,
  onToggle,
  onQuoteLine,
}: {
  file: DiffFile;
  collapsed: boolean;
  onToggle: () => void;
  onQuoteLine?: (path: string, line: number) => void;
}) => {
  const lines = useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch]);
  const gutter = 'shrink-0 select-none px-2 text-right text-slate-600 text-[10px] tabular-nums';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        )}
        <span className="font-mono text-[11px] text-slate-300 truncate flex-1">{file.filename}</span>

        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase border ${
            STATUS_STYLES[file.status] || 'text-slate-400 bg-slate-800 border-slate-700'
          }`}
        >
          {file.status}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
          <span className="text-emerald-400 flex items-center gap-0.5">
            <Plus className="w-2.5 h-2.5" />
            {file.additions}
          </span>
          <span className="text-rose-400 flex items-center gap-0.5">
            <Minus className="w-2.5 h-2.5" />
            {file.deletions}
          </span>
        </span>
      </button>

      {!collapsed && (
        <div className="max-h-[420px] overflow-auto custom-scrollbar">
          {lines.length === 0 ? (
            <div className="px-4 py-3 text-[11px] text-slate-600 italic">
              No inline diff available (binary file or change too large).
            </div>
          ) : (
            <pre className="text-[11px] leading-[1.6] font-mono">
              {lines.map((line, i) => {
                const bg =
                  line.type === 'add'
                    ? 'bg-emerald-500/[0.07]'
                    : line.type === 'del'
                    ? 'bg-rose-500/[0.07]'
                    : line.type === 'hunk'
                    ? 'bg-indigo-500/[0.07]'
                    : '';
                const fg =
                  line.type === 'add'
                    ? 'text-emerald-300'
                    : line.type === 'del'
                    ? 'text-rose-300'
                    : line.type === 'hunk'
                    ? 'text-indigo-400'
                    : 'text-slate-400';

                const quotableLine = line.newLine ?? line.oldLine;

                return (
                  <div key={i} className={`flex group ${bg} hover:bg-slate-800/40`}>
                    <span className={gutter} style={{ minWidth: '4ch' }}>
                      {line.type === 'add' || line.type === 'hunk' ? '' : line.oldLine ?? ''}
                    </span>
                    <span className={`${gutter} border-r border-slate-800/60`} style={{ minWidth: '4ch' }}>
                      {line.type === 'del' || line.type === 'hunk' ? '' : line.newLine ?? ''}
                    </span>
                    <span className={`shrink-0 w-4 text-center ${fg} select-none`}>
                      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                    </span>
                    <code className={`flex-1 pr-2 whitespace-pre ${fg}`}>{line.text || ' '}</code>

                    {onQuoteLine && quotableLine && line.type !== 'hunk' && (
                      <button
                        onClick={() => onQuoteLine(file.filename, quotableLine)}
                        title={`Quote ${file.filename}:${quotableLine} in chat`}
                        className="shrink-0 px-1.5 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-indigo-400 transition-opacity"
                      >
                        <MessageSquareQuote className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
