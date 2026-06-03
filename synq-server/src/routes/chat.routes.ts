import { Router } from 'express';
import { getChats, getOrCreateDirectChat, getChatMessages } from '../controllers/chat.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.get('/', getChats);
router.post('/direct', getOrCreateDirectChat);
router.get('/:chatId/messages', getChatMessages);

export default router;
