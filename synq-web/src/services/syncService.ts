import { localDb } from '../db/localDb';
import { socketService } from './socketService';
import { apiService } from './apiService';

export const syncService = {
  async flushOutbox() {
    try {
      const outboxItems = await localDb.outbox.toArray();
      if (outboxItems.length === 0) return;

      console.log(`Flushing outbox: resending ${outboxItems.length} messages`);

      for (const item of outboxItems) {
        // Resend message over sockets
        socketService.sendMessage(item.chatId, item.content);
        // Delete from outbox queue
        await localDb.outbox.delete(item.id!);
      }
    } catch (err) {
      console.error('Failed to flush outbox:', err);
    }
  },

  async syncMissingMessages() {
    try {
      // Find the latest message timestamp stored locally
      const latestMessage = await localDb.messages
        .orderBy('createdAt')
        .last();

      const lastSync = latestMessage ? latestMessage.createdAt : new Date(0).toISOString();

      console.log(`Requesting sync since: ${lastSync}`);

      const response = await apiService.get(`/chats/sync?lastSync=${encodeURIComponent(lastSync)}`);
      if (response.ok) {
        const data = await response.json();
        const messages = data.messages || [];
        console.log(`Sync complete. Fetched ${messages.length} missing messages`);

        if (messages.length > 0) {
          const localMessages = messages.map((m: any) => ({
            id: m.id,
            chatId: m.chatId,
            senderId: m.senderId,
            content: m.content,
            createdAt: m.createdAt,
            status: 'SENT' as const,
            senderName: m.sender.username,
            senderAvatar: m.sender.avatar || undefined,
          }));

          // Bulk write to IndexedDB
          await localDb.messages.bulkPut(localMessages);

          // Update corresponding chat threads timestamps
          for (const msg of messages) {
            const chat = await localDb.chats.get(msg.chatId);
            if (chat) {
              await localDb.chats.update(msg.chatId, {
                updatedAt: msg.createdAt,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to sync missing messages:', err);
    }
  }
};

export default syncService;
