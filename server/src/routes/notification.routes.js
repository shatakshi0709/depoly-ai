import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../controllers/notification.controller.js';

const router = Router();
router.use(authenticateToken);

router.get('/', getNotifications);
router.post('/read-all', markAllNotificationsRead);
router.post('/:id/read', markNotificationRead);

export default router;
