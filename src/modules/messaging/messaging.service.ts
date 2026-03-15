import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { logger } from '../../config/logger';

// ═══════════════════════════════════════════════════════════
// CONVERSATION CREATION (auto)
// ═══════════════════════════════════════════════════════════

export async function getOrCreateBookingConversation(
  bookingId: bigint, driverId: bigint, passengerId: bigint, createdBy: bigint,
): Promise<bigint> {
  const existing = await prisma.conversations.findFirst({ where: { booking_id: bookingId } });
  if (existing) return existing.id;

  const conv = await prisma.conversations.create({
    data: { booking_id: bookingId, type: 'booking', status: 'open', created_by: createdBy },
  });

  await prisma.conversation_participants.createMany({
    data: [
      { conversation_id: conv.id, user_id: driverId, role: 'driver' },
      { conversation_id: conv.id, user_id: passengerId, role: 'passenger' },
    ],
    skipDuplicates: true,
  });

  logger.info(`Conversation ${conv.id} created for booking ${bookingId}`);
  return conv.id;
}

export async function getOrCreateDeliveryConversation(
  deliveryId: bigint, driverId: bigint, senderId: bigint, recipientId: bigint | null, createdBy: bigint,
): Promise<bigint> {
  const existing = await prisma.conversations.findFirst({ where: { delivery_id: deliveryId } });
  if (existing) return existing.id;

  const conv = await prisma.conversations.create({
    data: { delivery_id: deliveryId, type: 'delivery', status: 'open', created_by: createdBy },
  });

  const participants: Array<{ conversation_id: bigint; user_id: bigint; role: 'driver' | 'sender' | 'recipient' }> = [
    { conversation_id: conv.id, user_id: driverId, role: 'driver' },
    { conversation_id: conv.id, user_id: senderId, role: 'sender' },
  ];
  if (recipientId && recipientId !== senderId && recipientId !== driverId) {
    participants.push({ conversation_id: conv.id, user_id: recipientId, role: 'recipient' });
  }

  await prisma.conversation_participants.createMany({ data: participants, skipDuplicates: true });

  logger.info(`Conversation ${conv.id} created for delivery ${deliveryId}`);
  return conv.id;
}

// ═══════════════════════════════════════════════════════════
// SYSTEM MESSAGES (CONV-SEC-6)
// ═══════════════════════════════════════════════════════════

export async function addSystemMessage(conversationId: bigint, content: string): Promise<void> {
  try {
    await prisma.messages.create({
      data: { conversation_id: conversationId, sender_id: null, message_type: 'system', message_text: content },
    });
    await prisma.conversations.update({ where: { id: conversationId }, data: { last_message_at: new Date() } });
  } catch (err: any) {
    logger.error(`Failed to add system message to conv ${conversationId}: ${err.message}`);
  }
}

export async function addBookingSystemMessage(bookingId: bigint, content: string): Promise<void> {
  const conv = await prisma.conversations.findFirst({ where: { booking_id: bookingId } });
  if (conv) await addSystemMessage(conv.id, content);
}

export async function addDeliverySystemMessage(deliveryId: bigint, content: string): Promise<void> {
  const conv = await prisma.conversations.findFirst({ where: { delivery_id: deliveryId } });
  if (conv) await addSystemMessage(conv.id, content);
}

// ═══════════════════════════════════════════════════════════
// START CONVERSATION (from booking or delivery)
// ═══════════════════════════════════════════════════════════

export async function startConversation(userId: string, opts: { bookingId?: string; deliveryId?: string }) {
  const uid = BigInt(userId);

  if (opts.bookingId) {
    const booking = await prisma.bookings.findUnique({
      where: { id: BigInt(opts.bookingId) },
      include: { trip: true },
    });
    if (!booking) throw Errors.notFound('Booking');

    // Verify user is participant (passenger or driver)
    if (booking.passenger_id !== uid && booking.trip.driver_id !== uid) {
      throw Errors.forbidden('You are not a participant of this booking');
    }

    const convId = await getOrCreateBookingConversation(
      booking.id, booking.trip.driver_id, booking.passenger_id, uid,
    );
    return getConversation(convId.toString(), userId);
  }

  if (opts.deliveryId) {
    const delivery = await prisma.deliveries.findUnique({
      where: { id: BigInt(opts.deliveryId) },
      include: { trip: true },
    });
    if (!delivery) throw Errors.notFound('Delivery');

    // Verify user is participant (sender, recipient, or driver)
    if (delivery.sender_id !== uid && delivery.recipient_user_id !== uid && delivery.trip.driver_id !== uid) {
      throw Errors.forbidden('You are not a participant of this delivery');
    }

    const convId = await getOrCreateDeliveryConversation(
      delivery.id, delivery.trip.driver_id, delivery.sender_id, delivery.recipient_user_id, uid,
    );
    return getConversation(convId.toString(), userId);
  }

  throw Errors.badRequest('Either bookingId or deliveryId is required', 'MISSING_REFERENCE');
}

