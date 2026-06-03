import { Router } from 'express';
import { register, login, getMe, refreshToken, getAllUsers } from '../controllers/auth.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.get('/me', authenticateJWT, getMe);
router.get('/users', authenticateJWT, getAllUsers);

export default router;
