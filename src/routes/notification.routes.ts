
// src/routes/notification.routes.ts
import { Router } from 'express';
import { sendNotification } from '../controllers/notification.controller';
import { verifyToken, checkRole } from '../middleware/auth.middleware';

const router = Router();

router.post('/send', verifyToken, checkRole(['admin']), sendNotification);

export default router;