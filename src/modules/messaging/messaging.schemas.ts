import { z } from 'zod';

export const sendMessageBody = z.object({
  content: z.string().min(1, 'Message cannot be empty').max(2000, 'Message too long (max 2000 characters)'),
});

export const conversationIdParam = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid conversation ID'),
});

export const messagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageBody>;
export type MessagesQuery = z.infer<typeof messagesQuery>;
