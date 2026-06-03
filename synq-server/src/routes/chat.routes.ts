import { Router } from 'express';
import { getChats, getOrCreateDirectChat, getChatMessages, syncMessages } from '../controllers/chat.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.get('/', getChats);
router.post('/direct', getOrCreateDirectChat);
router.get('/sync', syncMessages);
router.get('/:chatId/messages', getChatMessages);

export default router;