// ═══════════════════════════════════════════════════════════
// ACCESS CONTROL
// ═══════════════════════════════════════════════════════════

async function assertParticipant(conversationId: bigint, userId: bigint, userRole?: string): Promise<void> {
  if (userRole === 'admin') return;
  const p = await prisma.conversation_participants.findFirst({
    where: { conversation_id: conversationId, user_id: userId },
  });
  if (!p) throw Errors.forbidden('You are not a participant of this conversation', 'NOT_CONVERSATION_PARTICIPANT');
}

// ═══════════════════════════════════════════════════════════
// API METHODS
// ═══════════════════════════════════════════════════════════

const USER_SELECT = { id: true, first_name: true, last_name: true, avatar_url: true } as const;

export async function getUserConversations(userId: string, userRole?: string) {
  if (!userId) return [];
  const uid = BigInt(userId);

  const conversations = await prisma.conversations.findMany({
    where: userRole === 'admin' ? {} : {
      conversation_participants: { some: { user_id: uid } },
    },
    include: {
      booking: {
        include: {
          passenger: { select: USER_SELECT },
          trip: { select: { id: true, from_city: true, to_city: true, departure_at: true, driver: { select: USER_SELECT } } },
        },
      },
      delivery: {
        include: {
          sender: { select: USER_SELECT },
          recipient: { select: USER_SELECT },
          trip: { select: { id: true, from_city: true, to_city: true, departure_at: true, driver: { select: USER_SELECT } } },
        },
      },
      conversation_participants: {
        include: { users: { select: USER_SELECT } },
      },
      messages: { orderBy: { created_at: 'desc' }, take: 1 },
    },
    orderBy: [{ last_message_at: 'desc' }, { created_at: 'desc' }],
  });

  return conversations.map((conv) => {
    const otherParticipants = conv.conversation_participants
      .filter((p) => p.user_id !== uid)
      .map((p) => ({ id: p.users.id.toString(), first_name: p.users.first_name, last_name: p.users.last_name, avatar_url: p.users.avatar_url, role: p.role }));

    let otherUser = otherParticipants[0] || null;
    if (conv.booking) {
      const b = conv.booking;
      otherUser = b.passenger_id === uid
        ? { id: b.trip.driver.id.toString(), first_name: b.trip.driver.first_name, last_name: b.trip.driver.last_name, avatar_url: b.trip.driver.avatar_url, role: 'driver' as const }
        : { id: b.passenger.id.toString(), first_name: b.passenger.first_name, last_name: b.passenger.last_name, avatar_url: b.passenger.avatar_url, role: 'passenger' as const };
    } else if (conv.delivery) {
      const d = conv.delivery;
      otherUser = d.sender_id === uid
        ? { id: d.trip.driver.id.toString(), first_name: d.trip.driver.first_name, last_name: d.trip.driver.last_name, avatar_url: d.trip.driver.avatar_url, role: 'driver' as const }
        : { id: d.sender.id.toString(), first_name: d.sender.first_name, last_name: d.sender.last_name, avatar_url: d.sender.avatar_url, role: 'sender' as const };
    }

    const lastMsg = conv.messages[0];
    const myP = conv.conversation_participants.find((p) => p.user_id === uid);

    return {
      id: conv.id.toString(),
      type: conv.type,
      status: conv.status,
      booking_id: conv.booking_id?.toString() || null,
      delivery_id: conv.delivery_id?.toString() || null,
      other_user: otherUser,
      participants: otherParticipants,
      last_message: lastMsg ? {
        id: lastMsg.id.toString(),
        content: lastMsg.message_text,
        message_text: lastMsg.message_text,
        sender_id: lastMsg.sender_id?.toString() || null,
        message_type: lastMsg.message_type,
        created_at: lastMsg.created_at.toISOString(),
      } : null,
      last_message_at: conv.last_message_at?.toISOString() || conv.created_at.toISOString(),
      has_unread: lastMsg && myP?.last_read_at ? lastMsg.created_at > myP.last_read_at : (!!lastMsg && lastMsg.sender_id !== uid),
      trip_info: conv.booking?.trip || conv.delivery?.trip ? {
        from_city: conv.booking?.trip.from_city || conv.delivery?.trip.from_city || '',
        to_city: conv.booking?.trip.to_city || conv.delivery?.trip.to_city || '',
      } : null,
      created_at: conv.created_at.toISOString(),
    };
  });
}

