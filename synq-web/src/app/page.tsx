'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../db/localDb';
import { apiService } from '../services/apiService';
import { socketService, tryDecryptMessage, getPublicKeyForUser } from '../services/socketService';
import { aiService } from '../services/aiService';
import { webrtcService } from '../services/webrtcService';
import PinModal from '../components/PinModal';
import CallModal from '../components/CallModal';
import SharedNotes from '../components/SharedNotes';
import AIAssistant from '../components/AIAssistant';
import {
  MessageSquare,
  Search,
  Send,
  LogOut,
  Loader2,
  Users,
  Smile,
  AlertCircle,
  Clock,
  RefreshCw,
  BrainCircuit,
  X,
  Wand2,
  Sparkles,
  Video,
  FileText,
  Check,
  CheckCheck,
  Copy
} from 'lucide-react';

function formatMessageContent(content: string) {
  if (!content) return null;
  
  // Split by code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);
  
  return parts.map((part, index) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      // It's a code block
      const codeLines = part.slice(3, -3).trim().split('\n');
      let language = 'code';
      let code = '';
      
      if (codeLines[0] && !codeLines[0].includes(' ') && codeLines[0].length < 15) {
        language = codeLines[0];
        code = codeLines.slice(1).join('\n');
      } else {
        code = codeLines.join('\n');
      }
      
      return (
        <div key={index} className="my-2 border border-slate-800 rounded-lg overflow-hidden bg-slate-950 font-mono text-xs text-slate-300">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[10px] text-slate-400 font-sans font-medium uppercase tracking-wider">
            <span>{language}</span>
            <button 
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(code);
              }}
              className="px-2 py-0.5 hover:bg-slate-800 rounded text-slate-300 hover:text-white transition-colors"
            >
              Copy
            </button>
          </div>
          <pre className="p-3 overflow-x-auto whitespace-pre"><code className="block">{code}</code></pre>
        </div>
      );
    }
    
    // Process text inline styles (bold, inline code)
    // First, split by inline code `...`
    const inlineParts = part.split(/(`[^`]+`)/g);
    const inlineRendered = inlineParts.map((subPart, subIndex) => {
      if (subPart.startsWith('`') && subPart.endsWith('`')) {
        return (
          <code key={subIndex} className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-950 border border-slate-800 text-indigo-400 font-mono text-xs select-all">
            {subPart.slice(1, -1)}
          </code>
        );
      }
      
      // Process bold **...**
      const boldParts = subPart.split(/(\*\*[^*]+\*\*)/g);
      return boldParts.map((boldPart, boldIndex) => {
        if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
          return <strong key={boldIndex} className="font-semibold text-white">{boldPart.slice(2, -2)}</strong>;
        }
        return boldPart;
      });
    });
    
    return <span key={index} className="whitespace-pre-wrap">{inlineRendered}</span>;
  });
}

export default function ChatPage() {
  const router = useRouter();
  const { user, token, isAuthenticated, clearAuth } = useAuthStore();
  const {
    selectedChatId,
    typingUsers,
    setSelectedChatId,
  } = useChatStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [usersList, setUsersList] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [activeRightPanel, setActiveRightPanel] = useState<'notes' | 'ai' | null>(null);

  // Slash Commands Dropdown state
  const [showCommandsDropdown, setShowCommandsDropdown] = useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  const commands = [
    { name: '/summarize', description: 'Summarize conversation history', usage: '/summarize' },
    { name: '/search', description: 'Query vector database conceptually', usage: '/search <query>' },
    { name: '/translate', description: 'Translate text (e.g. spanish)', usage: '/translate <lang> <text>' },
    { name: '/explain', description: 'Explain a technical concept or code block', usage: '/explain <code/concept>' },
    { name: '/todo', description: 'List tasks detected by AI in this chat', usage: '/todo' },
    { name: '/agent', description: 'Run autonomous AI agent task', usage: '/agent <prompt>' }
  ];

  const filteredCommands = commands.filter(cmd => 
    messageInput.startsWith('/') && 
    cmd.name.startsWith(messageInput.split(' ')[0])
  );

  const selectCommand = (cmd: typeof commands[0]) => {
    setMessageInput(cmd.name + ' ');
    setShowCommandsDropdown(false);
  };
  
  // AI State
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [smartReplies, setSmartReplies] = useState<string[]>([]);
  const [isFetchingReplies, setIsFetchingReplies] = useState(false);

  // Semantic Search State
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticResults, setSemanticResults] = useState<any[]>([]);
  const [isSearchingSemantic, setIsSearchingSemantic] = useState(false);
  const [showSemanticModal, setShowSemanticModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Reactive IndexedDB Queries
  const chats = useLiveQuery(
    () => localDb.chats.orderBy('updatedAt').reverse().toArray()
  ) || [];

  const messages = useLiveQuery(
    () => localDb.messages.where('chatId').equals(selectedChatId || '').sortBy('createdAt'),
    [selectedChatId]
  ) || [];

  // 2. Auth Guard
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  // 3. Socket Connection & Fetch Directories
  useEffect(() => {
    if (isAuthenticated && token) {
      socketService.connect();
      webrtcService.initializeListeners();
      fetchChats();
      fetchUsers();
    }
    return () => {
      socketService.disconnect();
    };
  }, [isAuthenticated, token]);

  // 4. Auto Scroll to Bottom on New Messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setHasMoreMessages(true); // Reset load more availability
  }, [messages.length, typingUsers]);

  // 5. Join Room when Chat Selected
  useEffect(() => {
    if (selectedChatId) {
      socketService.joinChat(selectedChatId);
      socketService.markAsRead(selectedChatId);
      fetchMessagesInitial(selectedChatId);
      setSummary(null);
      setSmartReplies([]);
    }
  }, [selectedChatId]);

  // AI Smart Replies trigger when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.senderId !== user?.id && !isFetchingReplies) {
        handleGenerateReplies();
      }
    }
  }, [messages.length]);

  const handleGenerateSummary = async () => {
    if (!messages || messages.length === 0) return;
    try {
      setIsSummarizing(true);
      const text = await aiService.generateSummary(messages.slice(-50)); // summarize last 50 msgs
      setSummary(text);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleGenerateReplies = async () => {
    if (!messages || messages.length === 0) return;
    try {
      setIsFetchingReplies(true);
      const replies = await aiService.getSmartReplies(messages.slice(-5));
      setSmartReplies(replies);
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingReplies(false);
    }
  };

  const handleSemanticSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!semanticQuery.trim()) return;
    try {
      setIsSearchingSemantic(true);
      const results = await aiService.semanticSearch(semanticQuery, 10);
      setSemanticResults(results);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearchingSemantic(false);
    }
  };

  const fetchChats = async () => {
    try {
      setLoadingChats(true);
      const res = await apiService.get('/chats');
      if (res.ok) {
        const data = await res.json();
        
        // Map and save to Local DB
        const localChats = data.map((c: any) => ({
          id: c.id,
          type: c.type,
          name: c.name,
          avatar: c.avatar,
          otherUser: c.otherUser,
          updatedAt: c.updatedAt,
        }));
        await localDb.chats.bulkPut(localChats);

        // Eagerly pre-fetch public keys for all direct chat partners for instant 0ms decryption
        data.forEach((c: any) => {
          if (c.type === 'DIRECT' && c.otherUser?.id) {
            getPublicKeyForUser(c.otherUser.id);
          }
        });
      }
    } catch (err) {
      console.error('Error fetching chats:', err);
    } finally {
      setLoadingChats(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await apiService.get('/auth/users');
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  const fetchMessagesInitial = async (chatId: string) => {
    try {
      const res = await apiService.get(`/chats/${chatId}/messages?limit=50`);
      if (res.ok) {
        const data = await res.json();
        
        // Fetch existing messages to prevent overwriting sender's plaintext with ciphertext
        const existingMessages = await localDb.messages.where('chatId').equals(chatId).toArray();
        const existingMap = new Map(existingMessages.map(m => [m.id, m]));

        const localMessages = await Promise.all(data.map(async (m: any) => {
          let finalContent = m.content;
          const existing = existingMap.get(m.id);
          
          if (existing && existing.content.length < 150) {
             // We already have the plaintext locally, no need to decrypt again!
             finalContent = existing.content;
          } else {
             finalContent = await tryDecryptMessage(m.content, m.senderId);
          }

          return {
            id: m.id,
            chatId: m.chatId,
            senderId: m.senderId,
            content: finalContent,
            createdAt: m.createdAt,
            status: m.status || 'SENT',
            senderName: m.sender.username,
            senderAvatar: m.sender.avatar || undefined,
          };
        }));
        await localDb.messages.bulkPut(localMessages);
      }
    } catch (err) {
      console.error('Error fetching initial messages:', err);
    }
  };

  const handleLoadMore = async () => {
    if (!selectedChatId || loadingMore) return;
    const oldestMessage = messages[0];
    if (!oldestMessage) return;

    try {
      setLoadingMore(true);
      const cursor = oldestMessage.createdAt;
      const res = await apiService.get(`/chats/${selectedChatId}/messages?cursor=${encodeURIComponent(cursor)}&limit=30`);
      
      if (res.ok) {
        const data = await res.json();
        if (data.length < 30) {
          setHasMoreMessages(false);
        }
        
        if (data.length > 0) {
          const existingMessages = await localDb.messages.where('chatId').equals(selectedChatId).toArray();
          const existingMap = new Map(existingMessages.map(m => [m.id, m]));

          const localMessages = await Promise.all(data.map(async (m: any) => {
            let finalContent = m.content;
            const existing = existingMap.get(m.id);
            
            if (existing && existing.content.length < 150) {
               finalContent = existing.content;
            } else {
               finalContent = await tryDecryptMessage(m.content, m.senderId);
            }

            return {
              id: m.id,
              chatId: m.chatId,
              senderId: m.senderId,
              content: finalContent,
              createdAt: m.createdAt,
              status: m.status || 'SENT',
              senderName: m.sender.username,
              senderAvatar: m.sender.avatar || undefined,
            };
          }));
          await localDb.messages.bulkPut(localMessages);
        }
      }
    } catch (err) {
      console.error('Error loading older messages:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleStartChat = async (targetUserId: string) => {
    try {
      const res = await apiService.post('/chats/direct', { targetUserId });
      if (res.ok) {
        const newChat = await res.json();
        
        // Save to Dexie
        await localDb.chats.put({
          id: newChat.id,
          type: newChat.type,
          name: newChat.name,
          avatar: newChat.avatar,
          otherUser: newChat.otherUser,
          updatedAt: newChat.updatedAt,
        });
        
        setSelectedChatId(newChat.id);
        setSearchQuery('');
        setShowSearchResults(false);
      }
    } catch (err) {
      console.error('Error starting chat:', err);
    }
  };

  const executeSlashCommand = async (content: string, chatId: string): Promise<boolean> => {
    const parts = content.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const recognizedCommands = ['/summarize', '/search', '/translate', '/explain', '/todo', '/agent'];
    if (!recognizedCommands.includes(command)) return false;

    // It's a recognized command, so we intercept it.
    
    // 1. Generate a temporary ID for the local AI message
    const tempId = crypto.randomUUID();
    
    // 2. Insert a "thinking" message locally
    await localDb.messages.add({
      id: tempId,
      chatId,
      senderId: 'SYSTEM_AI',
      senderName: command === '/agent' ? 'Synq Autonomous Agent' : 'Synq AI',
      content: command === '/agent' ? `*Agent is thinking...*` : `*Running command: ${command}...*`,
      createdAt: new Date().toISOString(),
      status: 'SENT'
    });

    try {
      let aiResponse = '';

      switch (command) {
        case '/summarize':
          // Fetch last 50 msgs for this chat from localDb
          const recentMsgs = await localDb.messages
            .where('chatId')
            .equals(chatId)
            .sortBy('createdAt');
          aiResponse = await aiService.generateSummary(recentMsgs.slice(-50));
          break;
        case '/search':
          if (!args) aiResponse = 'Usage: `/search <query>`';
          else {
            const results = await aiService.semanticSearch(args, 3);
            if (results.length === 0) aiResponse = 'No results found.';
            else {
              aiResponse = `**Top Search Results:**\n\n` + results.map((r: any) => 
                `> "${r.content}" — *${r.senderName} (${Math.round(r.confidence * 100)}%)*`
              ).join('\n\n');
            }
          }
          break;
        case '/translate':
          const langMatch = args.match(/^(\w+)\s+(.+)$/);
          if (!langMatch) aiResponse = 'Usage: `/translate <language> <text>`\nExample: `/translate spanish Hello world`';
          else aiResponse = await aiService.translateText(langMatch[2], langMatch[1]);
          break;
        case '/explain':
          if (!args) aiResponse = 'Usage: `/explain <code or concept>`';
          else aiResponse = await aiService.explainContext(args);
          break;
        case '/todo':
          aiResponse = await aiService.extractTodos(chatId);
          break;
        case '/agent':
          if (!args) aiResponse = 'Usage: `/agent <prompt>`\nExample: `/agent Search for the database URL and save it as a Todo.`';
          else aiResponse = await aiService.runAgent(args, chatId);
          break;
      }

      // Update the local message with the final response
      await localDb.messages.update(tempId, { content: aiResponse });

    } catch (err) {
      await localDb.messages.update(tempId, { content: '❌ *Failed to execute AI command.*' });
    }

    return true;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedChatId || !user) return;

    const content = messageInput.trim();
    setMessageInput('');
    
    // Stop typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socketService.sendTypingStatus(selectedChatId, false);
    setIsTyping(false);

    // AI Command Interception
    if (content.startsWith('/')) {
      const isCommand = await executeSlashCommand(content, selectedChatId);
      if (isCommand) return; // intercepted!
    }

    // Call local database first & optimistically emit
    await socketService.sendMessageOptimistic(
      selectedChatId,
      content,
      user.id,
      user.username,
      user.avatar
    );
  };

  const handleRetryMessage = async (msg: any) => {
    if (!selectedChatId || !user) return;
    
    // 1. Delete failed message from local DB
    await localDb.messages.delete(msg.id);
    
    // 2. Re-trigger optimistic send
    await socketService.sendMessageOptimistic(
      selectedChatId,
      msg.content,
      user.id,
      user.username,
      user.avatar
    );
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setMessageInput(val);

    const isCommandStart = val.startsWith('/') && !val.includes(' ');
    setShowCommandsDropdown(isCommandStart);
    if (isCommandStart) {
      setActiveCommandIndex(0);
    }

    if (!selectedChatId) return;

    if (!isTyping) {
      setIsTyping(true);
      socketService.sendTypingStatus(selectedChatId, true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socketService.sendTypingStatus(selectedChatId, false);
      setIsTyping(false);
    }, 2000);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCommandsDropdown && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveCommandIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveCommandIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectCommand(filteredCommands[activeCommandIndex]);
      } else if (e.key === 'Escape') {
        setShowCommandsDropdown(false);
      }
    }
  };

  const handleLogout = async () => {
    try {
      const { refreshToken } = useAuthStore.getState();
      if (refreshToken) {
        await apiService.post('/auth/logout', { refreshToken });
      }
    } catch (error) {
      console.error('Failed to logout on server:', error);
    }
    socketService.disconnect();
    clearAuth();
    router.push('/login');
  };

  const selectedChat = chats.find((c) => c.id === selectedChatId);
  const activeTyping = selectedChatId ? (typingUsers[selectedChatId] || []) : [];

  const filteredUsers = usersList.filter((u) =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <PinModal />
      <CallModal />
      
      {/* Semantic Search Modal */}
      {showSemanticModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col h-[80vh] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 p-4 border-b border-slate-800/60">
              <BrainCircuit className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-semibold text-slate-100">AI Memory Search</h2>
              <button 
                onClick={() => { setShowSemanticModal(false); setSemanticResults([]); setSemanticQuery(''); }}
                className="ml-auto p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSemanticSearch} className="p-4 border-b border-slate-800/60 bg-slate-900/50">
              <div className="relative flex items-center">
                <Search className="absolute left-4 w-5 h-5 text-slate-500" />
                <input
                  type="text"
                  value={semanticQuery}
                  onChange={(e) => setSemanticQuery(e.target.value)}
                  placeholder="Ask your memory... e.g., 'What was the password for the database?'"
                  className="w-full pl-12 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-slate-200 placeholder-slate-500"
                />
                <button
                  type="submit"
                  disabled={isSearchingSemantic || !semanticQuery.trim()}
                  className="absolute right-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
                >
                  {isSearchingSemantic ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                </button>
              </div>
            </form>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {semanticResults.length === 0 && !isSearchingSemantic && (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <BrainCircuit className="w-12 h-12 mb-3 opacity-20" />
                  <p>Search by meaning, not just keywords.</p>
                </div>
              )}
              
              {semanticResults.map((result) => (
                <div 
                  key={result.id} 
                  onClick={() => {
                    handleStartChat(result.chatId === user?.id ? result.senderId : result.chatId);
                    setShowSemanticModal(false);
                  }}
                  className="p-4 rounded-xl border border-slate-800/60 bg-slate-900/40 hover:bg-slate-800/60 cursor-pointer transition-colors group relative"
                >
                  <div className="flex items-start gap-3">
                    <img src={result.senderAvatar} alt="" className="w-8 h-8 rounded-lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm text-slate-200">{result.senderName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            {Math.round(result.confidence * 100)}% match
                          </span>
                          <span className="text-xs text-slate-500">
                            {new Date(result.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-300 line-clamp-3">{result.content}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Background radial effects */}
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/20 via-slate-950 to-slate-950 pointer-events-none" />

      {/* 1. Left Sidebar */}
      <div className="w-80 border-r border-slate-800/60 bg-slate-900/20 backdrop-blur-md flex flex-col z-10 relative">
        {/* User Profile Header */}
        <div className="p-4 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={user.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`}
              alt="avatar"
              className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700/50 object-cover"
            />
            <div className="flex flex-col">
              <span className="font-semibold text-sm leading-tight text-white">
                {user.username}
              </span>
              <span className="text-xs text-emerald-400 flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                Active
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSemanticModal(true)}
              className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 transition-all duration-200"
              title="Memory Search"
            >
              <BrainCircuit className="w-4 h-4" />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg bg-slate-800/40 hover:bg-red-500/10 hover:text-red-400 border border-slate-800 hover:border-red-500/20 transition-all duration-200"
              title="Log Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search / Directory */}
        <div className="p-3 relative">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
              <Search className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(e.target.value.length > 0);
              }}
              onFocus={() => setShowSearchResults(searchQuery.length > 0)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-800 bg-slate-950/60 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all"
              placeholder="Search people to chat..."
            />
          </div>

          {/* Search Dropdown Panel */}
          {showSearchResults && (
            <div className="absolute top-full left-3 right-3 mt-1 bg-slate-900 border border-slate-800 rounded-lg shadow-xl max-h-60 overflow-y-auto z-25 divide-y divide-slate-800/50">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleStartChat(u.id)}
                    className="w-full p-3 flex items-center gap-3 hover:bg-slate-800/40 transition-colors text-left"
                  >
                    <img
                      src={u.avatar}
                      alt={u.username}
                      className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/50"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-white">{u.username}</span>
                      <span className="text-xs text-slate-500">{u.email}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-4 text-center text-xs text-slate-500 flex items-center justify-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-slate-600" />
                  No matching users found
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chats History List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          <div className="px-2 py-1 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
            Direct Messages
          </div>
          {loadingChats ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-slate-600" />
            </div>
          ) : chats.length > 0 ? (
            chats.map((chat) => {
              const isSelected = chat.id === selectedChatId;
              const hasTyping = (typingUsers[chat.id] || []).length > 0;
              
              return (
                <button
                  key={chat.id}
                  onClick={() => setSelectedChatId(chat.id)}
                  className={`w-full p-3 flex items-center gap-3 rounded-xl border text-left transition-all duration-200 ${
                    isSelected
                      ? 'bg-indigo-600/10 border-indigo-500/30 text-white'
                      : 'bg-transparent border-transparent hover:bg-slate-900/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="relative">
                    <img
                      src={chat.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${chat.name}`}
                      alt={chat.name}
                      className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-850"
                    />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-slate-950" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold truncate text-slate-200">
                        {chat.name}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {chat.updatedAt
                          ? new Date(chat.updatedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                    <p className="text-xs truncate mt-0.5">
                      {hasTyping ? (
                        <span className="text-indigo-400 font-medium animate-pulse">is typing...</span>
                      ) : (
                        'Open conversation'
                      )}
                    </p>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="text-center py-10 text-xs text-slate-600 px-4">
              No conversations yet. Search for a user above to start chatting!
            </div>
          )}
        </div>
      </div>

      {/* 2. Main Chat Area */}
      <div className="flex-1 flex flex-col z-10 bg-slate-950/80 relative">
        {selectedChatId && selectedChat ? (
          <>
            {/* Chat Pane Header */}
            <div className="h-[73px] border-b border-slate-800/60 bg-slate-900/20 backdrop-blur-md px-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={selectedChat.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${selectedChat.name}`}
                  alt={selectedChat.name}
                  className="w-10 h-10 rounded-xl bg-slate-850 border border-slate-800/50"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-white leading-tight">
                    {selectedChat.name}
                  </span>
                  <span className="text-xs text-slate-500 mt-0.5">
                    {activeTyping.length > 0
                      ? `${activeTyping.map((tu) => tu.username).join(', ')} is typing...`
                      : 'Online'}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Shared Notes / Canvas Toggle */}
                <button
                  onClick={() => setActiveRightPanel(activeRightPanel === 'notes' ? null : 'notes')}
                  className={`p-2.5 rounded-xl border transition-all shadow-sm flex items-center gap-2 ${
                    activeRightPanel === 'notes'
                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40' 
                    : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 border-indigo-500/20'
                  }`}
                  title="Shared Canvas"
                >
                  <FileText className="w-5 h-5" />
                </button>

                {/* AI Assistant Toggle */}
                <button
                  onClick={() => setActiveRightPanel(activeRightPanel === 'ai' ? null : 'ai')}
                  className={`p-2.5 rounded-xl border transition-all shadow-sm flex items-center gap-2 ${
                    activeRightPanel === 'ai'
                    ? 'bg-purple-600/20 text-purple-300 border-purple-500/40' 
                    : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 border-purple-500/20'
                  }`}
                  title="AI Assistant"
                >
                  <BrainCircuit className="w-5 h-5" />
                </button>

                {/* Call Button */}
                {selectedChat.otherUser?.id ? (
                  <button
                    onClick={() => {
                      const otherUserId = selectedChat.otherUser?.id;
                      if (otherUserId) {
                        webrtcService.callUser(otherUserId, selectedChat.name);
                      }
                    }}
                    className="p-2.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 transition-all shadow-sm"
                    title="Start Video Call"
                  >
                    <Video className="w-5 h-5" />
                  </button>
                ) : null}
              </div>
            </div>
            
            {/* Split Pane Container */}
            <div className="flex-1 flex overflow-hidden">
              {/* Main Chat Content */}
              <div className="flex-1 flex flex-col min-w-0 bg-slate-950/80">
                {/* Chat Pane Message History */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 custom-scrollbar">
              {/* Catch Me Up AI Action */}
              {messages.length > 5 && (
                <div className="flex justify-center mb-6">
                  <button
                    onClick={handleGenerateSummary}
                    disabled={isSummarizing}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 hover:border-indigo-400 text-sm font-medium text-indigo-300 hover:text-indigo-200 transition-all shadow-lg"
                  >
                    {isSummarizing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-purple-400" />
                    )}
                    {isSummarizing ? 'Summarizing...' : 'Catch Me Up'}
                  </button>
                </div>
              )}

              {/* Summary Display */}
              {summary && (
                <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-5 mb-6 text-sm text-indigo-100 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-3 opacity-20 pointer-events-none">
                    <Sparkles className="w-12 h-12" />
                  </div>
                  <h3 className="font-semibold text-indigo-300 flex items-center gap-2 mb-3">
                    <Wand2 className="w-4 h-4" /> AI Summary
                  </h3>
                  <div className="whitespace-pre-wrap leading-relaxed opacity-90 pl-1">{summary}</div>
                </div>
              )}

              {/* Pagination Trigger */}
              {hasMoreMessages && messages.length >= 50 && (
                <div className="flex justify-center pb-4">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 hover:border-slate-700 text-xs font-semibold text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-all"
                  >
                    {loadingMore ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Load older messages
                  </button>
                </div>
              )}

              {messages.length > 0 ? (
                messages.map((message) => {
                  const isMe = message.senderId === user.id;
                  const isSending = message.status === 'SENDING';
                  const isFailed = message.status === 'FAILED';
                  const isAI = message.senderId === 'SYSTEM_AI';

                  if (isAI) {
                    return (
                      <div key={message.id} className="flex gap-3 max-w-[85%] mr-auto group">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg border border-white/10 self-end mb-1">
                          <BrainCircuit className="w-4 h-4 text-white" />
                        </div>
                        <div className="flex flex-col">
                          <div className="px-5 py-3 rounded-2xl rounded-bl-none text-sm shadow-xl relative bg-slate-900 border border-indigo-500/30 text-indigo-50/90 overflow-hidden">
                            <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                              <Sparkles className="w-16 h-16" />
                            </div>
                            <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider mb-1 block flex items-center gap-1.5">
                              <Wand2 className="w-3 h-3" /> Synq AI Command
                            </span>
                            <div className="leading-relaxed relative z-10">{formatMessageContent(message.content)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={message.id}
                      className={`flex gap-3 max-w-[70%] ${isMe ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                    >
                      {!isMe && (
                        <img
                          src={message.senderAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${message.senderName}`}
                          alt={message.senderName}
                          className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/50 self-end mb-1"
                        />
                      )}
                      <div className="flex flex-col">
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-sm shadow-md transition-all relative group ${
                            isMe
                              ? isFailed 
                                ? 'bg-red-950/40 border border-red-500/30 text-slate-100 rounded-br-none'
                                : 'bg-indigo-600 text-white rounded-br-none'
                              : 'bg-slate-900 border border-slate-800/60 text-slate-100 rounded-bl-none'
                          } ${isSending ? 'opacity-60' : ''}`}
                        >
                          <div>{formatMessageContent(message.content)}</div>
                          
                          {/* Retry button for failed messages */}
                          {isFailed && (
                            <button
                              onClick={() => handleRetryMessage(message)}
                              className="absolute top-1/2 -left-10 -translate-y-1/2 p-1.5 rounded-md bg-slate-900 border border-slate-800 hover:border-red-500/40 text-red-400 hover:text-red-300 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Failed. Click to retry sending."
                            >
                              <RefreshCw className="w-3 h-3 animate-spin-reverse" />
                            </button>
                          )}
                        </div>
                        <div
                          className={`text-[10px] text-slate-500 mt-1 flex items-center gap-1.5 ${
                            isMe ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {isMe && isSending && (
                            <Clock className="w-3 h-3 text-slate-500 animate-pulse" />
                          )}
                          {isMe && isFailed && (
                            <span className="text-[9px] text-red-400 font-semibold uppercase tracking-wider">Failed</span>
                          )}
                          {isMe && message.status === 'SENT' && (
                            <Check className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          {isMe && message.status === 'DELIVERED' && (
                            <CheckCheck className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          {isMe && message.status === 'READ' && (
                            <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-4">
                  <MessageSquare className="w-12 h-12 text-slate-700 mb-3" />
                  <p className="font-semibold text-slate-400">Say hello!</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Start the conversation. Your messages are securely cached.
                  </p>
                </div>
              )}

              {/* Typing indicator inside messaging timeline */}
              {activeTyping.length > 0 && (
                <div className="flex gap-3 max-w-[70%] mr-auto items-center">
                  <img
                    src={selectedChat.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${selectedChat.name}`}
                    alt="typing"
                    className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/50"
                  />
                  <div className="bg-slate-900 border border-slate-800/60 px-4 py-3 rounded-2xl rounded-bl-none flex items-center gap-1 shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Smart Replies & Chat Pane Message Input */}
            <div className="p-4 bg-slate-900/10 backdrop-blur-md border-t border-slate-800/60 flex flex-col gap-3">
              
              {/* AI Smart Replies Row */}
              {smartReplies.length > 0 && (
                <div className="flex gap-2 px-1 overflow-x-auto custom-scrollbar pb-1">
                  {smartReplies.map((reply, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setMessageInput(reply);
                        setSmartReplies([]);
                      }}
                      className="px-4 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3 h-3 opacity-70" />
                      {reply}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleSendMessage} className="flex gap-3 items-center">
                <div className="flex-1 relative flex items-center">
                  {showCommandsDropdown && filteredCommands.length > 0 && (
                    <div className="absolute bottom-full left-0 mb-3 bg-slate-900 border border-slate-800/80 rounded-xl shadow-2xl w-80 max-h-60 overflow-y-auto z-30 p-1.5 divide-y divide-slate-800/50 backdrop-blur-xl animate-in slide-in-from-bottom-2 duration-200">
                      <div className="px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        AI Slash Commands
                      </div>
                      <div className="py-1">
                        {filteredCommands.map((cmd, idx) => {
                          const isActive = idx === activeCommandIndex;
                          return (
                            <button
                              key={cmd.name}
                              type="button"
                              onClick={() => selectCommand(cmd)}
                              className={`w-full text-left px-3 py-2 rounded-lg flex flex-col transition-colors ${
                                isActive 
                                  ? 'bg-purple-600/20 border border-purple-500/30 text-white' 
                                  : 'border border-transparent hover:bg-slate-800/50 text-slate-300 hover:text-slate-200'
                              }`}
                            >
                              <div className="flex justify-between items-center w-full">
                                <span className="text-xs font-bold text-purple-400 font-mono">{cmd.name}</span>
                                <span className="text-[9px] text-slate-500 font-mono">{cmd.usage}</span>
                              </div>
                              <span className="text-[10px] text-slate-400 mt-0.5">{cmd.description}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <input
                    type="text"
                    value={messageInput}
                    onChange={handleTyping}
                    onKeyDown={handleInputKeyDown}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 pr-10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all duration-200"
                    placeholder={`Write a message to ${selectedChat.name}...`}
                  />
                  <button
                    type="button"
                    className="absolute right-3 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <Smile className="w-5 h-5" />
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={!messageInput.trim()}
                  className="p-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-indigo-500/15 active:scale-[0.98] transition-all"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </form>
            </div>
          </div>
          
          {/* Shared Canvas / Collaborative Editor */}
          {activeRightPanel === 'notes' && selectedChatId && (
            <SharedNotes 
              chatId={selectedChatId} 
              onClose={() => setActiveRightPanel(null)} 
            />
          )}

          {/* AI Assistant Side Panel */}
          {activeRightPanel === 'ai' && selectedChatId && (
            <AIAssistant 
              chatId={selectedChatId} 
              onClose={() => setActiveRightPanel(null)} 
            />
          )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 mb-6 shadow-inner animate-pulse">
              <Users className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Start Messaging
            </h2>
            <p className="text-sm text-slate-400 max-w-sm mt-2">
              Select an existing contact from the sidebar or search for users to initiate a new direct message conversation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
