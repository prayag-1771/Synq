'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/authStore';
import { useChatStore, Chat, ChatMessage } from '../stores/chatStore';
import { apiService } from '../services/apiService';
import { socketService } from '../services/socketService';
import {
  MessageSquare,
  Search,
  Send,
  LogOut,
  User as UserIcon,
  Loader2,
  Users,
  Smile,
  AlertCircle
} from 'lucide-react';

export default function ChatPage() {
  const router = useRouter();
  const { user, token, isAuthenticated, clearAuth } = useAuthStore();
  const {
    chats,
    selectedChatId,
    messages,
    typingUsers,
    setChats,
    setSelectedChatId,
    setMessages,
    addMessage,
  } = useChatStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [usersList, setUsersList] = useState<any[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Auth Guard
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  // 2. Socket Connection
  useEffect(() => {
    if (isAuthenticated && token) {
      socketService.connect();
      fetchChats();
      fetchUsers();
    }
    return () => {
      socketService.disconnect();
    };
  }, [isAuthenticated, token]);

  // 3. Auto Scroll Messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  // 4. Socket Chat Join Room
  useEffect(() => {
    if (selectedChatId) {
      socketService.joinChat(selectedChatId);
      fetchMessages(selectedChatId);
      socketService.markAsRead(selectedChatId);
    }
  }, [selectedChatId]);

  const fetchChats = async () => {
    try {
      setLoadingChats(true);
      const res = await apiService.get('/chats');
      if (res.ok) {
        const data = await res.json();
        setChats(data);
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
        setUsersList(data);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  const fetchMessages = async (chatId: string) => {
    try {
      setLoadingMessages(true);
      const res = await apiService.get(`/chats/${chatId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleStartChat = async (targetUserId: string) => {
    try {
      const res = await apiService.post('/chats/direct', { targetUserId });
      if (res.ok) {
        const newChat = await res.json();
        
        // Add to chat list if not already there
        if (!chats.some((c) => c.id === newChat.id)) {
          setChats([newChat, ...chats]);
        }
        
        setSelectedChatId(newChat.id);
        setSearchQuery('');
        setShowSearchResults(false);
      }
    } catch (err) {
      console.error('Error starting chat:', err);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedChatId) return;

    // Send via socket
    socketService.sendMessage(selectedChatId, messageInput.trim());
    setMessageInput('');
    
    // Stop typing immediately
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socketService.sendTypingStatus(selectedChatId, false);
    setIsTyping(false);
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);
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

  const handleLogout = () => {
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
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg bg-slate-800/40 hover:bg-red-500/10 hover:text-red-400 border border-slate-800 hover:border-red-500/20 transition-all duration-200"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
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
                        {chat.latestMessage
                          ? new Date(chat.latestMessage.createdAt).toLocaleTimeString([], {
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
                        chat.latestMessage?.content || 'No messages yet'
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
            </div>

            {/* Chat Pane Message History */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 custom-scrollbar">
              {loadingMessages ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : messages.length > 0 ? (
                messages.map((message) => {
                  const isMe = message.senderId === user.id;

                  return (
                    <div
                      key={message.id}
                      className={`flex gap-3 max-w-[70%] ${isMe ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                    >
                      {!isMe && (
                        <img
                          src={message.sender.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${message.sender.username}`}
                          alt={message.sender.username}
                          className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/50 self-end mb-1"
                        />
                      )}
                      <div className="flex flex-col">
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-sm shadow-md transition-all ${
                            isMe
                              ? 'bg-indigo-600 text-white rounded-br-none'
                              : 'bg-slate-900 border border-slate-800/60 text-slate-100 rounded-bl-none'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        </div>
                        <span
                          className={`text-[10px] text-slate-500 mt-1 ${
                            isMe ? 'text-right' : 'text-left'
                          }`}
                        >
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-4">
                  <MessageSquare className="w-12 h-12 text-slate-700 mb-3" />
                  <p className="font-semibold text-slate-400">Say hello!</p>
                  <p className="text-xs text-slate-655 mt-1">
                    Start the conversation. Your messages are sent in real-time.
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

            {/* Chat Pane Message Input */}
            <div className="p-4 bg-slate-900/10 backdrop-blur-md border-t border-slate-800/60">
              <form onSubmit={handleSendMessage} className="flex gap-3 items-center">
                <div className="flex-1 relative flex items-center">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={handleTyping}
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
