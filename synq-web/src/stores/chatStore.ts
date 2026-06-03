import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  createdAt: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  sender: {
    id: string;
    username: string;
    avatar?: string;
  };
}

export interface Chat {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string;
  avatar?: string;
  otherUser?: {
    id: string;
    username: string;
    email: string;
    avatar?: string;
  } | null;
  latestMessage?: ChatMessage | null;
  updatedAt: string;
}

interface TypingState {
  chatId: string;
  userId: string;
  username: string;
}

interface ChatState {
  chats: Chat[];
  selectedChatId: string | null;
  messages: ChatMessage[];
  typingUsers: Record<string, TypingState[]>;
  setChats: (chats: Chat[]) => void;
  updateChatLatestMessage: (chatId: string, message: ChatMessage) => void;
  setSelectedChatId: (chatId: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  addTypingUser: (chatId: string, user: { userId: string; username: string }) => void;
  removeTypingUser: (chatId: string, userId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  chats: [],
  selectedChatId: null,
  messages: [],
  typingUsers: {},
  setChats: (chats) => set({ chats }),
  updateChatLatestMessage: (chatId, message) =>
    set((state) => {
      const chatIndex = state.chats.findIndex((c) => c.id === chatId);
      if (chatIndex === -1) return {};
      const updatedChats = [...state.chats];
      updatedChats[chatIndex] = {
        ...updatedChats[chatIndex],
        latestMessage: message,
        updatedAt: message.createdAt,
      };
      updatedChats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return { chats: updatedChats };
    }),
  setSelectedChatId: (selectedChatId) => set({ selectedChatId, messages: [] }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => {
      const isDuplicate = state.messages.some((m) => m.id === message.id);
      if (isDuplicate) return {};
      const messages = state.selectedChatId === message.chatId
        ? [...state.messages, message]
        : state.messages;
      return { messages };
    }),
  addTypingUser: (chatId, user) =>
    set((state) => {
      const currentList = state.typingUsers[chatId] || [];
      if (currentList.some((u) => u.userId === user.userId)) return {};
      return {
        typingUsers: {
          ...state.typingUsers,
          [chatId]: [...currentList, { chatId, userId: user.userId, username: user.username }],
        },
      };
    }),
  removeTypingUser: (chatId, userId) =>
    set((state) => {
      const currentList = state.typingUsers[chatId] || [];
      return {
        typingUsers: {
          ...state.typingUsers,
          [chatId]: currentList.filter((u) => u.userId !== userId),
        },
      };
    }),
}));
