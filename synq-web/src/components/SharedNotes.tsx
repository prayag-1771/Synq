import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { socketService } from '../services/socketService';
import { YjsE2EEProvider } from '../services/yjsSocketProvider';
import { useAuthStore } from '../stores/authStore';
import { FileText, Loader2, X } from 'lucide-react';

export default function SharedNotes({ chatId, onClose }: { chatId: string, onClose: () => void }) {
  const [provider, setProvider] = useState<YjsE2EEProvider | null>(null);
  const { user } = useAuthStore();

  useEffect(() => {
    if (!socketService.getSocket()) return;

    // Create a new Yjs Document for this chat
    const ydoc = new Y.Doc();
    
    // Create the E2EE provider
    const yProvider = new YjsE2EEProvider(ydoc, socketService.getSocket()!, chatId);
    setProvider(yProvider);

    return () => {
      yProvider.destroy();
      ydoc.destroy();
    };
  }, [chatId]);

  const editor = useEditor({
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm sm:prose-base lg:prose-lg xl:prose-2xl m-5 focus:outline-none max-w-none',
      },
    },
    extensions: [
      StarterKit.configure({ history: false } as any), // History is handled by Yjs CRDTs
      provider ? Collaboration.configure({ document: provider.doc }) : undefined,
      provider ? CollaborationCursor.configure({
        provider: provider,
        user: { 
          name: user?.username || 'Anonymous', 
          color: provider.awareness.getLocalState()?.user?.color || '#818cf8' 
        }
      }) : undefined,
    ].filter(Boolean) as any,
  }, [provider]);

  if (!provider || !editor) {
    return (
      <div className="w-[35%] flex items-center justify-center bg-slate-900 border-l border-slate-800/60 z-20 shadow-2xl relative transition-all duration-300">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="w-[35%] flex flex-col bg-slate-900 border-l border-slate-800/60 z-20 shadow-2xl relative transition-all duration-300">
      <style>{`
        .collaboration-cursor__caret {
          border-left: 2px solid #fff;
          border-right: 2px solid #fff;
          margin-left: -2px;
          margin-right: -2px;
          pointer-events: none;
          position: relative;
          word-break: normal;
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .collaboration-cursor__label {
          border-radius: 4px 4px 4px 0;
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          left: -2px;
          line-height: normal;
          padding: 2px 6px;
          position: absolute;
          top: -1.4em;
          user-select: none;
          white-space: nowrap;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          color: #475569;
          content: 'Start typing to co-edit securely...';
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
      
      {/* Header */}
      <div className="h-[73px] p-4 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-3 text-indigo-400 font-semibold">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-slate-100">Shared Canvas</span>
            <span className="text-[10px] text-indigo-400 flex items-center gap-1 font-normal tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
              E2EE Active
            </span>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-xl transition-all">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Editor Canvas */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950/30">
        <EditorContent editor={editor} className="min-h-full" />
      </div>
    </div>
  );
}
