import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { localDb } from '../db/localDb';

class SocketService {
  private socket: Socket | null = null;

  connect() {
    const { token } = useAuthStore.getState();
    if (!token) return;

    if (this.socket?.connected) return;

    const serverUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

    this.socket = io(serverUrl, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      console.log('Socket connected to server');
      // Import syncService dynamically to prevent circular dependencies
      import('./syncService').then(({ syncService }) => {
        syncService.flushOutbox();
        syncService.syncMissingMessages();
      });
    });

    this.socket.on('message:new', async (message) => {
      const { tempId } = message;

      // 1. Remove optimistic message if matches
      if (tempId) {
        await localDb.messages.delete(tempId);
      }

      // 2. Put real message into local DB
      await localDb.messages.put({
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        createdAt: message.createdAt,
        status: 'SENT',
        senderName: message.sender.username,
        senderAvatar: message.sender.avatar || undefined,
      });

      // 3. Update chat thread time
      await localDb.chats.update(message.chatId, {
        updatedAt: message.createdAt,
      });
    });

    this.socket.on('typing:start', ({ chatId, userId, username }) => {
      const { addTypingUser } = useChatStore.getState();
      addTypingUser(chatId, { userId, username });
    });

    this.socket.on('typing:stop', ({ chatId, userId }) => {
      const { removeTypingUser } = useChatStore.getState();
      removeTypingUser(chatId, userId);
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  joinChat(chatId: string) {
    if (this.socket) {
      this.socket.emit('chat:join', chatId);
    }
  }

  sendMessage(chatId: string, content: string, tempId?: string) {
    if (this.socket) {
      this.socket.emit('message:send', { chatId, content, tempId });
    }
  }

  async sendMessageOptimistic(
    chatId: string,
    content: string,
    senderId: string,
    senderName: string,
    senderAvatar?: string
  ) {
    const tempId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const localMsg = {
      id: tempId,
      chatId,
      senderId,
      content,
      createdAt,
      status: 'SENDING' as const,
      senderName,
      senderAvatar,
    };

    // Save optimistic state to local DB
    await localDb.messages.put(localMsg);

    // Update chat thread updatedAt
    await localDb.chats.update(chatId, {
      updatedAt: createdAt,
    });

    if (this.socket?.connected) {
      this.sendMessage(chatId, content, tempId);
    } else {
      // Offline: mark local message as FAILED and queue in outbox
      await localDb.messages.update(tempId, { status: 'FAILED' });
      await localDb.outbox.put({
        tempMessageId: tempId,
        chatId,
        content,
        createdAt,
      });
    }
  }

  sendTypingStatus(chatId: string, isTyping: boolean) {
    if (this.socket) {
      this.socket.emit('message:typing', { chatId, isTyping });
    }
  }

  markAsRead(chatId: string) {
    if (this.socket) {
      this.socket.emit('message:read', { chatId });
    }
  }
}

export const socketService = new SocketService();
export default socketService;
