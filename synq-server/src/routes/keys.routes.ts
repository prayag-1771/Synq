import { Router } from 'express';
import { uploadKeys, getPublicKey, getMyKeys } from '../controllers/keys.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// Upload keys to the server (requires auth)
router.post('/upload', requireAuth, uploadKeys);

// Fetch my own encrypted private key and salt (requires auth)
router.get('/me', requireAuth, getMyKeys);

// Fetch a specific user's public key (requires auth)
router.get('/:userId', requireAuth, getPublicKey);

export default router;
