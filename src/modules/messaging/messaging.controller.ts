import type { Request, Response, NextFunction } from 'express';
import * as messagingService from './messaging.service';

export async function listConversations(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const conversations = await messagingService.getUserConversations(userId, userRole);
    res.json({ data: conversations });
  } catch (err) { next(err); }
}

export async function getConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const convId = req.params.id as string;
    const conversation = await messagingService.getConversation(convId, userId, userRole);
    res.json({ data: conversation });
  } catch (err) { next(err); }
}

export async function listMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const convId = req.params.id as string;
    const messages = await messagingService.getMessages(convId, userId, userRole, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      cursor: req.query.cursor as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
    });
    res.json({ data: messages });
  } catch (err) { next(err); }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const convId = req.params.id as string;
    const message = await messagingService.sendMessage(convId, userId, req.body.content, userRole);
    res.status(201).json({ data: message });
  } catch (err) { next(err); }
}

export async function markAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const convId = req.params.id as string;
    const result = await messagingService.markAsRead(convId, userId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function archiveConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const convId = req.params.id as string;
    const result = await messagingService.archiveConversation(convId, userId, userRole);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getUnreadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const count = await messagingService.getUnreadCount(userId);
    res.json({ data: { unread_count: count } });
  } catch (err) { next(err); }
}

export async function startConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { booking_id, delivery_id } = req.body;
    const conversation = await messagingService.startConversation(userId, {
      bookingId: booking_id,
      deliveryId: delivery_id,
    });
    res.status(200).json({ data: conversation });
  } catch (err) { next(err); }
}
