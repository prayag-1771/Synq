import { Router } from 'express';
import { generateSummary, generateSmartReplies } from '../controllers/ai.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// Endpoint for summarizing chat history
router.post('/summarize', requireAuth, generateSummary);

// Endpoint for generating smart replies
router.post('/replies', requireAuth, generateSmartReplies);

export default router;
