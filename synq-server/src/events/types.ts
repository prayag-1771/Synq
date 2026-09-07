// Event Types defining the structure of payloads moving through the Event Bus

export interface BaseEvent {
  eventId: string;
  timestamp: string;
}

export interface MessageCreatedEvent extends BaseEvent {
  type: 'message.created';
  data: {
    messageId: string;
    chatId: string;
    senderId: string;
    content: string;
  };
}

export interface MessageReadEvent extends BaseEvent {
  type: 'message.read';
  data: {
    chatId: string;
    readerId: string;
  };
}

export interface MessageDeliveredEvent extends BaseEvent {
  type: 'message.delivered';
  data: {
    chatId: string;
    delivererId: string;
  };
}

export interface UserOnlineEvent extends BaseEvent {
  type: 'user.online';
  data: {
    userId: string;
  };
}

export interface UserOfflineEvent extends BaseEvent {
  type: 'user.offline';
  data: {
    userId: string;
  };
}

export interface ChatCreatedEvent extends BaseEvent {
  type: 'chat.created';
  data: {
    chatId: string;
    creatorId: string;
    type: 'DIRECT' | 'GROUP';
  };
}

export interface GithubEventReceived extends BaseEvent {
  type: 'github.event';
  data: {
    repositoryId: string;
    repoFullName: string;
    chatIds: string[];
    eventType: string;
    action?: string;
    actorLogin?: string;
    actorAvatar?: string;
    title?: string;
    summary?: string;
    url?: string;
    tone: 'open' | 'merged' | 'closed' | 'draft' | 'success' | 'failure' | 'neutral';
  };
}

export interface GithubRepoLinkedEvent extends BaseEvent {
  type: 'github.repo.linked';
  data: {
    chatId: string;
    repoFullName: string;
    linkedById: string;
  };
}

export type AppEvent =
  | MessageCreatedEvent
  | MessageReadEvent
  | MessageDeliveredEvent
  | UserOnlineEvent
  | UserOfflineEvent
  | ChatCreatedEvent
  | GithubEventReceived
  | GithubRepoLinkedEvent;

export type EventPayloads = {
  [K in AppEvent['type']]: Extract<AppEvent, { type: K }>['data'];
};
