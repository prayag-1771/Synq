import { LocalMessage } from '../db/localDb';

export const AI_SENDER_ID = 'SYSTEM_AI';

/** Ciphertext looks like this before the keys are unlocked. */
export const isLockedCiphertext = (text: string) => text.length >= 80 && /^[0-9a-fA-F]+$/.test(text);

/**
 * One-line preview for the sidebar: markdown flattened, code fences collapsed,
 * and undecryptable content labelled rather than shown as hex noise.
 */
export const formatPreview = (message: LocalMessage | null, currentUserId?: string): string => {
  if (!message) return 'No messages yet';
  if (isLockedCiphertext(message.content)) return 'Encrypted message';

  const flattened = message.content
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^[#>\s-]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!flattened) return 'No messages yet';
  if (message.senderId === AI_SENDER_ID) return `Synq AI: ${flattened}`;
  if (currentUserId && message.senderId === currentUserId) return `You: ${flattened}`;
  return flattened;
};

const startOfDay = (iso: string) => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const isSameDay = (a: string, b: string) => startOfDay(a) === startOfDay(b);

/** "Today" / "Yesterday" / weekday within the last week / full date beyond that. */
export const formatDayLabel = (iso: string): string => {
  const today = startOfDay(new Date().toISOString());
  const day = startOfDay(iso);
  const dayMs = 86_400_000;
  const diffDays = Math.round((today - day) / dayMs);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return new Date(iso).toLocaleDateString([], { weekday: 'long' });
  return new Date(iso).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
};

/** Compact timestamp for chat list rows: time today, weekday this week, else a date. */
export const formatListTimestamp = (iso?: string): string => {
  if (!iso) return '';
  const today = startOfDay(new Date().toISOString());
  const day = startOfDay(iso);
  const diffDays = Math.round((today - day) / 86_400_000);

  if (diffDays === 0) return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return new Date(iso).toLocaleDateString([], { weekday: 'short' });
  return new Date(iso).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Whether a message continues the previous one — same author, same day, and
 * close enough in time that repeating the avatar would just be noise.
 */
export const continuesGroup = (previous: LocalMessage | undefined, current: LocalMessage): boolean => {
  if (!previous) return false;
  if (previous.senderId !== current.senderId) return false;
  if (!isSameDay(previous.createdAt, current.createdAt)) return false;
  return new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS;
};
