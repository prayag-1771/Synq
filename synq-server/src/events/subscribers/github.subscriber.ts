import { eventBus } from '../eventBus';
import { emitToChat } from '../../sockets/registry';

/**
 * Fans GitHub activity out to the conversations that care about it.
 *
 * Webhook deliveries land on any one server instance, get published to the
 * event bus (Redis-backed when available), and every instance then pushes the
 * event to the chat rooms it holds sockets for.
 */
export const initGithubSubscriber = () => {
  eventBus.subscribe('github.event', (data) => {
    const payload = {
      repoFullName: data.repoFullName,
      eventType: data.eventType,
      action: data.action,
      actorLogin: data.actorLogin,
      actorAvatar: data.actorAvatar,
      title: data.title,
      summary: data.summary,
      url: data.url,
      tone: data.tone,
      createdAt: new Date().toISOString(),
    };

    for (const chatId of data.chatIds) {
      emitToChat(chatId, 'github:activity', { chatId, ...payload });
    }

    console.log(
      `[GitHub] ${data.repoFullName} — ${data.actorLogin || 'someone'} ${data.summary || data.eventType} ` +
        `→ ${data.chatIds.length} chat(s)`
    );
  });

  eventBus.subscribe('github.repo.linked', (data) => {
    emitToChat(data.chatId, 'github:repo-linked', {
      chatId: data.chatId,
      repoFullName: data.repoFullName,
      linkedById: data.linkedById,
    });
    console.log(`[GitHub] Repository ${data.repoFullName} linked to chat ${data.chatId}`);
  });
};
