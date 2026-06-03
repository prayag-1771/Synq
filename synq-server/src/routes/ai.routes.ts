import { Router } from 'express';
import { generateSummary, generateSmartReplies } from '../controllers/ai.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Endpoint for summarizing chat history
router.post('/summarize', authenticateJWT, generateSummary);

// Endpoint for generating smart replies
router.post('/replies', authenticateJWT, generateSmartReplies);

export default router;
