import { Router } from 'express';
import { register, login, getMe, refreshToken, getAllUsers } from '../controllers/auth.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { registerSchema, loginSchema } from '../schemas/auth.schema';

const router = Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', refreshToken);
router.get('/me', authenticateJWT, getMe);
router.get('/users', authenticateJWT, getAllUsers);

export default router;
