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
  status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
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

/** A GitHub reference resolved by the server, cached so re-renders are instant. */
export interface CachedGitRef {
  key: string;
  card: any;
  fetchedAt: number;
}

/** A repository bound to a conversation — what makes bare `#123` resolvable. */
export interface LocalRepoLink {
  id: string;
  chatId: string;
  repositoryId: string;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  description?: string | null;
  language?: string | null;
  htmlUrl: string;
  isPrimary: boolean;
  webhookActive: boolean;
}

/** A GitHub webhook event delivered to this chat, kept for the activity feed. */
export interface LocalGitActivity {
  id: string;
  chatId: string;
  repoFullName: string;
  eventType: string;
  action?: string;
  actorLogin?: string;
  actorAvatar?: string;
  title?: string;
  summary?: string;
  url?: string;
  tone: string;
  createdAt: string;
}

export class SynqLocalDb extends Dexie {
  chats!: Table<LocalChat>;
  messages!: Table<LocalMessage>;
  outbox!: Table<LocalOutbox>;
  gitRefs!: Table<CachedGitRef>;
  repoLinks!: Table<LocalRepoLink>;
  gitActivity!: Table<LocalGitActivity>;

  constructor() {
    super('SynqLocalDb');
    this.version(1).stores({
      chats: 'id, updatedAt',
      messages: 'id, chatId, createdAt',
      outbox: '++id, tempMessageId, chatId',
    });

    // v2 — GitHub integration caches
    this.version(2).stores({
      chats: 'id, updatedAt',
      messages: 'id, chatId, createdAt',
      outbox: '++id, tempMessageId, chatId',
      gitRefs: 'key, fetchedAt',
      repoLinks: 'id, chatId, repositoryId',
      gitActivity: 'id, chatId, createdAt',
    });
  }
}

export const localDb = new SynqLocalDb();
export default localDb;
