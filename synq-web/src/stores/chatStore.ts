import { create } from 'zustand';

interface TypingState {
  chatId: string;
  userId: string;
  username: string;
}

export type ConnectionState = 'connecting' | 'online' | 'offline';

interface ChatState {
  selectedChatId: string | null;
  typingUsers: Record<string, TypingState[]>;

  /** User ids the server has told us are currently connected. */
  onlineUserIds: string[];
  /** Whether presence has been seeded yet — before that we show nothing rather than guessing. */
  presenceReady: boolean;
  /** This client's own socket state, used for the self status badge. */
  connectionState: ConnectionState;

  setSelectedChatId: (chatId: string | null) => void;
  addTypingUser: (chatId: string, user: { userId: string; username: string }) => void;
  removeTypingUser: (chatId: string, userId: string) => void;

  setOnlineUsers: (userIds: string[]) => void;
  setUserOnline: (userId: string) => void;
  setUserOffline: (userId: string) => void;
  setConnectionState: (state: ConnectionState) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedChatId: null,
  typingUsers: {},
  onlineUserIds: [],
  presenceReady: false,
  connectionState: 'connecting',

  setSelectedChatId: (selectedChatId) => set({ selectedChatId }),

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

  setOnlineUsers: (userIds) => set({ onlineUserIds: Array.from(new Set(userIds)), presenceReady: true }),

  setUserOnline: (userId) =>
    set((state) =>
      state.onlineUserIds.includes(userId) ? {} : { onlineUserIds: [...state.onlineUserIds, userId] }
    ),

  setUserOffline: (userId) =>
    set((state) => ({ onlineUserIds: state.onlineUserIds.filter((id) => id !== userId) })),

  setConnectionState: (connectionState) =>
    set(connectionState === 'offline' ? { connectionState, onlineUserIds: [], presenceReady: false } : { connectionState }),
}));

export default useChatStore;
