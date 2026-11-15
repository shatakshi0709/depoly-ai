import prisma from '../config/db.js';
import { isUuid } from '../utils/validate.js';

export async function getNotifications(req, res, next) {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationRead(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification identifier.' });
    }
    const result = await prisma.notification.updateMany({
      where: { id, userId: req.user.userId },
      data: { isRead: true },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }
    res.json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    next(error);
  }
}

export async function markAllNotificationsRead(req, res, next) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.userId, isRead: false },
      data: { isRead: true },
    });
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    next(error);
  }
}
