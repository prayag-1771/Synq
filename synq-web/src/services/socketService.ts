import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useCryptoStore } from '../stores/cryptoStore';
import { useGitHubStore } from '../stores/githubStore';
import { localDb } from '../db/localDb';
import { encryptMessage, decryptMessage } from './cryptoService';
import { apiService } from './apiService';

// Simple in-memory cache for public keys
const publicKeyCache: Record<string, string> = {};
// Cache the promise to prevent simultaneous duplicate requests for the same user
const pendingKeyRequests: Record<string, Promise<string | null>> = {};

export const invalidatePublicKeyCache = (userId: string) => {
  delete publicKeyCache[userId];
};

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

export const tryDecryptMessage = async (content: string, senderId: string, chatId?: string): Promise<string> => {
  const { privateKeyHex } = useCryptoStore.getState();
  const { user } = useAuthStore.getState();
  
  if (!privateKeyHex || content.length < 50) return content;

  try {
    let targetUserId = senderId;
    
    if (user && senderId === user.id) {
      if (!chatId) return content;
      const chat = await localDb.chats.get(chatId);
      if (!chat || chat.type !== 'DIRECT' || !chat.otherUser) return content;
      targetUserId = chat.otherUser.id;
    }
    
    let targetPublicKey = await getPublicKeyForUser(targetUserId);

    if (!targetPublicKey) {
      console.warn(`[tryDecryptMessage] No target public key found for message decryption`);
      return content;
    }
    
    try {
      return await decryptMessage(content, targetPublicKey, privateKeyHex);
    } catch (decryptErr) {
      // If decryption fails, the sender might have rotated their keys.
      // Invalidate the cache and try one more time.
      console.warn(`[tryDecryptMessage] Decryption failed with cached key. Invalidating cache and retrying for ${targetUserId}...`);
      invalidatePublicKeyCache(targetUserId);
      
      const freshPublicKey = await getPublicKeyForUser(targetUserId);
      if (freshPublicKey && freshPublicKey !== targetPublicKey) {
        return await decryptMessage(content, freshPublicKey, privateKeyHex);
      }
      throw decryptErr; // Throw if the fresh key still fails or is the same
    }
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

    useChatStore.getState().setConnectionState('connecting');

    this.socket.on('connect', () => {
      console.log('Socket connected to server');
      useChatStore.getState().setConnectionState('online');

      // Seed presence. Until this returns we report nobody as online rather
      // than guessing — a wrong green dot is worse than no dot.
      this.socket?.emit('presence:get_active', (userIds: string[]) => {
        useChatStore.getState().setOnlineUsers(userIds || []);
      });

      // Import syncService dynamically to prevent circular dependencies
      import('./syncService').then(({ syncService }) => {
        syncService.flushOutbox();
        syncService.syncMissingMessages();
      });
    });

    this.socket.on('user:online', ({ userId }: { userId: string }) => {
      useChatStore.getState().setUserOnline(userId);
    });

    this.socket.on('user:offline', ({ userId }: { userId: string }) => {
      useChatStore.getState().setUserOffline(userId);
    });

    this.socket.on('message:new', async (message) => {
      const { tempId } = message;
      let finalContent = message.content;

      // 1. Remove optimistic message if matches and preserve its plaintext content
      if (tempId) {
        const optimisticMsg = await localDb.messages.get(tempId);
        if (optimisticMsg) {
          finalContent = optimisticMsg.content; // Preserve plaintext!
        } else {
          // The tempId doesn't belong to us (it's the sender's), so we need to decrypt it!
          try {
            finalContent = await tryDecryptMessage(message.content, message.senderId, message.chatId);
          } catch (err) {
            console.error('Decryption error or unencrypted message');
          }
        }
        await localDb.messages.delete(tempId);
      } else {
        try {
          finalContent = await tryDecryptMessage(message.content, message.senderId, message.chatId);
        } catch (err) {
          console.error('Decryption error or unencrypted message');
        }
      }

      // 2. Put real message into local DB. A message that lands in the chat the
      // user is already looking at is read on arrival — otherwise it would sit
      // in the unread count while being stared at.
      const { user: currentUser } = useAuthStore.getState();
      const isIncoming = Boolean(currentUser && message.senderId !== currentUser.id);
      const isChatOpen = useChatStore.getState().selectedChatId === message.chatId;
      const isWindowFocused = typeof document === 'undefined' || document.visibilityState === 'visible';
      const readOnArrival = isIncoming && isChatOpen && isWindowFocused;

      await localDb.messages.put({
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: finalContent,
        createdAt: message.createdAt,
        status: readOnArrival ? 'READ' : 'SENT',
        senderName: message.sender.username,
        senderAvatar: message.sender.avatar || undefined,
      });

      // 3. Update chat thread time
      await localDb.chats.update(message.chatId, {
        updatedAt: message.createdAt,
      });

      // 4. Receipts back to the sender
      if (isIncoming) {
        this.socket?.emit('message:delivered', { chatId: message.chatId });
        if (readOnArrival) {
          this.socket?.emit('message:read', { chatId: message.chatId });
        }
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

    // Repository activity pushed from a GitHub webhook, fanned out server-side
    // to every chat the repository is linked to.
    this.socket.on('github:activity', (event) => {
      useGitHubStore.getState().addActivity({
        chatId: event.chatId,
        repoFullName: event.repoFullName,
        eventType: event.eventType,
        action: event.action,
        actorLogin: event.actorLogin,
        actorAvatar: event.actorAvatar,
        title: event.title,
        summary: event.summary,
        url: event.url,
        tone: event.tone,
        createdAt: event.createdAt || new Date().toISOString(),
      });

      // A push or merge invalidates any reference card we have cached.
      import('./githubService').then(({ githubService }) => githubService.invalidateRefs());
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
      useChatStore.getState().setConnectionState('offline');
    });

    this.socket.on('connect_error', () => {
      useChatStore.getState().setConnectionState('offline');
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

  async markAsRead(chatId: string) {
    this.socket?.emit('message:read', { chatId });

    // The server only tracks read state for the *sender's* view. Clearing it
    // locally is what makes this chat's unread badge go away.
    const { user } = useAuthStore.getState();
    if (!user) return;

    await localDb.messages
      .where('chatId')
      .equals(chatId)
      .filter((m) => m.senderId !== user.id && m.senderId !== 'SYSTEM_AI' && m.status !== 'READ')
      .modify({ status: 'READ' });
  }
}

export const socketService = new SocketService();
export default socketService;
