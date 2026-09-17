import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../db/localDb';
import { aiService } from '../services/aiService';
import {
  BrainCircuit,
  Sparkles,
  Search,
  CheckSquare,
  Square,
  RefreshCw,
  Loader2,
  X,
  Copy,
  Calendar,
  ListTodo,
  Check
} from 'lucide-react';

interface AIAssistantProps {
  chatId: string;
  onClose: () => void;
  onSelectMessage?: (senderId: string) => void;
}

export default function AIAssistant({ chatId, onClose, onSelectMessage }: AIAssistantProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'memory' | 'tasks'>('summary');
  
  // Summary Tab State
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryScope, setSummaryScope] = useState<20 | 50 | 100>(50);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Semantic Search Tab State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Tasks Tab State
  const [tasks, setTasks] = useState<any[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);

  // Get messages reactively from Dexie DB for summary generation
  const localMessages = useLiveQuery(
    () => localDb.messages.where('chatId').equals(chatId).sortBy('createdAt'),
    [chatId]
  ) || [];

  // Refetch tasks when chatId or tab changes to tasks
  useEffect(() => {
    if (activeTab === 'tasks') {
      fetchTasks();
    }
  }, [chatId, activeTab]);

  const fetchTasks = async () => {
    try {
      setIsLoadingTasks(true);
      const data = await aiService.getTasksJson(chatId);
      setTasks(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingTasks(false);
    }
  };

  const handleToggleTask = async (taskId: string) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t));
    
    try {
      const updated = await aiService.toggleTaskStatus(taskId);
      if (!updated) {
        // Rollback
        fetchTasks();
      }
    } catch (err) {
      console.error(err);
      fetchTasks();
    }
  };

  const handleGenerateSummary = async () => {
    if (localMessages.length === 0) return;
    try {
      setIsSummarizing(true);
      setSummary(null);
      // Slice the last messages based on scope
      const messagesToSummarize = localMessages.slice(-summaryScope);
      const result = await aiService.generateSummary(messagesToSummarize);
      setSummary(result);
    } catch (err) {
      console.error(err);
      setSummary('Failed to generate summary.');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleCopySummary = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const handleSemanticSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    try {
      setIsSearching(true);
      const results = await aiService.semanticSearch(searchQuery, 10);
      // Filter results to only belong to this chat
      const filtered = results.filter(r => r.chatId === chatId);
      setSearchResults(filtered);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="w-[38%] min-w-[380px] flex flex-col bg-surface border-l border-line z-20 shadow-2xl relative">
      
      {/* Header */}
      <div className="h-14 shrink-0 px-4 border-b border-line flex items-center justify-between">
        <div className="flex items-center gap-3 text-purple-400 font-semibold">
          <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <BrainCircuit className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-ink text-sm leading-tight">AI Assistant</span>
            <span className="text-[10px] text-purple-400 flex items-center gap-1 font-normal tracking-wide">
              <Sparkles className="w-3 h-3 text-purple-400 animate-pulse" />
              AI Memory Engine
            </span>
          </div>
        </div>
        <button 
          onClick={onClose} 
          className="p-2 text-muted hover:bg-raised hover:text-white rounded-xl transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-line/60 bg-surface/30 p-1 gap-1">
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            activeTab === 'summary'
              ? 'bg-raised text-purple-400 shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          Summary
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            activeTab === 'memory'
              ? 'bg-raised text-purple-400 shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          Memory
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            activeTab === 'tasks'
              ? 'bg-raised text-purple-400 shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          Action Items
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-canvas/20 p-4">
        
        {/* SUMMARY TAB */}
        {activeTab === 'summary' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="bg-surface/40 border border-line/80 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Configure Scope</h4>
              <p className="text-xs text-subtle">Select how many recent messages the AI should digest for your summary.</p>
              
              <div className="flex gap-2">
                {([20, 50, 100] as const).map((scope) => (
                  <button
                    key={scope}
                    onClick={() => setSummaryScope(scope)}
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-all ${
                      summaryScope === scope
                        ? 'bg-purple-600/10 border-purple-500/50 text-purple-300 font-semibold'
                        : 'bg-canvas/40 border-line text-muted hover:text-ink/85'
                    }`}
                  >
                    Last {scope}
                  </button>
                ))}
              </div>

              <button
                onClick={handleGenerateSummary}
                disabled={isSummarizing || localMessages.length === 0}
                className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-xs text-white shadow-lg shadow-purple-600/10 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                {isSummarizing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 text-purple-200" />
                )}
                {isSummarizing ? 'Analyzing conversation...' : 'Catch Me Up'}
              </button>
              
              {localMessages.length === 0 && (
                <p className="text-[10px] text-center text-red-400">No messages found in this chat to summarize.</p>
              )}
            </div>

            {summary && (
              <div className="bg-purple-950/10 border border-purple-500/20 rounded-xl p-4 space-y-3 relative shadow-inner animate-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    AI Summary
                  </span>
                  <button
                    onClick={handleCopySummary}
                    className="p-1 rounded bg-raised/80 hover:bg-raised text-muted hover:text-ink transition-colors"
                    title="Copy to clipboard"
                  >
                    {copiedSummary ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="text-xs text-ink pl-1 whitespace-pre-wrap leading-relaxed">
                  {summary}
                </div>
              </div>
            )}
          </div>
        )}

        {/* MEMORY TAB */}
        {activeTab === 'memory' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <form onSubmit={handleSemanticSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Query vector database..."
                  className="w-full pl-9 pr-3 py-2 bg-canvas/60 border border-line rounded-lg text-xs text-ink placeholder-subtle focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-semibold text-white transition-colors"
              >
                {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
              </button>
            </form>

            <div className="space-y-2">
              {searchResults.length === 0 && !isSearching && (
                <div className="py-12 flex flex-col items-center justify-center text-subtle">
                  <BrainCircuit className="w-10 h-10 mb-2 opacity-10" />
                  <p className="text-xs">Search conceptually: e.g., "password details"</p>
                </div>
              )}

              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="p-3 bg-surface/40 hover:bg-raised/30 border border-line rounded-xl transition-all relative group"
                >
                  <div className="flex items-start gap-2.5 mb-1.5">
                    <img 
                      src={result.senderAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${result.senderName}`} 
                      alt="" 
                      className="w-6 h-6 rounded bg-raised border border-line"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-ink truncate">{result.senderName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/15">
                          {Math.round(result.confidence * 100)}% match
                        </span>
                      </div>
                      <span className="text-[9px] text-subtle block mt-0.5">
                        {new Date(result.createdAt).toLocaleDateString()} at {new Date(result.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-ink/85 leading-normal pl-8 pr-2 break-words whitespace-pre-wrap">{result.content}</p>
                  
                  {/* Action overlays */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(result.content);
                      }}
                      className="p-1 rounded bg-canvas border border-line text-muted hover:text-ink hover:bg-surface transition-colors"
                      title="Copy message"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ACTION ITEMS TAB */}
        {activeTab === 'tasks' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <ListTodo className="w-4 h-4 text-purple-400" />
                Detected Action Items ({tasks.filter(t => !t.isCompleted).length})
              </span>
              <button
                onClick={fetchTasks}
                disabled={isLoadingTasks}
                className="p-1.5 rounded-lg bg-surface hover:bg-raised text-muted hover:text-ink border border-line hover:border-line-strong transition-colors"
                title="Refresh list"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTasks ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="space-y-2">
              {isLoadingTasks && tasks.length === 0 ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                </div>
              ) : tasks.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-subtle">
                  <ListTodo className="w-10 h-10 mb-2 opacity-10" />
                  <p className="text-xs">No tasks detected in this conversation yet.</p>
                  <p className="text-[10px] text-faint mt-1 max-w-[200px] text-center">AI automatically extracts tasks when discussions specify actions or deadlines.</p>
                </div>
              ) : (
                tasks.map((task) => {
                  const isTodo = task.type === 'TODO';
                  return (
                    <div
                      key={task.id}
                      onClick={() => handleToggleTask(task.id)}
                      className={`p-3 bg-surface/40 border rounded-xl flex items-start gap-3 cursor-pointer transition-all hover:bg-raised/30 ${
                        task.isCompleted
                          ? 'border-line/40 opacity-50'
                          : 'border-line hover:border-line-strong'
                      }`}
                    >
                      <button className="mt-0.5 text-muted hover:text-purple-400 transition-colors">
                        {task.isCompleted ? (
                          <CheckSquare className="w-4 h-4 text-purple-400" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium block leading-normal ${task.isCompleted ? 'line-through text-subtle' : 'text-ink'}`}>
                          {task.title}
                        </span>
                        
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border ${
                            isTodo
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                          }`}>
                            {task.type}
                          </span>
                          
                          {task.dueDate && (
                            <span className="text-[10px] text-subtle flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(task.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
