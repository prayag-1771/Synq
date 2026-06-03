import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useCryptoStore } from '../stores/cryptoStore';
import { localDb } from '../db/localDb';
import { encryptMessage, decryptMessage } from './cryptoService';
import { apiService } from './apiService';

// Simple in-memory cache for public keys
const publicKeyCache: Record<string, string> = {};

export const getPublicKeyForUser = async (userId: string): Promise<string | null> => {
  if (publicKeyCache[userId]) return publicKeyCache[userId];
  try {
    const res = await apiService.get(`/keys/${userId}`);
    if (res.ok) {
      const { publicKey } = await res.json();
      if (publicKey) {
        publicKeyCache[userId] = publicKey;
        return publicKey;
      }
    }
  } catch (err) {
    console.error('Failed to fetch public key for', userId);
  }
  return null;
};

export const tryDecryptMessage = async (content: string, senderId: string): Promise<string> => {
  const { privateKeyHex } = useCryptoStore.getState();
  const { user } = useAuthStore.getState();
  
  // If it's our own message, we shouldn't decrypt it with our private key as recipient, 
  // wait, if we sent it, we encrypted it for the *other* person! We can't decrypt it ourselves!
  // BUT we store our own messages in plaintext locally in localDb before sending!
  // So if we fetch historic messages we sent from the server, we actually can't decrypt them because they were encrypted with the *other* person's public key.
  // Wait! In Signal/WhatsApp, you encrypt the message TWICE: once for the recipient, once for yourself. Or you just rely on the localDb to have the plaintext.
  // If localDb is cleared, the historic sent messages from the server are unreadable to us!
  // Let's at least decrypt messages from OTHERS.
  
  if (!privateKeyHex || content.length < 50) return content;
  if (user && senderId === user.id) return content; // Can't decrypt our own outbox payload

  try {
    const senderPk = await getPublicKeyForUser(senderId);
    if (!senderPk) return content;
    return await decryptMessage(content, senderPk, privateKeyHex);
  } catch (err) {
    return content;
  }
};

class SocketService {
  private socket: Socket | null = null;

  getSocket(): Socket | null {
    return this.socket;
  }

  connect() {
    const { token } = useAuthStore.getState();
    if (!token) return;

    if (this.socket?.connected) return;

    const envUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const serverUrl = envUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');

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
      let finalContent = message.content;

      // 1. Remove optimistic message if matches and preserve its plaintext content
      if (tempId) {
        const optimisticMsg = await localDb.messages.get(tempId);
        if (optimisticMsg) {
          finalContent = optimisticMsg.content; // Preserve plaintext!
        }
        await localDb.messages.delete(tempId);
      } else {
        try {
          finalContent = await tryDecryptMessage(message.content, message.senderId);
        } catch (err) {
          console.error('Decryption error or unencrypted message');
        }
      }

      // 2. Put real message into local DB
      await localDb.messages.put({
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: finalContent,
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

    // Save optimistic state to local DB (store plaintext locally for instant UI rendering)
    await localDb.messages.put(localMsg);

    // Update chat thread updatedAt
    await localDb.chats.update(chatId, {
      updatedAt: createdAt,
    });

    // Handle E2EE Encryption before sending over network
    let payloadToSend = content;
    const { privateKeyHex } = useCryptoStore.getState();
    const chat = await localDb.chats.get(chatId);

    if (privateKeyHex && chat && chat.type === 'DIRECT' && chat.otherUser) {
      try {
        // Fetch recipient's public key (in a real app, this should be heavily cached)
        const publicKey = await getPublicKeyForUser(chat.otherUser.id);
        if (publicKey) {
           // Encrypt the message payload!
           payloadToSend = await encryptMessage(content, publicKey, privateKeyHex);
        }
      } catch (err) {
        console.error('Failed to encrypt message, falling back or failing:', err);
      }
    }

    if (this.socket?.connected) {
      this.sendMessage(chatId, payloadToSend, tempId);
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
