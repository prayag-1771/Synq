import { Response } from 'express';
import { prisma } from '../db/db';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { eventBus } from '../events/eventBus';

export const getChats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userId = req.user.userId;

    // Get chats where the user is a participant
    const chats = await prisma.chat.findMany({
      where: {
        participants: {
          some: {
            userId,
          },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                email: true,
                publicKey: true,
              },
            },
          },
        },
        messages: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Format chats for frontend
    const formattedChats = chats.map((chat) => {
      // Find the recipient (the other participant) for direct chats
      const otherParticipant = chat.participants.find(
        (p) => p.userId !== userId
      )?.user || null;

      return {
        id: chat.id,
        type: chat.type,
        name: chat.name || (otherParticipant ? otherParticipant.username : 'Unknown User'),
        avatar: otherParticipant?.avatar || null,
        otherUser: otherParticipant,
        latestMessage: chat.messages[0] || null,
        updatedAt: chat.updatedAt,
      };
    });

    return res.status(200).json(formattedChats);
  } catch (error) {
    console.error('Get chats error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getOrCreateDirectChat = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { targetUserId } = req.body;
    const userId = req.user.userId;

    if (!targetUserId) {
      return res.status(400).json({ message: 'targetUserId is required' });
    }

    if (userId === targetUserId) {
      return res.status(400).json({ message: 'Cannot chat with yourself' });
    }

    // Check if direct chat already exists
    const existingChat = await prisma.chat.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: targetUserId } } },
        ],
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                email: true,
                publicKey: true,
              },
            },
          },
        },
      },
    });

    if (existingChat) {
      const otherParticipant = existingChat.participants.find(
        (p) => p.userId !== userId
      )?.user || null;

      return res.status(200).json({
        id: existingChat.id,
        type: existingChat.type,
        name: otherParticipant ? otherParticipant.username : 'Unknown User',
        avatar: otherParticipant?.avatar || null,
        otherUser: otherParticipant,
        updatedAt: existingChat.updatedAt,
      });
    }

    // Create a new direct chat
    const newChat = await prisma.chat.create({
      data: {
        type: 'DIRECT',
        participants: {
          create: [{ userId }, { userId: targetUserId }],
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                email: true,
                publicKey: true,
              },
            },
          },
        },
      },
    });

    const otherParticipant = newChat.participants.find(
      (p) => p.userId !== userId
    )?.user || null;

    // Publish internal event
    eventBus.publish('chat.created', {
      chatId: newChat.id,
      creatorId: userId,
      type: newChat.type as 'DIRECT' | 'GROUP',
    }).catch(console.error);

    return res.status(201).json({
      id: newChat.id,
      type: newChat.type,
      name: otherParticipant ? otherParticipant.username : 'Unknown User',
      avatar: otherParticipant?.avatar || null,
      otherUser: otherParticipant,
      updatedAt: newChat.updatedAt,
    });
  } catch (error) {
    console.error('Get or create direct chat error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const getChatMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { chatId } = req.params;
    const { cursor, limit = '50' } = req.query;
    const userId = req.user.userId;
    const parsedLimit = parseInt(limit as string, 10);

    // Verify user is participant in this chat
    const participant = await prisma.chatParticipant.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId,
        },
      },
    });

    if (!participant) {
      return res.status(403).json({ message: 'Forbidden: You are not in this chat' });
    }

    const messages = await prisma.message.findMany({
      where: {
        chatId,
        ...(cursor ? { createdAt: { lt: new Date(cursor as string) } } : {}),
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
      orderBy: {
        createdAt: 'desc',
      },
      take: parsedLimit,
    });

    // Return chronological order
    return res.status(200).json(messages.reverse());
  } catch (error) {
    console.error('Get chat messages error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const syncMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { lastSync, limit = '500' } = req.query;
    const userId = req.user.userId;
    const parsedLimit = parseInt(limit as string, 10);

    if (!lastSync) {
      return res.status(400).json({ message: 'lastSync query parameter is required' });
    }

    // Get all chat IDs the user is in
    const participants = await prisma.chatParticipant.findMany({
      where: { userId },
      select: { chatId: true },
    });

    const chatIds = participants.map((p) => p.chatId);

    const newMessages = await prisma.message.findMany({
      where: {
        chatId: { in: chatIds },
        createdAt: { gt: new Date(lastSync as string) },
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
      orderBy: {
        createdAt: 'asc',
      },
      take: parsedLimit + 1, // Fetch one extra to check if there are more
    });

    let hasMore = false;
    let nextSync = null;

    if (newMessages.length > parsedLimit) {
      hasMore = true;
      const nextMessage = newMessages.pop(); // Remove the extra message
      nextSync = newMessages[newMessages.length - 1].createdAt.toISOString();
    }

    return res.status(200).json({
      messages: newMessages,
      hasMore,
      nextSync,
    });
  } catch (error) {
    console.error('Sync messages error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
