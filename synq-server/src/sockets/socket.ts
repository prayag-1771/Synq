import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/db';
import { 
  registerUserPresence, 
  deregisterUserPresence, 
  isUserOnline, 
  getActiveUsers 
} from '../db/redis';
import { eventBus } from '../events/eventBus';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
}

interface SocketUser {
  userId: string;
  username: string;
  email: string;
}

export interface CustomSocket extends Socket {
  user?: SocketUser;
}


export const setupSocketHandlers = (io: Server) => {
  // Authentication Middleware for WebSockets
  io.use((socket: CustomSocket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;

    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as SocketUser;
      socket.user = decoded;
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket: CustomSocket) => {
    if (!socket.user) return;
    const userId = socket.user.userId;
    const username = socket.user.username;

    console.log(`User connected: ${username} (${userId}) - Socket: ${socket.id}`);

    // Register active session in Redis
    const isNewOnline = await registerUserPresence(userId);

    if (isNewOnline) {
      // Broadcast user online status
      socket.broadcast.emit('user:online', { userId });
      // Publish to internal event bus
      eventBus.publish('user.online', { userId }).catch(console.error);
    }

    // Join room for direct events specifically to this user
    socket.join(userId);

    // Join rooms for all chats the user is part of
    try {
      const userChats = await prisma.chatParticipant.findMany({
        where: { userId },
        select: { chatId: true },
      });
      userChats.forEach(({ chatId }) => {
        socket.join(chatId);
      });
    } catch (err) {
      console.error('Error joining user to rooms:', err);
    }

    // 1. Join Chat Room
    socket.on('chat:join', (chatId: string) => {
      socket.join(chatId);
      console.log(`Socket ${socket.id} joined chat: ${chatId}`);
    });

    // 2. Typing Indicator
    socket.on('message:typing', ({ chatId, isTyping }: { chatId: string; isTyping: boolean }) => {
      // Broadcast to everyone else in the chat room
      socket.to(chatId).emit(isTyping ? 'typing:start' : 'typing:stop', {
        chatId,
        userId,
        username,
      });
    });

    // 3. Send Message
    socket.on('message:send', async ({ chatId, content, tempId }: { chatId: string; content: string; tempId?: string }) => {
      try {
        // Verify user is a participant
        const participant = await prisma.chatParticipant.findUnique({
          where: {
            chatId_userId: { chatId, userId }
          }
        });

        if (!participant) {
          console.error(`User ${userId} attempted to send message to unauthorized chat ${chatId}`);
          return socket.emit('error', { message: 'Forbidden: You are not in this chat', tempId });
        }

        // Save to Database
        const message = await prisma.message.create({
          data: {
            chatId,
            senderId: userId,
            content,
            status: 'SENT',
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                avatar: true,
              },
            },
          },
        });

        // Broadcast to the room (including sender), appending the tempId
        io.to(chatId).emit('message:new', { ...message, tempId });

        // Publish to internal event bus
        eventBus.publish('message.created', {
          messageId: message.id,
          chatId,
          senderId: userId,
          content,
        }).catch(console.error);

        // If other participants aren't active in the room but online, notify them
        const participants = await prisma.chatParticipant.findMany({
          where: { chatId, userId: { not: userId } },
        });

        for (const p of participants) {
          const isOnline = await isUserOnline(p.userId);
          if (isOnline) {
            // Send delivery receipt status updates if appropriate
            io.to(p.userId).emit('message:received_notify', { chatId, messageId: message.id });
          }
        }
      } catch (err) {
        console.error('Failed to send message:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // 4. Mark messages as read
    socket.on('message:read', async ({ chatId }: { chatId: string }) => {
      try {
        // Update all unread messages in this chat from other senders
        await prisma.message.updateMany({
          where: {
            chatId,
            senderId: { not: userId },
            status: { not: 'READ' },
          },
          data: {
            status: 'READ',
          },
        });

        // Notify other participants in the chat
        socket.to(chatId).emit('message:read', { chatId, readerId: userId });

        // Publish to internal event bus
        eventBus.publish('message.read', { chatId, readerId: userId }).catch(console.error);
      } catch (err) {
        console.error('Error updating read status:', err);
      }
    });

    // 4b. Mark messages as delivered
    socket.on('message:delivered', async ({ chatId }: { chatId: string }) => {
      try {
        await prisma.message.updateMany({
          where: {
            chatId,
            senderId: { not: userId },
            status: 'SENT',
          },
          data: {
            status: 'DELIVERED',
          },
        });
        socket.to(chatId).emit('message:delivered', { chatId, delivererId: userId });
        
        // Publish to internal event bus
        eventBus.publish('message.delivered', { chatId, delivererId: userId }).catch(console.error);
      } catch (err) {
        console.error('Error updating delivered status:', err);
      }
    });

    // 5. Get initial presence query for all active users
    socket.on('presence:get_active', async (callback: (userIds: string[]) => void) => {
      const activeIds = await getActiveUsers();
      callback(activeIds);
    });

    // 6. WebRTC Signaling Events
    socket.on('webrtc:call-user', ({ targetUserId, offer }: { targetUserId: string, offer: any }) => {
      socket.to(targetUserId).emit('webrtc:incoming-call', { callerId: userId, callerName: username, offer });
    });

    socket.on('webrtc:make-answer', ({ targetUserId, answer }: { targetUserId: string, answer: any }) => {
      socket.to(targetUserId).emit('webrtc:answer-made', { answer, answererId: userId });
    });

    socket.on('webrtc:ice-candidate', ({ targetUserId, candidate }: { targetUserId: string, candidate: any }) => {
      socket.to(targetUserId).emit('webrtc:ice-candidate', { candidate, senderId: userId });
    });

    socket.on('webrtc:reject-call', ({ targetUserId }: { targetUserId: string }) => {
      socket.to(targetUserId).emit('webrtc:call-rejected', { rejecterId: userId });
    });

    socket.on('webrtc:end-call', ({ targetUserId }: { targetUserId: string }) => {
      socket.to(targetUserId).emit('webrtc:call-ended', { enderId: userId });
    });

    // 7. Collaborative Document Sync (Yjs CRDTs)
    socket.on('doc:update', ({ chatId, update }: { chatId: string, update: string }) => {
      // Broadcast the E2EE encrypted Yjs update to everyone else in the chat room
      socket.to(chatId).emit('doc:update', { chatId, update, senderId: userId });
    });

    socket.on('doc:cursor', ({ chatId, cursor }: { chatId: string, cursor: string }) => {
      // Broadcast the E2EE encrypted cursor location to everyone else in the chat room
      socket.to(chatId).emit('doc:cursor', { chatId, cursor, senderId: userId });
    });

    socket.on('doc:request-sync', ({ chatId }: { chatId: string }) => {
      // Ask other participants to broadcast their current document state
      socket.to(chatId).emit('doc:request-sync', { chatId, requesterId: userId });
    });

    // Handle Disconnect
    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${username} - Socket: ${socket.id}`);
      const isOfflineNow = await deregisterUserPresence(userId);
      if (isOfflineNow) {
        socket.broadcast.emit('user:offline', { userId });
        eventBus.publish('user.offline', { userId }).catch(console.error);
      }
    });
  });
};
