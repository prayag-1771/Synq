import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useCryptoStore } from '../stores/cryptoStore';
import { localDb } from '../db/localDb';
import { encryptMessage, decryptMessage } from './cryptoService';
import { apiService } from './apiService';

// Simple in-memory cache for public keys
const publicKeyCache: Record<string, string> = {};
// Cache the promise to prevent simultaneous duplicate requests for the same user
const pendingKeyRequests: Record<string, Promise<string | null>> = {};

export const getPublicKeyForUser = async (userId: string): Promise<string | null> => {
  if (publicKeyCache[userId]) return publicKeyCache[userId];
  if (pendingKeyRequests[userId] !== undefined) return pendingKeyRequests[userId];

  pendingKeyRequests[userId] = (async () => {
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
    } finally {
      delete pendingKeyRequests[userId];
    }
    return null;
  })();

  return pendingKeyRequests[userId];
};

export const tryDecryptMessage = async (content: string, senderId: string): Promise<string> => {
  const { privateKeyHex } = useCryptoStore.getState();
  const { user } = useAuthStore.getState();
  
  if (!privateKeyHex || content.length < 50) return content;

  try {
    let targetPublicKey: string | null = null;

    if (user && senderId === user.id) {
      // It's our own outbox message. Curve25519 allows symmetric decryption of outbox
      // if we calculate the shared secret using the RECIPIENT's public key and OUR private key.
      if (!chatId) return content;
      const chat = await localDb.chats.get(chatId);
      if (!chat || chat.type !== 'DIRECT' || !chat.otherUser) return content;
      
      targetPublicKey = await getPublicKeyForUser(chat.otherUser.id);
    } else {
      // It's an incoming message. Decrypt using SENDER's public key.
      targetPublicKey = await getPublicKeyForUser(senderId);
    }

    if (!targetPublicKey) {
      console.warn(`[tryDecryptMessage] No target public key found for message decryption`);
      return content;
    }
    
    return await decryptMessage(content, targetPublicKey, privateKeyHex);
  } catch (err) {
    console.error(`[tryDecryptMessage] Failed to decrypt message:`, err);
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

      // 4. Emit delivery receipt if it's from someone else
      const { user } = useAuthStore.getState();
      if (user && message.senderId !== user.id) {
        this.socket?.emit('message:delivered', { chatId: message.chatId });
      }
    });

    this.socket.on('message:delivered', async ({ chatId }) => {
      const { user } = useAuthStore.getState();
      if (!user) return;
      const sentMessages = await localDb.messages.where('chatId').equals(chatId).toArray();
      const toUpdate = sentMessages
        .filter(m => m.senderId === user.id && m.status === 'SENT')
        .map(m => m.id);
        
      if (toUpdate.length > 0) {
        await localDb.messages.where('id').anyOf(toUpdate).modify({ status: 'DELIVERED' });
      }
    });

    this.socket.on('message:read', async ({ chatId }) => {
      const { user } = useAuthStore.getState();
      if (!user) return;
      const sentMessages = await localDb.messages.where('chatId').equals(chatId).toArray();
      const toUpdate = sentMessages
        .filter(m => m.senderId === user.id && (m.status === 'SENT' || m.status === 'DELIVERED'))
        .map(m => m.id);
        
      if (toUpdate.length > 0) {
        await localDb.messages.where('id').anyOf(toUpdate).modify({ status: 'READ' });
      }
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

    this.socket.on('error', async (errorPayload: any) => {
      console.error('Socket error:', errorPayload);
      if (errorPayload && errorPayload.tempId) {
        await localDb.messages.update(errorPayload.tempId, { status: 'FAILED' });
      }
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

    // Option C: Hybrid E2EE - Bypass encryption for AI slash commands
    const isSlashCommand = content.startsWith('/');

    if (!isSlashCommand && privateKeyHex && chat && chat.type === 'DIRECT' && chat.otherUser) {
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
