import { Router } from 'express';
import { 
  generateSummary, 
  generateSmartReplies, 
  semanticSearch, 
  translateText, 
  explainContext, 
  extractTodos,
  runAgent,
  resumeAgent
} from '../controllers/ai.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Endpoint for summarizing chat history
router.post('/summarize', authenticateJWT, generateSummary);

// Endpoint for generating smart replies
router.post('/replies', authenticateJWT, generateSmartReplies);

// Endpoint for vector-based semantic search
router.get('/search', authenticateJWT, semanticSearch);

// Endpoint for translation
router.post('/translate', authenticateJWT, translateText);

// Endpoint for explanation
router.post('/explain', authenticateJWT, explainContext);

// Endpoint for extracting tasks
router.get('/todo', authenticateJWT, extractTodos);

// Endpoint for executing the autonomous agent
router.post('/agent', authenticateJWT, runAgent);

// Endpoint for resuming the autonomous agent after client tool execution
router.post('/agent/resume', authenticateJWT, resumeAgent);

export default router;
