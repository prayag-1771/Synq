import { eventBus } from '../eventBus';

export const initializeSubscribers = () => {
  // Chat & Message Event Logging
  eventBus.subscribe('chat.created', (data, event) => {
    console.log(`[EVENT BUS] 💬 Chat Created: [ChatID: ${data.chatId}] by [User: ${data.creatorId}] - Type: ${data.type}`);
  });

  eventBus.subscribe('message.created', (data, event) => {
    console.log(`[EVENT BUS] ✉️ Message Created: [MsgID: ${data.messageId}] in [Chat: ${data.chatId}] from [User: ${data.senderId}]`);
    // Future: Trigger Semantic Embeddings, AI Context Extraction, Webhooks, etc.
  });

  eventBus.subscribe('message.read', (data, event) => {
    console.log(`[EVENT BUS] 👀 Message Read: in [Chat: ${data.chatId}] by [User: ${data.readerId}]`);
  });

  eventBus.subscribe('message.delivered', (data, event) => {
    console.log(`[EVENT BUS] ✓ Message Delivered: in [Chat: ${data.chatId}] by [User: ${data.delivererId}]`);
  });

  // User Presence Event Logging
  eventBus.subscribe('user.online', (data, event) => {
    console.log(`[EVENT BUS] 🟢 User Online: [User: ${data.userId}]`);
  });

  eventBus.subscribe('user.offline', (data, event) => {
    console.log(`[EVENT BUS] 🔴 User Offline: [User: ${data.userId}]`);
  });

  console.log('Event Bus subscribers initialized successfully.');
};
