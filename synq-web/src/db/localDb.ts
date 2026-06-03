import Dexie, { Table } from 'dexie';

export interface LocalChat {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string;
  avatar?: string | null;
  otherUser?: {
    id: string;
    username: string;
    email: string;
    avatar?: string;
  } | null;
  updatedAt: string;
}

export interface LocalMessage {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  createdAt: string;
  status: 'SENDING' | 'SENT' | 'FAILED' | 'READ';
  senderName: string;
  senderAvatar?: string;
}

export interface LocalOutbox {
  id?: number;
  tempMessageId: string;
  chatId: string;
  content: string;
  createdAt: string;
}

export class SynqLocalDb extends Dexie {
  chats!: Table<LocalChat>;
  messages!: Table<LocalMessage>;
  outbox!: Table<LocalOutbox>;

  constructor() {
    super('SynqLocalDb');
    this.version(1).stores({
      chats: 'id, updatedAt',
      messages: 'id, chatId, createdAt',
      outbox: '++id, tempMessageId, chatId',
    });
  }
}

export const localDb = new SynqLocalDb();
export default localDb;
