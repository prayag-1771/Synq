import { Server } from 'socket.io';

/**
 * Holds the live Socket.IO server so non-socket code paths (HTTP controllers,
 * webhook handlers, event subscribers) can push real-time updates into chats.
 */
let ioInstance: Server | null = null;

export const setIO = (io: Server) => {
  ioInstance = io;
};

export const getIO = (): Server | null => ioInstance;

/** Emits an event to every participant currently joined to a chat room. */
export const emitToChat = (chatId: string, event: string, payload: any) => {
  ioInstance?.to(chatId).emit(event, payload);
};

/** Emits an event to a specific user across all of their connected devices. */
export const emitToUser = (userId: string, event: string, payload: any) => {
  ioInstance?.to(userId).emit(event, payload);
};
