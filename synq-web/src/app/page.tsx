'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/authStore';
import { useCryptoStore } from '../stores/cryptoStore';
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
import MessageBody from '../components/MessageBody';
import SynqMark from '../components/SynqMark';
import GitHubPanel from '../components/github/GitHubPanel';
import ConnectGitHubModal from '../components/github/ConnectGitHubModal';
import LinkRepoModal from '../components/github/LinkRepoModal';
import PullRequestModal from '../components/github/PullRequestModal';
import CommitModal from '../components/github/CommitModal';
import CodeEditModal from '../components/github/CodeEditModal';
import RefAutocomplete, { RefSuggestion } from '../components/github/RefAutocomplete';
import { GitHubMark } from '../components/github/GitHubRefCard';
import { githubService, GitHubNotConnectedError } from '../services/githubService';
import { useGitHubStore } from '../stores/githubStore';
import { runGithubCommand } from '../lib/githubCommands';
import {
  useChatSummaries,
  formatPreview,
  formatListTimestamp,
  formatDayLabel,
  isSameDay,
  continuesGroup,
} from '../lib/chatDisplay';
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
  Copy,
  Zap,
  ChevronDown,
  ShieldCheck
} from 'lucide-react';

export default function ChatPage() {
  const router = useRouter();
  const { user, token, isAuthenticated, clearAuth } = useAuthStore();
  const {
    selectedChatId,
    typingUsers,
    setSelectedChatId,
    onlineUserIds,
    presenceReady,
    connectionState,
  } = useChatStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [usersList, setUsersList] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [activeRightPanel, setActiveRightPanel] = useState<'notes' | 'ai' | 'github' | null>(null);

  // Slash Commands Dropdown state
  const [showCommandsDropdown, setShowCommandsDropdown] = useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  const commands = [
    { name: '/summarize', description: 'Summarize conversation history', usage: '/summarize' },
    { name: '/search', description: 'Query vector database conceptually', usage: '/search <query>' },
    { name: '/translate', description: 'Translate text (e.g. spanish)', usage: '/translate <lang> <text>' },
    { name: '/explain', description: 'Explain a technical concept or code block', usage: '/explain <code/concept>' },
    { name: '/todo', description: 'List tasks detected by AI in this chat', usage: '/todo' },
    { name: '/agent', description: 'Run autonomous AI agent task', usage: '/agent <prompt>' },
    { name: '/pr', description: 'Explain a pull request from its real diff', usage: '/pr <number>' },
    { name: '/review', description: 'AI code review of a pull request', usage: '/review <number>' },
    { name: '/commit', description: 'Explain what a commit changed', usage: '/commit <sha>' },
    { name: '/issue', description: 'Open a GitHub issue from this conversation', usage: '/issue [title]' },
    { name: '/gh', description: 'Ask a question about the linked codebase', usage: '/gh <question>' },
    { name: '/repo', description: 'Show the repository linked to this chat', usage: '/repo' }
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
  const [smartActions, setSmartActions] = useState<any[]>([]);
  const [isFetchingReplies, setIsFetchingReplies] = useState(false);

  // Semantic Search State
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticResults, setSemanticResults] = useState<any[]>([]);
  const [isSearchingSemantic, setIsSearchingSemantic] = useState(false);
  const [showSemanticModal, setShowSemanticModal] = useState(false);

  // GitHub reference autocomplete state (triggered by typing `#`)
  const [refQuery, setRefQuery] = useState<string | null>(null);
  const [refSuggestions, setRefSuggestions] = useState<RefSuggestion[]>([]);
  const [activeRefIndex, setActiveRefIndex] = useState(0);

  const {
    status: githubStatus,
    setStatus: setGithubStatus,
    setRepos: setGithubRepos,
    reposByChat,
    unreadActivity,
    openConnectModal,
    pendingComposerInsert,
    queueComposerInsert,
  } = useGitHubStore();

  const [isNearBottom, setIsNearBottom] = useState(true);
  const [missedWhileScrolledUp, setMissedWhileScrolledUp] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);

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

  const activeTypingCount = selectedChatId ? (typingUsers[selectedChatId] || []).length : 0;

  // Keyboard shortcuts. "/" jumps to people search, Escape leaves the field —
  // both advertised in the UI, so both have to be real.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'Escape' && target === searchInputRef.current) {
        searchInputRef.current?.blur();
        setShowSearchResults(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 4. Autoscroll — only when the reader is already at the bottom, or the new
  // message is their own. Scrolling someone away from history they are reading
  // is worse than letting them miss one message.
  const newestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  const newestIsMine = messages.length > 0 && messages[messages.length - 1].senderId === user?.id;

  useEffect(() => {
    if (!newestMessageId) return;
    if (!isNearBottom && !newestIsMine) {
      setMissedWhileScrolledUp((count) => count + 1);
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [newestMessageId]);

  // Typing indicators only nudge the view when already pinned to the bottom.
  useEffect(() => {
    if (isNearBottom && activeTypingCount > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTypingCount]);

  // Anything that arrived while scrolled up or on a hidden tab is read once the
  // reader is actually looking at the bottom of the open conversation.
  useEffect(() => {
    if (!selectedChatId || !isNearBottom) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    socketService.markAsRead(selectedChatId);
  }, [selectedChatId, isNearBottom, newestMessageId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && selectedChatId && isNearBottom) {
        socketService.markAsRead(selectedChatId);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedChatId, isNearBottom]);

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setIsNearBottom(atBottom);
    if (atBottom) setMissedWhileScrolledUp(0);
  };

  const jumpToLatest = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsNearBottom(true);
    setMissedWhileScrolledUp(0);
  };

  // 4b. GitHub connection status — drives whether references resolve at all
  useEffect(() => {
    if (!isAuthenticated) return;
    githubService
      .getStatus()
      .then(setGithubStatus)
      .catch(() => setGithubStatus(null));
  }, [isAuthenticated, setGithubStatus]);

  // 4c. Repositories linked to the open conversation. These make bare `#123`
  // and `src/file.ts:20-40` shorthand resolvable in this chat's messages.
  useEffect(() => {
    if (!selectedChatId || !githubStatus?.connected) return;

    let cancelled = false;
    githubService
      .listChatRepositories(selectedChatId)
      .then((repos) => {
        if (!cancelled) setGithubRepos(selectedChatId, repos);
      })
      .catch((err) => {
        if (!(err instanceof GitHubNotConnectedError)) {
          console.error('Failed to load linked repositories:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChatId, githubStatus?.connected, setGithubRepos]);

  // 4d. Text queued by "share in chat" actions across the GitHub surfaces.
  useEffect(() => {
    if (!pendingComposerInsert) return;
    setMessageInput((current) => {
      const separator = current && !current.endsWith(' ') ? ' ' : '';
      return `${current}${separator}${pendingComposerInsert} `;
    });
    queueComposerInsert(null);
    messageInputRef.current?.focus();
  }, [pendingComposerInsert, queueComposerInsert]);

  // 5. Join Room when Chat Selected
  useEffect(() => {
    if (selectedChatId) {
      socketService.joinChat(selectedChatId);
      socketService.markAsRead(selectedChatId);
      fetchMessagesInitial(selectedChatId);
      setSummary(null);
      setSmartReplies([]);

      // Opening a conversation should land at the newest message, instantly —
      // a smooth scroll through the whole history reads as a glitch.
      setIsNearBottom(true);
      setMissedWhileScrolledUp(0);
      setHasMoreMessages(true);
      requestAnimationFrame(() => {
        const el = messagesContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [selectedChatId]);

  // 5b. Re-decrypt messages after PIN entry unlocks crypto keys
  const { isUnlocked } = useCryptoStore();
  useEffect(() => {
    if (!isUnlocked || !selectedChatId) return;
    
    const decryptCachedCiphertext = async () => {
      const cachedMessages = await localDb.messages.where('chatId').equals(selectedChatId).toArray();
      const ciphertextMessages = cachedMessages.filter(m => isLikelyCiphertext(m.content));
      
      if (ciphertextMessages.length === 0) return;
      
      console.log(`[PostUnlock] Decrypting ${ciphertextMessages.length} ciphertext messages...`);
      
      for (const msg of ciphertextMessages) {
        const decrypted = await tryDecryptMessage(msg.content, msg.senderId, msg.chatId);
        if (decrypted !== msg.content) {
          await localDb.messages.update(msg.id, { content: decrypted });
        }
      }
    };
    
    decryptCachedCiphertext();
  }, [isUnlocked, selectedChatId]);

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
      const { replies, actions } = await aiService.getSmartReplies(messages.slice(-5));
      setSmartReplies(replies);
      setSmartActions(actions);
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

  /** Newest message + unread count per chat, kept live by Dexie. */
  const chatSummaries = useChatSummaries(
    useMemo(() => chats.map((c) => c.id), [chats]),
    user?.id
  );

  /** Presence, straight from the server rather than assumed. */
  const isUserOnline = (userId?: string | null) =>
    Boolean(presenceReady && userId && onlineUserIds.includes(userId));

  /** The repository this conversation's shorthand references resolve against. */
  const primaryRepo = useMemo(() => {
    if (!selectedChatId) return null;
    const repos = reposByChat[selectedChatId];
    if (!repos || repos.length === 0) return null;
    return repos.find((r) => r.isPrimary) || repos[0];
  }, [selectedChatId, reposByChat]);

  const isLikelyCiphertext = (text: string) => text.length >= 80 && /^[0-9a-fA-F]+$/.test(text);

  const fetchMessagesInitial = async (chatId: string) => {
    try {
      // 1. Check if localDb already has decrypted messages for this chat
      const existingMessages = await localDb.messages.where('chatId').equals(chatId).toArray();
      const hasCachedPlaintext = existingMessages.length > 0 && 
        existingMessages.every(m => !isLikelyCiphertext(m.content));

      if (hasCachedPlaintext) {
        // Local DB already has all plaintext — no need to hit the server or re-decrypt.
        // Do a silent background sync to pick up any NEW messages we might have missed.
        const newestLocal = existingMessages.reduce((a, b) => 
          new Date(a.createdAt) > new Date(b.createdAt) ? a : b
        );
        
        const res = await apiService.get(`/chats/${chatId}/messages?limit=50`);
        if (res.ok) {
          const data = await res.json();
          // Only process messages that are NOT already in localDb
          const existingIds = new Set(existingMessages.map(m => m.id));
          const newMessages = data.filter((m: any) => !existingIds.has(m.id));
          
          if (newMessages.length > 0) {
            const decrypted = await Promise.all(newMessages.map(async (m: any) => ({
              id: m.id,
              chatId: m.chatId,
              senderId: m.senderId,
              content: await tryDecryptMessage(m.content, m.senderId, m.chatId),
              createdAt: m.createdAt,
              status: m.status || 'SENT',
              senderName: m.sender.username,
              senderAvatar: m.sender.avatar || undefined,
            })));
            await localDb.messages.bulkPut(decrypted);
          }
        }
        return;
      }

      // 2. No local cache — full fetch + decrypt from server
      const res = await apiService.get(`/chats/${chatId}/messages?limit=50`);
      if (res.ok) {
        const data = await res.json();
        const existingMap = new Map(existingMessages.map(m => [m.id, m]));

        const localMessages = await Promise.all(data.map(async (m: any) => {
          let finalContent = m.content;
          const existing = existingMap.get(m.id);
          
          if (existing && !isLikelyCiphertext(existing.content)) {
             finalContent = existing.content;
          } else {
             finalContent = await tryDecryptMessage(m.content, m.senderId, m.chatId);
             
             if (existing && finalContent !== m.content) {
                await localDb.messages.update(m.id, { content: finalContent });
             }
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
      // Prepending changes scrollHeight; hold the reader's place afterwards.
      const container = messagesContainerRef.current;
      const heightBefore = container?.scrollHeight ?? 0;
      const topBefore = container?.scrollTop ?? 0;
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
            
            if (existing && !isLikelyCiphertext(existing.content)) {
               finalContent = existing.content;
            } else {
               finalContent = await tryDecryptMessage(m.content, m.senderId, m.chatId);
               
               if (existing && finalContent !== m.content) {
                  await localDb.messages.update(m.id, { content: finalContent });
               }
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
      requestAnimationFrame(() => {
        const el = messagesContainerRef.current;
        if (el) el.scrollTop = topBefore + (el.scrollHeight - heightBefore);
      });
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

    const recognizedCommands = [
      '/summarize', '/search', '/translate', '/explain', '/todo', '/agent',
      '/pr', '/review', '/commit', '/issue', '/gh', '/repo',
    ];
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
        case '/pr':
        case '/review':
        case '/commit':
        case '/issue':
        case '/gh':
        case '/repo':
          aiResponse = await runGithubCommand(command, args, chatId, {
            connected: Boolean(githubStatus?.connected),
            repos: reposByChat[chatId] || [],
          });
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

    // Typing `#` opens the pull request / issue picker for the linked repository.
    const caret = e.target.selectionStart ?? val.length;
    const refMatch = val.slice(0, caret).match(/(?:^|\s)#([\w-]*)$/);
    if (refMatch && primaryRepo) {
      setRefQuery(refMatch[1]);
      setActiveRefIndex(0);
    } else if (refQuery !== null) {
      setRefQuery(null);
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

  /** Replaces the partial `#…` token at the caret with the chosen reference. */
  const selectRefSuggestion = (item: RefSuggestion) => {
    const input = messageInputRef.current;
    const caret = input?.selectionStart ?? messageInput.length;
    const before = messageInput.slice(0, caret).replace(/#[\w-]*$/, `#${item.number} `);
    const after = messageInput.slice(caret);

    setMessageInput(before + after);
    setRefQuery(null);

    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(before.length, before.length);
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (refQuery !== null && refSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveRefIndex((prev) => (prev + 1) % refSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveRefIndex((prev) => (prev - 1 + refSuggestions.length) % refSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectRefSuggestion(refSuggestions[activeRefIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setRefQuery(null);
        return;
      }
    }

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
    
    // Clear local database to prevent data leaking to next user on same device
    await localDb.chats.clear();
    await localDb.messages.clear();
    await localDb.outbox.clear();
    
    // Wipe encryption keys from memory
    useCryptoStore.getState().lockKeys();
    
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
      <div className="min-h-screen app-canvas flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 fade">
          <SynqMark variant="badge" className="w-10 h-10" />
          <div className="h-0.5 w-24 rounded-full bg-line overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-accent animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen app-canvas text-ink overflow-hidden">
      <PinModal />
      <CallModal />

      {/* GitHub surfaces — opened from references, the panel, or the composer */}
      <ConnectGitHubModal />
      {selectedChatId && <LinkRepoModal chatId={selectedChatId} />}
      <PullRequestModal />
      <CommitModal />
      <CodeEditModal />
      
      {/* Semantic Search Modal */}
      {showSemanticModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/85 backdrop-blur-sm">
          <div className="bg-surface border border-line-strong rounded-2xl w-full max-w-2xl shadow-2xl shadow-black/60 flex flex-col h-[80vh] rise">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
              <BrainCircuit className="w-4 h-4 text-accent-bright" />
              <h2 className="text-[14px] font-semibold text-ink">AI Memory Search</h2>
              <button 
                onClick={() => { setShowSemanticModal(false); setSemanticResults([]); setSemanticQuery(''); }}
                className="ml-auto p-1.5 text-subtle hover:text-ink hover:bg-hover rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSemanticSearch} className="p-3 border-b border-line">
              <div className="relative flex items-center">
                <Search className="absolute left-3.5 w-4 h-4 text-faint" />
                <input
                  type="text"
                  value={semanticQuery}
                  onChange={(e) => setSemanticQuery(e.target.value)}
                  placeholder="Ask your memory... e.g., 'What was the password for the database?'"
                  className="w-full h-11 pl-10 pr-24 bg-raised border border-line rounded-xl focus:outline-none focus:border-accent/50 text-[13.5px] text-ink placeholder-faint transition-colors"
                />
                <button
                  type="submit"
                  disabled={isSearchingSemantic || !semanticQuery.trim()}
                  className="absolute right-2 px-3 py-1.5 bg-accent hover:bg-accent-bright disabled:bg-raised disabled:text-faint text-white rounded-lg text-[12px] font-medium transition-colors"
                >
                  {isSearchingSemantic ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                </button>
              </div>
            </form>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {semanticResults.length === 0 && !isSearchingSemantic && (
                <div className="h-full flex flex-col items-center justify-center text-subtle">
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
                  className="p-3 rounded-xl border border-line bg-raised hover:bg-hover hover:border-line-strong cursor-pointer transition-colors group relative"
                >
                  <div className="flex items-start gap-3">
                    <img src={result.senderAvatar} alt="" className="w-8 h-8 rounded-lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-[13px] text-ink">{result.senderName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-soft text-accent-ink border border-accent/25 tnum">
                            {Math.round(result.confidence * 100)}% match
                          </span>
                          <span className="text-[11px] text-subtle tnum">
                            {new Date(result.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <p className="text-[12.5px] text-muted line-clamp-3 mt-1">{result.content}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 1. Left Sidebar */}
      <aside className="w-[290px] shrink-0 border-r border-line bg-surface flex flex-col z-10 relative">
        {/* Workspace identity */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b border-line">
          <SynqMark variant="badge" className="w-6 h-6" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">Synq</span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-subtle" title={`Realtime connection: ${connectionState}`}>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connectionState === 'online'
                  ? 'bg-positive'
                  : connectionState === 'connecting'
                  ? 'bg-caution animate-pulse'
                  : 'bg-faint'
              }`}
            />
            {connectionState === 'online' ? 'Live' : connectionState === 'connecting' ? 'Syncing' : 'Offline'}
          </span>
        </div>

        {/* Search / Directory */}
        <div className="px-3 pt-3 pb-2 relative">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint group-focus-within:text-accent-bright transition-colors" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(e.target.value.length > 0);
              }}
              onFocus={() => setShowSearchResults(searchQuery.length > 0)}
              className="w-full h-9 pl-9 pr-12 rounded-lg border border-line bg-raised text-[13px] text-ink placeholder-faint focus:outline-none focus:border-accent/50 focus:bg-hover transition-colors"
              placeholder="Find people…"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 h-5 flex items-center rounded border border-line bg-surface text-[10px] font-mono text-faint pointer-events-none">
              /
            </kbd>
          </div>

          {/* Search Dropdown Panel */}
          {showSearchResults && (
            <div className="absolute top-full left-3 right-3 mt-1.5 bg-raised border border-line-strong rounded-xl shadow-2xl shadow-black/60 max-h-64 overflow-y-auto z-30 p-1 custom-scrollbar rise">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleStartChat(u.id)}
                    className="w-full p-2 flex items-center gap-2.5 rounded-lg hover:bg-hover transition-colors text-left"
                  >
                    <img src={u.avatar} alt="" className="w-7 h-7 rounded-md bg-surface shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[13px] font-medium text-ink truncate">{u.username}</span>
                      <span className="text-[11px] text-subtle truncate">{u.email}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-5 text-center text-xs text-subtle flex flex-col items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-faint" />
                  No one matches “{searchQuery}”
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chats History List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 custom-scrollbar">
          <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
            <span className="text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
              Conversations
            </span>
            <span className="text-[10px] text-faint tnum">{chats.length > 0 ? chats.length : ''}</span>
          </div>
          {loadingChats ? (
            <div className="space-y-1 pt-1" aria-label="Loading conversations">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                  <div className="w-8 h-8 rounded-lg bg-raised animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-2.5 rounded bg-raised animate-pulse" style={{ width: 55 + i * 8 + '%' }} />
                    <div className="h-2 rounded bg-raised/60 animate-pulse" style={{ width: 75 - i * 6 + '%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : chats.length > 0 ? (
            chats.map((chat) => {
              const isSelected = chat.id === selectedChatId;
              const hasTyping = (typingUsers[chat.id] || []).length > 0;
              const summary = chatSummaries[chat.id];
              const unread = summary?.unreadCount || 0;
              const online = isUserOnline(chat.otherUser?.id);
              const stampSource = summary?.lastMessage?.createdAt || chat.updatedAt;

              return (
                <button
                  key={chat.id}
                  onClick={() => setSelectedChatId(chat.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`group relative w-full pl-3 pr-2.5 py-2 flex items-center gap-2.5 rounded-lg text-left transition-colors ${
                    isSelected ? 'bg-active' : 'hover:bg-hover'
                  }`}
                >
                  {/* Selection reads as a rail, not a filled box — quieter at rest. */}
                  <span
                    className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full bg-accent-bright transition-all ${
                      isSelected ? 'h-6 opacity-100' : 'h-0 opacity-0'
                    }`}
                  />

                  <div className="relative shrink-0">
                    <img
                      src={chat.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${chat.name}`}
                      alt=""
                      className="w-8 h-8 rounded-lg bg-raised"
                    />
                    {/* Only drawn once the server has told us who is actually connected. */}
                    {online && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-positive ring-2 ring-surface"
                        title={`${chat.name} is online`}
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-[13px] truncate ${
                          unread > 0
                            ? 'font-semibold text-ink'
                            : isSelected
                            ? 'font-medium text-ink'
                            : 'font-medium text-muted'
                        }`}
                      >
                        {chat.name}
                      </span>
                      <span
                        className={`ml-auto shrink-0 text-[10px] tnum ${
                          unread > 0 ? 'text-accent-bright' : 'text-faint'
                        }`}
                      >
                        {formatListTimestamp(stampSource)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[11.5px] truncate min-w-0 leading-snug">
                        {hasTyping ? (
                          <span className="text-accent-bright">typing…</span>
                        ) : (
                          <span className={unread > 0 ? 'text-muted' : 'text-subtle'}>
                            {formatPreview(summary?.lastMessage ?? null, user.id)}
                          </span>
                        )}
                      </p>

                      {unread > 0 && (
                        <span
                          className="ml-auto shrink-0 min-w-[17px] h-[17px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold tnum flex items-center justify-center"
                          aria-label={`${unread} unread messages`}
                        >
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-8 text-center">
              <p className="text-[13px] font-medium text-muted">No conversations yet</p>
              <p className="text-[11.5px] text-subtle mt-1 leading-relaxed">
                Search for a teammate above to start one.
              </p>
            </div>
          )}
        </div>

        {/* Account + workspace actions */}
        <div className="border-t border-line p-2 flex items-center gap-2">
          <img
            src={user.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`}
            alt=""
            className="w-7 h-7 rounded-md bg-raised shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium text-ink truncate leading-tight">{user.username}</div>
            <div className="text-[10.5px] text-subtle truncate leading-tight">{user.email}</div>
          </div>
          <button
            onClick={() => setShowSemanticModal(true)}
            aria-label="Search your message history by meaning"
            title="Memory search"
            className="p-1.5 rounded-md text-subtle hover:text-accent-bright hover:bg-hover transition-colors"
          >
            <BrainCircuit className="w-4 h-4" />
          </button>
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            title="Sign out"
            className="p-1.5 rounded-md text-subtle hover:text-critical hover:bg-hover transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* 2. Main Chat Area */}
      <div className="flex-1 flex flex-col z-10 relative min-w-0">
        {selectedChatId && selectedChat ? (
          <>
            {/* Chat Pane Header */}
            <header className="h-14 shrink-0 border-b border-line bg-surface/80 backdrop-blur-xl px-4 flex items-center gap-3">
              <div className="relative shrink-0">
                <img
                  src={selectedChat.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${selectedChat.name}`}
                  alt=""
                  className="w-8 h-8 rounded-lg bg-raised"
                />
                {isUserOnline(selectedChat.otherUser?.id) && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-positive ring-2 ring-surface" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-ink leading-tight truncate">
                  {selectedChat.name}
                </div>
                <div className="text-[11px] leading-tight mt-0.5 truncate">
                  {activeTyping.length > 0 ? (
                    <span className="text-accent-bright">
                      {activeTyping.map((tu) => tu.username).join(', ')} is typing…
                    </span>
                  ) : primaryRepo ? (
                    <span className="text-subtle font-mono">{primaryRepo.fullName}</span>
                  ) : isUserOnline(selectedChat.otherUser?.id) ? (
                    <span className="text-positive">Online</span>
                  ) : (
                    <span className="text-subtle">Offline</span>
                  )}
                </div>
              </div>

              {/* One segmented control instead of four competing buttons */}
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-raised border border-line shrink-0">
                <PanelTab
                  active={activeRightPanel === 'github'}
                  onClick={() => setActiveRightPanel(activeRightPanel === 'github' ? null : 'github')}
                  label={
                    primaryRepo
                      ? `GitHub — ${primaryRepo.fullName}`
                      : githubStatus?.connected
                      ? 'GitHub — link a repository'
                      : 'Connect GitHub'
                  }
                  badge={unreadActivity[selectedChatId] || 0}
                  dot={!githubStatus?.connected}
                >
                  <GitHubMark className="w-4 h-4" />
                </PanelTab>

                <PanelTab
                  active={activeRightPanel === 'ai'}
                  onClick={() => setActiveRightPanel(activeRightPanel === 'ai' ? null : 'ai')}
                  label="AI assistant"
                >
                  <BrainCircuit className="w-4 h-4" />
                </PanelTab>

                <PanelTab
                  active={activeRightPanel === 'notes'}
                  onClick={() => setActiveRightPanel(activeRightPanel === 'notes' ? null : 'notes')}
                  label="Shared canvas"
                >
                  <FileText className="w-4 h-4" />
                </PanelTab>
              </div>

              {selectedChat.otherUser?.id ? (
                <button
                  onClick={() => {
                    const otherUserId = selectedChat.otherUser?.id;
                    if (otherUserId) webrtcService.callUser(otherUserId, selectedChat.name);
                  }}
                  aria-label={`Start a video call with ${selectedChat.name}`}
                  title="Start video call"
                  className="shrink-0 p-2 rounded-lg text-muted hover:text-ink hover:bg-hover transition-colors"
                >
                  <Video className="w-4 h-4" />
                </button>
              ) : null}
            </header>

            {/* Split Pane Container */}
            <div className="flex-1 flex overflow-hidden">
              {/* Main Chat Content */}
              <div className="flex-1 flex flex-col min-w-0 relative">
                {/* Chat Pane Message History */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleMessagesScroll}
                  className="flex-1 overflow-y-auto p-6 min-h-0 custom-scrollbar relative"
                >
              {/* Catch Me Up AI Action */}
              {messages.length > 5 && !summary && (
                <div className="flex justify-center pb-2">
                  <button
                    onClick={handleGenerateSummary}
                    disabled={isSummarizing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line bg-raised hover:border-accent/40 hover:text-accent-ink text-[11.5px] font-medium text-muted transition-colors disabled:opacity-50"
                  >
                    {isSummarizing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {isSummarizing ? 'Reading the thread…' : 'Catch me up'}
                  </button>
                </div>
              )}

              {/* Summary Display */}
              {summary && (
                <div className="rounded-xl border border-accent/25 bg-accent-soft overflow-hidden mb-2 rise">
                  <div className="flex items-center gap-2 px-3.5 py-2 border-b border-accent/15">
                    <Wand2 className="w-3.5 h-3.5 text-accent-bright" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-ink flex-1">
                      Caught up
                    </span>
                    <button
                      onClick={() => setSummary(null)}
                      aria-label="Dismiss summary"
                      className="p-0.5 rounded text-accent-ink/60 hover:text-accent-ink transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="px-3.5 py-3 text-[12.5px] leading-relaxed text-ink/90 whitespace-pre-wrap">
                    {summary}
                  </div>
                </div>
              )}

              {/* Pagination Trigger */}
              {hasMoreMessages && messages.length >= 50 && (
                <div className="flex justify-center pb-3">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line bg-raised hover:bg-hover text-[11.5px] font-medium text-muted hover:text-ink disabled:opacity-50 transition-colors"
                  >
                    {loadingMore ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    {loadingMore ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              )}

              {messages.length > 0 ? (
                messages.map((message, messageIndex) => {
                  const isMe = message.senderId === user.id;
                  const isSending = message.status === 'SENDING';
                  const isFailed = message.status === 'FAILED';
                  const isAI = message.senderId === 'SYSTEM_AI';

                  const previous = messages[messageIndex - 1];
                  const startsNewDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
                  const grouped = !startsNewDay && continuesGroup(previous, message);
                  const next = messages[messageIndex + 1];
                  const endsGroup = !next || !continuesGroup(message, next);

                  const daySeparator = startsNewDay ? (
                    <div key={`day-${message.id}`} className="flex items-center gap-3 pt-6 pb-1">
                      <div className="flex-1 h-px bg-line" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                        {formatDayLabel(message.createdAt)}
                      </span>
                      <div className="flex-1 h-px bg-line" />
                    </div>
                  ) : null;

                  if (isAI) {
                    return (
                      <React.Fragment key={`wrap-${message.id}`}>
                      {daySeparator}
                      <div key={message.id} className="mt-4 rounded-xl border border-accent/20 bg-accent-soft overflow-hidden rise">
                        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-accent/12">
                          <Wand2 className="w-3.5 h-3.5 text-accent-bright" />
                          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-ink flex-1">
                            Synq AI
                          </span>
                          <span className="text-[10px] text-subtle tnum">
                            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="px-3.5 py-3 text-[13px] text-ink/90">
                          <MessageBody content={message.content} chatId={selectedChatId} />
                        </div>
                      </div>
                      </React.Fragment>
                    );
                  }

                  return (
                    <React.Fragment key={`wrap-${message.id}`}>
                    {daySeparator}
                    <div
                      className={`flex gap-3 max-w-[min(72%,680px)] ${isMe ? 'ml-auto flex-row-reverse' : 'mr-auto'} ${
                        grouped ? 'mt-1' : 'mt-4'
                      }`}
                    >
                      {/* A grouped message keeps the avatar column but leaves it
                          empty, so consecutive bubbles stay aligned. */}
                      {!isMe &&
                        (grouped ? (
                          <div className="w-8 shrink-0" aria-hidden="true" />
                        ) : (
                          <img
                            src={message.senderAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${message.senderName}`}
                            alt=""
                            className="w-8 h-8 rounded-lg bg-raised self-end mb-1 shrink-0"
                          />
                        ))}
                      <div className="flex flex-col">
                        <div
                          className={`px-3.5 py-2 text-[13.5px] leading-relaxed transition-all relative group ${
                            isMe
                              ? isFailed
                                ? 'bg-critical/10 border border-critical/30 text-ink rounded-xl rounded-br-sm'
                                : 'bg-accent text-white rounded-xl rounded-br-sm on-accent'
                              : 'bg-raised border border-line text-ink rounded-xl rounded-bl-sm'
                          } ${grouped ? (isMe ? 'rounded-tr-sm' : 'rounded-tl-sm') : ''} ${
                            isSending ? 'opacity-60' : ''
                          }`}
                        >
                          <MessageBody content={message.content} chatId={selectedChatId} />
                          
                          {/* Retry button for failed messages */}
                          {isFailed && (
                            <button
                              onClick={() => handleRetryMessage(message)}
                              className="absolute top-1/2 -left-9 -translate-y-1/2 p-1.5 rounded-md bg-raised border border-line hover:border-critical/40 text-critical shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Failed. Click to retry sending."
                            >
                              <RefreshCw className="w-3 h-3 animate-spin-reverse" />
                            </button>
                          )}
                        </div>
                        <div
                          className={`text-[10px] text-faint tnum flex items-center gap-1.5 ${
                            isMe ? 'justify-end' : 'justify-start'
                          } ${endsGroup || isFailed || isSending ? 'mt-1' : 'h-0 overflow-hidden'}`}
                        >
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {isMe && isSending && (
                            <Clock className="w-3 h-3 text-faint animate-pulse" />
                          )}
                          {isMe && isFailed && (
                            <span className="text-[9px] text-critical font-semibold uppercase tracking-wider">Failed</span>
                          )}
                          {isMe && message.status === 'SENT' && (
                            <Check className="w-3.5 h-3.5 text-faint" />
                          )}
                          {isMe && message.status === 'DELIVERED' && (
                            <CheckCheck className="w-3.5 h-3.5 text-faint" />
                          )}
                          {isMe && message.status === 'READ' && (
                            <CheckCheck className="w-3.5 h-3.5 text-accent-bright" />
                          )}
                        </div>
                      </div>
                    </div>
                    </React.Fragment>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10">
                  <div className="w-11 h-11 rounded-xl bg-raised border border-line flex items-center justify-center mb-4">
                    <MessageSquare className="w-5 h-5 text-subtle" />
                  </div>
                  <p className="text-[14px] font-semibold text-ink">
                    Start talking to {selectedChat.name}
                  </p>
                  <p className="text-[12px] text-subtle mt-1.5 max-w-xs leading-relaxed">
                    Messages are end-to-end encrypted. Reference code inline and it resolves live:
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
                    {['#412', '@a1b2c3d', 'src/app/page.tsx:20-40'].map((token) => (
                      <code
                        key={token}
                        className="px-2 py-1 rounded-md bg-raised border border-line font-mono text-[11px] text-accent-ink"
                      >
                        {token}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {/* Typing indicator inside messaging timeline */}
              {activeTyping.length > 0 && (
                <div className="flex gap-3 max-w-[70%] mr-auto items-center mt-4">
                  <img
                    src={selectedChat.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${selectedChat.name}`}
                    alt=""
                    className="w-8 h-8 rounded-lg bg-raised"
                  />
                  <div className="bg-raised border border-line px-3.5 py-2.5 rounded-xl rounded-bl-sm flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-subtle animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-subtle animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-subtle animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {!isNearBottom && (
              <button
                onClick={jumpToLatest}
                aria-label="Jump to latest messages"
                className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full bg-raised hover:bg-hover border border-line-strong text-[11.5px] font-medium text-ink shadow-2xl shadow-black/50 transition-colors rise"
              >
                <ChevronDown className="w-4 h-4" />
                {missedWhileScrolledUp > 0
                  ? `${missedWhileScrolledUp} new message${missedWhileScrolledUp === 1 ? '' : 's'}`
                  : 'Jump to latest'}
              </button>
            )}

            {/* Smart Replies & Chat Pane Message Input */}
            <div className="px-4 pt-2.5 pb-3 bg-surface/70 backdrop-blur-xl border-t border-line flex flex-col gap-2">
              
            {/* AI Smart Replies & Actions Row */}
            {(smartReplies.length > 0 || smartActions.length > 0) && (
              <div className="flex gap-2 px-1 overflow-x-auto custom-scrollbar pb-1">
                {smartActions.map((action, idx) => (
                  <button
                    key={`action-${idx}`}
                    onClick={() => {
                      if (!selectedChatId) return;
                      if (action.action === 'extractTodo') {
                        executeSlashCommand('/todo', selectedChatId);
                      } else if (action.action === 'searchLocalFiles') {
                        executeSlashCommand(`/agent search local files for ${action.query || 'documents'}`, selectedChatId);
                      }
                      setSmartActions([]);
                      setSmartReplies([]);
                    }}
                    className="px-2.5 py-1 rounded-full border border-accent/30 bg-accent-soft hover:border-accent/60 text-accent-ink text-[11.5px] font-medium whitespace-nowrap transition-colors flex items-center gap-1.5"
                  >
                    <Zap className="w-3 h-3" />
                    {action.label}
                  </button>
                ))}
                {smartReplies.map((reply, idx) => (
                  <button
                    key={`reply-${idx}`}
                    onClick={() => {
                      setMessageInput(reply);
                      setSmartReplies([]);
                      setSmartActions([]);
                    }}
                    className="px-2.5 py-1 rounded-full border border-line bg-raised hover:border-line-strong hover:text-ink text-muted text-[11.5px] font-medium whitespace-nowrap transition-colors flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3 h-3 opacity-60" />
                    {reply}
                  </button>
                ))}
              </div>
            )}

              <form onSubmit={handleSendMessage} className="flex gap-3 items-center">
                <div className="flex-1 relative flex items-center">
                  {showCommandsDropdown && filteredCommands.length > 0 && (
                    <div className="absolute bottom-full left-0 mb-2 bg-surface border border-line-strong rounded-xl shadow-2xl shadow-black/60 w-[340px] max-h-64 overflow-y-auto z-30 p-1 custom-scrollbar rise">
                      <div className="px-2.5 py-1.5 text-[10px] font-semibold text-faint uppercase tracking-[0.08em]">
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
                                  ? 'bg-active text-ink' 
                                  : 'text-muted hover:bg-hover hover:text-ink'
                              }`}
                            >
                              <div className="flex justify-between items-center w-full">
                                <span className="text-[12px] font-semibold text-accent-ink font-mono">{cmd.name}</span>
                                <span className="text-[10px] text-faint font-mono">{cmd.usage}</span>
                              </div>
                              <span className="text-[10.5px] text-subtle mt-0.5">{cmd.description}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {refQuery !== null && selectedChatId && (
                    <RefAutocomplete
                      chatId={selectedChatId}
                      query={refQuery}
                      activeIndex={activeRefIndex}
                      onSuggestions={setRefSuggestions}
                      onSelect={selectRefSuggestion}
                    />
                  )}
                  <input
                    ref={messageInputRef}
                    type="text"
                    value={messageInput}
                    onChange={handleTyping}
                    onKeyDown={handleInputKeyDown}
                    onBlur={() => setRefQuery(null)}
                    className="w-full h-11 bg-raised border border-line rounded-xl pl-3.5 pr-10 text-[13.5px] text-ink placeholder-faint focus:outline-none focus:border-accent/50 focus:bg-hover transition-colors"
                    placeholder={
                      primaryRepo
                        ? `Message ${selectedChat.name} — # for a PR, path/file.ts:20-40 for code`
                        : `Write a message to ${selectedChat.name}...`
                    }
                  />
                  <span
                    className="absolute right-3 text-faint pointer-events-none"
                    title="Type / for commands, # to reference a pull request"
                  >
                    <Smile className="w-4 h-4" />
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={!messageInput.trim()}
                  aria-label="Send message"
                  className="h-11 w-11 shrink-0 grid place-items-center rounded-xl bg-accent hover:bg-accent-bright disabled:bg-raised disabled:text-faint text-white active:scale-[0.97] transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>

              <div className="flex items-center gap-3 px-0.5 text-[10.5px] text-faint">
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-px rounded border border-line bg-raised font-mono">/</kbd>
                  commands
                </span>
                {primaryRepo && (
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-px rounded border border-line bg-raised font-mono">#</kbd>
                    reference {primaryRepo.name}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  End-to-end encrypted
                </span>
              </div>
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

          {/* GitHub Workspace Side Panel */}
          {activeRightPanel === 'github' && selectedChatId && (
            <GitHubPanel
              chatId={selectedChatId}
              onClose={() => setActiveRightPanel(null)}
            />
          )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <SynqMark className="w-10 h-10 text-line-strong mb-5" />
            <h2 className="text-lg font-semibold text-ink tracking-tight">No conversation open</h2>
            <p className="text-[13px] text-subtle max-w-sm mt-2 leading-relaxed">
              Pick a conversation from the sidebar, or press{' '}
              <kbd className="px-1.5 py-0.5 rounded border border-line bg-raised font-mono text-[11px] text-muted">/</kbd>{' '}
              to find a teammate.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One segment of the header's panel switcher. Icon-only, so the accessible name
 * comes from the label rather than the glyph.
 */
function PanelTab({
  active,
  onClick,
  label,
  children,
  badge = 0,
  dot = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  badge?: number;
  dot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`relative p-1.5 rounded-md transition-colors ${
        active ? 'bg-active text-ink shadow-sm' : 'text-subtle hover:text-ink hover:bg-hover'
      }`}
    >
      {children}
      {badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-accent text-white text-[9px] font-semibold tnum flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
      {badge === 0 && dot && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-caution" />
      )}
    </button>
  );
}
