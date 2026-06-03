import { Router } from 'express';
import { uploadKeys, getPublicKey, getMyKeys } from '../controllers/keys.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Upload keys to the server (requires auth)
router.post('/upload', authenticateJWT, uploadKeys);

// Fetch my own encrypted private key and salt (requires auth)
router.get('/me', authenticateJWT, getMyKeys);

// Fetch a specific user's public key (requires auth)
router.get('/:userId', authenticateJWT, getPublicKey);

export default router;
