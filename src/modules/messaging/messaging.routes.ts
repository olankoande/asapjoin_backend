import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { sendMessageBody, conversationIdParam, messagesQuery } from './messaging.schemas';
import * as ctrl from './messaging.controller';

const router = Router();

// All routes require authentication
router.use(authenticate, checkNotBanned);

// GET /conversations — list user's conversations
router.get('/', ctrl.listConversations);

// POST /conversations/start — create or get conversation from booking/delivery
router.post('/start', ctrl.startConversation);

// GET /conversations/unread — unread count
router.get('/unread', ctrl.getUnreadCount);

// GET /conversations/:id — conversation details
router.get('/:id', ctrl.getConversation);

// GET /conversations/:id/messages — paginated messages
router.get('/:id/messages', ctrl.listMessages);

// POST /conversations/:id/messages — send a message
router.post('/:id/messages', validate({ body: sendMessageBody }), ctrl.sendMessage);

// POST /conversations/:id/read — mark as read
router.post('/:id/read', ctrl.markAsRead);

// POST /conversations/:id/archive — archive conversation
router.post('/:id/archive', ctrl.archiveConversation);

export default router;
