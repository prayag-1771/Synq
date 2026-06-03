import { Request, Response } from 'express';
import { prisma } from '../db/db';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

// Upload keys (Public Key, Encrypted Private Key, Salt)
export const uploadKeys = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { publicKey, encryptedPrivateKey, keySalt } = req.body;
    const userId = req.user?.userId; // from Auth Middleware

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!publicKey || !encryptedPrivateKey || !keySalt) {
      res.status(400).json({ error: 'Missing key materials' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        publicKey,
        encryptedPrivateKey,
        keySalt,
      },
      select: {
        id: true,
        username: true,
        publicKey: true,
      }
    });

    res.status(200).json({ message: 'Keys uploaded successfully', user: updatedUser });
  } catch (error) {
    console.error('Error in uploadKeys:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Fetch public key for a specific user
export const getPublicKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        publicKey: true,
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.publicKey) {
      res.status(404).json({ error: 'User has not uploaded a public key' });
      return;
    }

    res.status(200).json({ publicKey: user.publicKey });
  } catch (error) {
    console.error('Error in getPublicKey:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Fetch my own encrypted private key (for recovery on a new device)
export const getMyKeys = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        publicKey: true,
        encryptedPrivateKey: true,
        keySalt: true,
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Error in getMyKeys:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
