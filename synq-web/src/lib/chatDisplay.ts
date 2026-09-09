import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb, LocalMessage } from '../db/localDb';
import { AI_SENDER_ID } from './chatFormat';

export interface ChatSummary {
  lastMessage: LocalMessage | null;
  unreadCount: number;
}

/** Bounds that select every message in one chat via the [chatId+createdAt] index. */
const chatRange = (chatId: string) =>
  localDb.messages.where('[chatId+createdAt]').between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]);

/**
 * Newest message and unread count for each chat, kept live by Dexie.
 *
 * Backed by the compound index, so this reads one record per chat for the
 * preview instead of pulling whole conversations into memory.
 */
export const useChatSummaries = (chatIds: string[], currentUserId?: string): Record<string, ChatSummary> => {
  const key = chatIds.join(',');

  return (
    useLiveQuery(
      async () => {
        const summaries: Record<string, ChatSummary> = {};

        await Promise.all(
          chatIds.map(async (chatId) => {
            const lastMessage = (await chatRange(chatId).last()) || null;

            const unreadCount = currentUserId
              ? await chatRange(chatId)
                  .filter(
                    (m) => m.senderId !== currentUserId && m.senderId !== AI_SENDER_ID && m.status !== 'READ'
                  )
                  .count()
              : 0;

            summaries[chatId] = { lastMessage, unreadCount };
          })
        );

        return summaries;
      },
      [key, currentUserId]
    ) || {}
  );
};

// Pure formatting helpers live in ./chatFormat so they can be tested without
// an IndexedDB environment. Re-exported here so callers have one import.
export * from './chatFormat';
