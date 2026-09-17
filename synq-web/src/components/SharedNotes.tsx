import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Placeholder } from '@tiptap/extensions';
import * as Y from 'yjs';
import { socketService } from '../services/socketService';
import { YjsE2EEProvider } from '../services/yjsSocketProvider';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { FileText, Loader2, X, WifiOff } from 'lucide-react';

export default function SharedNotes({ chatId, onClose }: { chatId: string, onClose: () => void }) {
  const [provider, setProvider] = useState<YjsE2EEProvider | null>(null);
  const { user } = useAuthStore();
  // The canvas needs a live socket. Tracking connection state means the editor
  // builds itself as soon as one exists, instead of sitting on a spinner
  // forever because the socket happened to be down when the panel opened.
  const connectionState = useChatStore((s) => s.connectionState);

  useEffect(() => {
    const socket = socketService.getSocket();
    if (!socket) return;

    // Create a new Yjs Document for this chat
    const ydoc = new Y.Doc();

    // Create the E2EE provider
    const yProvider = new YjsE2EEProvider(ydoc, socket, chatId);
    setProvider(yProvider);

    return () => {
      setProvider(null);
      yProvider.destroy();
      ydoc.destroy();
    };
  }, [chatId, connectionState]);

  const editor = useEditor({
    // Rendering on the client only; opting out avoids a hydration mismatch.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm sm:prose-base lg:prose-lg xl:prose-2xl m-5 focus:outline-none max-w-none',
      },
    },
    extensions: [
      // Yjs owns undo history; the built-in stack would fight it. In Tiptap v3
      // this option is `undoRedo` — the old `history` key was silently ignored.
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({
        placeholder: 'Start typing — everyone here sees it as you type.',
        // Otherwise the hint only appears once the caret is already in the
        // canvas, so an untouched panel just looks blank.
        showOnlyCurrent: false,
      }),
      provider ? Collaboration.configure({ document: provider.doc }) : undefined,
      provider
        ? CollaborationCaret.configure({
            provider,
            user: {
              name: user?.username || 'Anonymous',
              color: provider.awareness.getLocalState()?.user?.color || '#818cf8',
            },
          })
        : undefined,
    ].filter(Boolean) as any,
  }, [provider]);

  if (!provider || !editor) {
    const offline = connectionState === 'offline';
    return (
      <div className="w-[38%] min-w-[380px] flex flex-col items-center justify-center gap-3 bg-surface border-l border-line z-20 shadow-2xl relative text-center px-8">
        {offline ? (
          <>
            <WifiOff className="w-8 h-8 text-faint" />
            <p className="text-[13px] font-medium text-muted">Canvas needs a connection</p>
            <p className="text-[11.5px] text-subtle leading-relaxed">
              The shared canvas syncs over the realtime channel. It will open as soon as you are back online.
            </p>
          </>
        ) : (
          <Loader2 className="w-6 h-6 animate-spin text-accent-bright" />
        )}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-subtle hover:text-ink hover:bg-hover transition-colors"
          aria-label="Close shared canvas"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[38%] min-w-[380px] flex flex-col bg-surface border-l border-line z-20 shadow-2xl relative">
      <style>{`
        /* Tiptap v3 renames these from collaboration-cursor__* */
        .collaboration-carets__caret {
          border-left: 1px solid;
          border-right: 1px solid;
          margin-left: -1px;
          margin-right: -1px;
          pointer-events: none;
          position: relative;
          word-break: normal;
        }
        .collaboration-carets__label {
          border-radius: 4px 4px 4px 0;
          color: #fff;
          font-size: 10px;
          font-weight: 600;
          left: -1px;
          line-height: normal;
          padding: 1px 5px;
          position: absolute;
          top: -1.4em;
          user-select: none;
          white-space: nowrap;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          /* The extension supplies the text as an attribute; CSS renders it. */
          content: attr(data-placeholder);
          color: var(--ink-faint);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>

      {/* Header — matches the chat header and the GitHub panel */}
      <div className="h-14 shrink-0 px-4 flex items-center gap-2.5 border-b border-line">
        <div className="w-7 h-7 rounded-lg bg-raised border border-line flex items-center justify-center text-accent-bright shrink-0">
          <FileText className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink leading-tight">Shared canvas</div>
          <div className="text-[10.5px] text-subtle leading-tight flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-positive" />
            End-to-end encrypted
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close shared canvas"
          className="p-1.5 rounded-lg text-subtle hover:text-ink hover:bg-hover transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Editor Canvas */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <EditorContent editor={editor} className="min-h-full" />
      </div>
    </div>
  );
}