export async function getConversation(conversationId: string, userId: string, userRole?: string) {
  const cid = BigInt(conversationId);
  await assertParticipant(cid, BigInt(userId), userRole);

  const conv = await prisma.conversations.findUnique({
    where: { id: cid },
    include: {
      booking: {
        include: {
          passenger: { select: USER_SELECT },
          trip: { select: { id: true, from_city: true, to_city: true, departure_at: true, driver: { select: USER_SELECT } } },
        },
      },
      delivery: {
        include: {
          sender: { select: USER_SELECT },
          recipient: { select: USER_SELECT },
          trip: { select: { id: true, from_city: true, to_city: true, departure_at: true, driver: { select: USER_SELECT } } },
        },
      },
      conversation_participants: {
        include: { users: { select: USER_SELECT } },
      },
    },
  });
  if (!conv) throw Errors.notFound('Conversation');

  return {
    id: conv.id.toString(),
    type: conv.type,
    status: conv.status,
    booking_id: conv.booking_id?.toString() || null,
    delivery_id: conv.delivery_id?.toString() || null,
    participants: conv.conversation_participants.map((p) => ({
      id: p.users.id.toString(),
      first_name: p.users.first_name,
      last_name: p.users.last_name,
      avatar_url: p.users.avatar_url,
      role: p.role,
      last_read_at: p.last_read_at?.toISOString() || null,
    })),
    trip_info: conv.booking?.trip || conv.delivery?.trip ? {
      id: (conv.booking?.trip.id || conv.delivery?.trip.id)?.toString(),
      from_city: conv.booking?.trip.from_city || conv.delivery?.trip.from_city || '',
      to_city: conv.booking?.trip.to_city || conv.delivery?.trip.to_city || '',
      departure_at: (conv.booking?.trip.departure_at || conv.delivery?.trip.departure_at)?.toISOString(),
    } : null,
    created_at: conv.created_at.toISOString(),
  };
}

export async function getMessages(conversationId: string, userId: string, userRole?: string, opts?: { limit?: number; cursor?: string; page?: number }) {
  const cid = BigInt(conversationId);
  await assertParticipant(cid, BigInt(userId), userRole);

  const limit = opts?.limit || 50;
  const page = opts?.page || 1;
  const where: any = { conversation_id: cid, deleted_at: null };
  if (opts?.cursor) where.id = { lt: BigInt(opts.cursor) };

  const messages = await prisma.messages.findMany({
    where,
    include: { sender: { select: USER_SELECT } },
    orderBy: { created_at: 'desc' },
    take: limit,
    ...(opts?.cursor ? {} : { skip: (page - 1) * limit }),
  });

  return messages.map((m) => ({
    id: m.id.toString(),
    conversation_id: m.conversation_id.toString(),
    sender_id: m.sender_id?.toString() || null,
    content: m.message_text,
    message_text: m.message_text,
    message_type: m.message_type,
    created_at: m.created_at.toISOString(),
    sender: m.sender ? {
      id: m.sender.id.toString(),
      first_name: m.sender.first_name,
      last_name: m.sender.last_name,
      avatar_url: m.sender.avatar_url,
    } : null,
  }));
}

export async function sendMessage(conversationId: string, userId: string, content: string, userRole?: string) {
  const cid = BigInt(conversationId);
  const uid = BigInt(userId);
  await assertParticipant(cid, uid, userRole);

  const conv = await prisma.conversations.findUnique({ where: { id: cid } });
  if (!conv) throw Errors.notFound('Conversation');
  if (conv.status === 'closed') throw Errors.badRequest('This conversation is closed.', 'CONVERSATION_CLOSED');

  const message = await prisma.messages.create({
    data: { conversation_id: cid, sender_id: uid, message_text: content, message_type: 'text' },
    include: { sender: { select: USER_SELECT } },
  });

  await prisma.conversations.update({ where: { id: cid }, data: { last_message_at: new Date() } });
  await prisma.conversation_participants.updateMany({
    where: { conversation_id: cid, user_id: uid },
    data: { last_read_at: new Date() },
  });

  return {
    id: message.id.toString(),
    conversation_id: message.conversation_id.toString(),
    sender_id: message.sender_id?.toString() || null,
    content: message.message_text,
    message_text: message.message_text,
    message_type: 'text' as const,
    created_at: message.created_at.toISOString(),
    sender: message.sender ? {
      id: message.sender.id.toString(),
      first_name: message.sender.first_name,
      last_name: message.sender.last_name,
      avatar_url: message.sender.avatar_url,
    } : null,
  };
}

export async function markAsRead(conversationId: string, userId: string) {
  const cid = BigInt(conversationId);
  const uid = BigInt(userId);
  await assertParticipant(cid, uid);
  await prisma.conversation_participants.updateMany({
    where: { conversation_id: cid, user_id: uid },
    data: { last_read_at: new Date() },
  });
  return { success: true };
}

export async function archiveConversation(conversationId: string, userId: string, userRole?: string) {
  const cid = BigInt(conversationId);
  await assertParticipant(cid, BigInt(userId), userRole);
  await prisma.conversations.update({ where: { id: cid }, data: { status: 'archived' } });
  return { success: true };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const uid = BigInt(userId);
  const participants = await prisma.conversation_participants.findMany({
    where: { user_id: uid },
    include: { conversations: { include: { messages: { orderBy: { created_at: 'desc' }, take: 1 } } } },
  });

  let count = 0;
  for (const p of participants) {
    const lastMsg = p.conversations.messages[0];
    if (lastMsg && lastMsg.sender_id !== uid) {
      if (!p.last_read_at || lastMsg.created_at > p.last_read_at) count++;
    }
  }
  return count;
}
