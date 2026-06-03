import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/db';

const JWT_SECRET = process.env.JWT_SECRET || 'synq_jwt_access_secret_token_2026_modern';

interface SocketUser {
  userId: string;
  username: string;
  email: string;
}

export interface CustomSocket extends Socket {
  user?: SocketUser;
}

// Active user tracking in memory (will migrate to Redis later)
const activeUsers = new Map<string, string>(); // userId -> socketId

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

    // Register active session
    activeUsers.set(userId, socket.id);

    // Broadcast user online status
    socket.broadcast.emit('user:online', { userId });

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

        // If other participants aren't active in the room but online, notify them
        const participants = await prisma.chatParticipant.findMany({
          where: { chatId, userId: { not: userId } },
        });

        participants.forEach((p) => {
          const recipientSocketId = activeUsers.get(p.userId);
          if (recipientSocketId) {
            // Send delivery receipt status updates if appropriate
            io.to(p.userId).emit('message:received_notify', { chatId, messageId: message.id });
          }
        });
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
      } catch (err) {
        console.error('Error updating read status:', err);
      }
    });

    // 5. Get initial presence query for all active users
    socket.on('presence:get_active', (callback: (userIds: string[]) => void) => {
      callback(Array.from(activeUsers.keys()));
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

    // Handle Disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${username} - Socket: ${socket.id}`);
      activeUsers.delete(userId);
      socket.broadcast.emit('user:offline', { userId });
    });
  });
};
