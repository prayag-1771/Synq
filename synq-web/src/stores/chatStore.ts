import { create } from 'zustand';

interface TypingState {
  chatId: string;
  userId: string;
  username: string;
}

interface ChatState {
  selectedChatId: string | null;
  typingUsers: Record<string, TypingState[]>;
  setSelectedChatId: (chatId: string | null) => void;
  addTypingUser: (chatId: string, user: { userId: string; username: string }) => void;
  removeTypingUser: (chatId: string, userId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedChatId: null,
  typingUsers: {},
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
}));
export default useChatStore;
