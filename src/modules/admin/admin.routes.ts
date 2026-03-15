import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate } from '../../middlewares/auth';
import { requireRole } from '../../middlewares/rbac';
import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { getPlatformSettings, updatePlatformSettings } from '../settings/settings.service';
import { getFeeSettings } from '../fees/feeCalculator';

const router = Router();

// ─── Admin Users ───

// GET /admin/users
router.get('/admin/users', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, role, search } = req.query;
    const where: any = {};
    if (status) where.status = status as string;
    if (role) where.role = role as string;
    if (search) {
      where.OR = [
        { email: { contains: search as string } },
        { first_name: { contains: search as string } },
        { last_name: { contains: search as string } },
        { display_name: { contains: search as string } },
      ];
    }

    const users = await prisma.users.findMany({
      where,
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        display_name: true,
        phone_number: true,
        avatar_url: true,
        role: true,
        status: true,
        is_banned: true,
        email_verified: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(users);
  } catch (err) { next(err); }
});

// POST /admin/users - create a user (admin can set role)
router.post('/admin/users', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, first_name, last_name, phone_number, role } = req.body;
    if (!email || !password || !first_name || !last_name) {
      throw Errors.badRequest('email, password, first_name, and last_name are required');
    }

    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing) throw Errors.conflict('Email already registered', 'EMAIL_ALREADY_EXISTS');

    const password_hash = await bcrypt.hash(password, 12);

    const user = await prisma.users.create({
      data: {
        email,
        password_hash,
        first_name,
        last_name,
        display_name: `${first_name} ${last_name}`,
        phone_number: phone_number || null,
        role: role || 'user',
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        display_name: true,
        phone_number: true,
        role: true,
        status: true,
        is_banned: true,
        created_at: true,
      },
    });

    // Create wallet for user
    await prisma.wallets.create({
      data: {
        user_id: user.id,
        pending_balance: 0,
        available_balance: 0,
        currency: 'CAD',
      },
    });

    // Audit log
    await prisma.admin_audit_logs.create({
      data: {
        admin_id: BigInt(req.user!.userId),
        action: 'USER_CREATED',
        entity_type: 'user',
        entity_id: user.id,
        details_json: JSON.stringify({ email, first_name, last_name, role: role || 'user' }),
      },
    });

    res.status(201).json(user);
  } catch (err) { next(err); }
});

// GET /admin/users/:id
router.get('/admin/users/:id', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: BigInt(req.params.id as string) },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        display_name: true,
        phone_number: true,
        avatar_url: true,
        bio: true,
        payout_email: true,
        role: true,
        status: true,
        is_banned: true,
        email_verified: true,
        default_mode: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!user) throw Errors.notFound('User');
    res.json(user);
  } catch (err) { next(err); }
});

// PATCH /admin/users/:id - update user fields (admin)
router.patch('/admin/users/:id', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = BigInt(req.params.id as string);
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('User');

    const data: any = {};
    if (req.body.first_name !== undefined) data.first_name = req.body.first_name;
    if (req.body.last_name !== undefined) data.last_name = req.body.last_name;
    if (req.body.email !== undefined) data.email = req.body.email;
    if (req.body.phone_number !== undefined) data.phone_number = req.body.phone_number || null;
    if (req.body.payout_email !== undefined) data.payout_email = req.body.payout_email || null;
    if (req.body.role !== undefined) data.role = req.body.role;
    if (req.body.status !== undefined) data.status = req.body.status;
    if (req.body.is_banned !== undefined) data.is_banned = req.body.is_banned;
    if (req.body.bio !== undefined) data.bio = req.body.bio || null;
    if (req.body.password) {
      data.password_hash = await bcrypt.hash(req.body.password, 12);
    }
    // Update display_name if first/last name changed
    if (data.first_name || data.last_name) {
      data.display_name = `${data.first_name || user.first_name} ${data.last_name || user.last_name}`;
    }

    const updated = await prisma.users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        display_name: true,
        phone_number: true,
        payout_email: true,
        avatar_url: true,
        bio: true,
        role: true,
        status: true,
        is_banned: true,
        email_verified: true,
        created_at: true,
        updated_at: true,
      },
    });

    // Audit log
    await prisma.admin_audit_logs.create({
      data: {
        admin_id: BigInt(req.user!.userId),
        action: 'USER_UPDATED',
        entity_type: 'user',
        entity_id: userId,
        details_json: JSON.stringify(req.body),
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /admin/users/:id/status (kept for backward compat)
router.patch('/admin/users/:id/status', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = BigInt(req.params.id as string);
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('User');

    const data: any = {};
    if (req.body.is_banned !== undefined) data.is_banned = req.body.is_banned;
    if (req.body.role !== undefined) data.role = req.body.role;
    if (req.body.status !== undefined) data.status = req.body.status;

    const updated = await prisma.users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        is_banned: true,
      },
    });

    // Audit log
    await prisma.admin_audit_logs.create({
      data: {
        admin_id: BigInt(req.user!.userId),
        action: 'USER_STATUS_UPDATE',
        entity_type: 'user',
        entity_id: userId,
        details_json: JSON.stringify(req.body),
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// ─── Admin Trips ───

// GET /admin/trips
router.get('/admin/trips', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, search } = req.query;
    const where: any = {};
    if (status) where.status = status as string;
    if (search) {
      where.OR = [
        { from_city: { contains: search as string } },
        { to_city: { contains: search as string } },
      ];
    }

    const trips = await prisma.trips.findMany({
      where,
      include: {
        driver: { select: { id: true, first_name: true, last_name: true, email: true } },
        vehicle: { select: { id: true, make: true, model: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(trips);
  } catch (err) { next(err); }
});

// ─── Admin Bookings ───

// GET /admin/bookings
router.get('/admin/bookings', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status as string;

    const bookings = await prisma.bookings.findMany({
      where,
      include: {
        passenger: { select: { id: true, first_name: true, last_name: true, email: true } },
        trip: {
          select: {
            id: true,
            from_city: true,
            to_city: true,
            departure_at: true,
            driver: { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(bookings);
  } catch (err) { next(err); }
});

// ─── Admin Deliveries ───

// GET /admin/deliveries
router.get('/admin/deliveries', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status as string;

    const deliveries = await prisma.deliveries.findMany({
      where,
      include: {
        sender: { select: { id: true, first_name: true, last_name: true, email: true } },
        trip: {
          select: {
            id: true,
            from_city: true,
            to_city: true,
            departure_at: true,
            driver: { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(deliveries);
  } catch (err) { next(err); }
});

// ─── Admin Payments ───

// GET /admin/payments
router.get('/admin/payments', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status as string;

    const payments = await prisma.payments.findMany({
      where,
      include: {
        payer: { select: { id: true, first_name: true, last_name: true, email: true } },
        users_payments_payee_idTousers: { select: { id: true, first_name: true, last_name: true, email: true } },
        booking: { select: { id: true, status: true } },
        delivery: { select: { id: true, status: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(payments);
  } catch (err) { next(err); }
});

// ─── Admin Refunds ───

// GET /admin/refunds
router.get('/admin/refunds', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status as string;

    const refunds = await prisma.refunds.findMany({
      where,
      include: {
        payment: {
          select: {
            id: true,
            amount: true,
            currency: true,
            payer: { select: { id: true, first_name: true, last_name: true, email: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(refunds);
  } catch (err) { next(err); }
});

// POST /admin/refunds
router.post('/admin/refunds', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { payment_id, amount, reason } = req.body;
    if (!payment_id || !amount) throw Errors.badRequest('payment_id and amount are required');

    const payment = await prisma.payments.findUnique({ where: { id: BigInt(payment_id) } });
    if (!payment) throw Errors.notFound('Payment');

    const refund = await prisma.refunds.create({
      data: {
        payment_id: BigInt(payment_id),
        amount,
        currency: payment.currency,
        reason: reason || null,
        status: 'pending',
      },
    });

    // Audit log
    await prisma.admin_audit_logs.create({
      data: {
        admin_id: BigInt(req.user!.userId),
        action: 'REFUND_CREATED',
        entity_type: 'refund',
        entity_id: refund.id,
        details_json: JSON.stringify({ payment_id, amount, reason }),
      },
    });

    res.status(201).json(refund);
  } catch (err) { next(err); }
});

// ─── Admin Wallet ───

// GET /admin/wallet/:userId
router.get('/admin/wallet/:userId', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = await prisma.wallets.findUnique({
      where: { user_id: BigInt(req.params.userId as string) },
    });
    if (!wallet) throw Errors.notFound('Wallet');
    res.json(wallet);
  } catch (err) { next(err); }
});

// GET /admin/wallet/:userId/transactions
router.get('/admin/wallet/:userId/transactions', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = await prisma.wallets.findUnique({
      where: { user_id: BigInt(req.params.userId as string) },
    });
    if (!wallet) throw Errors.notFound('Wallet');

    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '50', 10);
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.wallet_transactions.findMany({
        where: { wallet_id: wallet.id },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.wallet_transactions.count({ where: { wallet_id: wallet.id } }),
    ]);

    res.json({
      data: transactions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// POST /admin/wallet/adjustments
router.post('/admin/wallet/adjustments', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, amount, type, reason } = req.body;
    if (!user_id || amount === undefined || !type || !reason) {
      throw Errors.badRequest('user_id, amount, type, and reason are required');
    }

    const wallet = await prisma.wallets.findUnique({
      where: { user_id: BigInt(user_id) },
    });
    if (!wallet) throw Errors.notFound('Wallet');

    // Create adjustment transaction
    const tx = await prisma.wallet_transactions.create({
      data: {
        wallet_id: wallet.id,
        type: type,
        amount: amount,
        currency: wallet.currency,
        reason_code: reason,
        reference_type: 'adjustment',
        balance_bucket: 'available',
      },
    });

    // Update wallet balance
    await prisma.wallets.update({
      where: { id: wallet.id },
      data: {
        available_balance: { increment: amount },
      },
    });

    // Audit log
    await prisma.admin_audit_logs.create({
      data: {
        admin_id: BigInt(req.user!.userId),
        action: 'WALLET_ADJUSTMENT',
        entity_type: 'wallet',
        entity_id: wallet.id,
        details_json: JSON.stringify({ user_id, amount, type, reason }),
      },
    });

    res.status(201).json(tx);
  } catch (err) { next(err); }
});

// ─── Admin Reports ───

// POST /reports - any authenticated user
router.post('/reports', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await prisma.reports.create({
      data: {
        reporter_id: BigInt(req.user!.userId),
        target_type: req.body.target_type || 'user',
        target_id: BigInt(req.body.target_id),
        reason: req.body.reason,
        status: 'open',
      },
    });
    res.status(201).json(report);
  } catch (err) { next(err); }
});

// GET /admin/reports - admin only
router.get('/admin/reports', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string;
    const where: any = {};
    if (status) where.status = status;

    const reports = await prisma.reports.findMany({
      where,
      include: {
        reporter: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(reports);
  } catch (err) { next(err); }
});

// POST /admin/reports/:id/resolve
router.post('/admin/reports/:id/resolve', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reportId = BigInt(req.params.id as string);
    const report = await prisma.reports.findUnique({ where: { id: reportId } });
    if (!report) throw Errors.notFound('Report');

    const updated = await prisma.reports.update({
      where: { id: reportId },
      data: {
        status: req.body.status || 'resolved',
        resolved_by_admin_id: BigInt(req.user!.userId),
        resolved_at: new Date(),
      },
    });

    // Audit log
    await prisma.admin_audit_logs.create({
      data: {
        admin_id: BigInt(req.user!.userId),
        action: 'REPORT_RESOLVED',
        entity_type: 'report',
        entity_id: reportId,
        details_json: JSON.stringify({ status: req.body.status, resolution: req.body.resolution }),
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// ─── Admin Audit Logs ───

// GET /admin/audit-logs
router.get('/admin/audit-logs', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, admin_id } = req.query;
    const where: any = {};
    if (action) where.action = action as string;
    if (admin_id) where.admin_id = BigInt(admin_id as string);

    const logs = await prisma.admin_audit_logs.findMany({
      where,
      include: {
        admin: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    res.json(logs);
  } catch (err) { next(err); }
});

// ─── Admin Platform Settings ───

// GET /admin/settings
router.get('/admin/settings', authenticate, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await getPlatformSettings();
    res.json(settings);
  } catch (err) { next(err); }
});

// PUT /admin/settings
router.put('/admin/settings', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { deliveries_min_hours_before_departure, deliveries_min_minutes_before_departure } = req.body;
    if (deliveries_min_hours_before_departure === undefined || deliveries_min_minutes_before_departure === undefined) {
      throw Errors.badRequest('deliveries_min_hours_before_departure and deliveries_min_minutes_before_departure are required');
    }
    const settings = await updatePlatformSettings({
      deliveries_min_hours_before_departure: Number(deliveries_min_hours_before_departure),
      deliveries_min_minutes_before_departure: Number(deliveries_min_minutes_before_departure),
    });

    // Audit log
    await prisma.admin_audit_logs.create({
      data: {
        admin_id: BigInt(req.user!.userId),
        action: 'SETTINGS_UPDATED',
        entity_type: 'platform_settings',
        entity_id: BigInt(1),
        details_json: JSON.stringify(settings),
      },
    });

    res.json(settings);
  } catch (err) { next(err); }
});

// ─── Admin Ledger & Commissions ───

// Helper: check if finance migration columns exist (only cache true, retry on false)
let _hasExtendedCols: boolean | null = null;
async function checkExtendedCols(): Promise<boolean> {
  if (_hasExtendedCols === true) return true;
  try {
    const cols = await prisma.$queryRawUnsafe<any[]>(
      `SHOW COLUMNS FROM wallet_transactions LIKE 'txn_type'`
    );
    _hasExtendedCols = cols.length > 0;
  } catch {
    _hasExtendedCols = false;
  }
  return _hasExtendedCols;
}

// GET /admin/ledger/summary
router.get('/admin/ledger/summary', authenticate, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const hasExtendedCols = await checkExtendedCols();

    if (hasExtendedCols) {
      const commissionRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as cnt
        FROM wallet_transactions WHERE txn_type = 'platform_commission'
      `);
      const grossRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as cnt
        FROM wallet_transactions WHERE txn_type IN ('booking_payment', 'delivery_payment')
      `);
      const driverNetRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as cnt
        FROM wallet_transactions WHERE txn_type = 'driver_credit_pending'
      `);
      const refundRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as cnt
        FROM wallet_transactions WHERE txn_type = 'refund'
      `);
      const payoutRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as cnt
        FROM wallet_transactions WHERE txn_type = 'payout'
      `);
      const commissionByType = await prisma.$queryRawUnsafe<any[]>(`
        SELECT reference_type, COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as cnt
        FROM wallet_transactions WHERE txn_type = 'platform_commission' GROUP BY reference_type
      `);
      const recentCommissions = await prisma.$queryRawUnsafe<any[]>(`
        SELECT DATE(created_at) as day, COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as cnt
        FROM wallet_transactions
        WHERE txn_type = 'platform_commission' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at) ORDER BY day DESC
      `);

      res.json({
        commissions: { total_cents: Number(commissionRows[0]?.total_cents || 0), total_dollars: Number(commissionRows[0]?.total_cents || 0) / 100, count: Number(commissionRows[0]?.cnt || 0) },
        gross_payments: { total_cents: Number(grossRows[0]?.total_cents || 0), total_dollars: Number(grossRows[0]?.total_cents || 0) / 100, count: Number(grossRows[0]?.cnt || 0) },
        driver_net: { total_cents: Number(driverNetRows[0]?.total_cents || 0), total_dollars: Number(driverNetRows[0]?.total_cents || 0) / 100, count: Number(driverNetRows[0]?.cnt || 0) },
        refunds: { total_cents: Number(refundRows[0]?.total_cents || 0), total_dollars: Number(refundRows[0]?.total_cents || 0) / 100, count: Number(refundRows[0]?.cnt || 0) },
        payouts: { total_cents: Number(payoutRows[0]?.total_cents || 0), total_dollars: Number(payoutRows[0]?.total_cents || 0) / 100, count: Number(payoutRows[0]?.cnt || 0) },
        commission_by_type: commissionByType.map((r: any) => ({ reference_type: r.reference_type, total_cents: Number(r.total_cents), total_dollars: Number(r.total_cents) / 100, count: Number(r.cnt) })),
        recent_daily: recentCommissions.map((r: any) => ({ day: r.day, total_cents: Number(r.total_cents), total_dollars: Number(r.total_cents) / 100, count: Number(r.cnt) })),
      });
    } else {
      // Fallback: compute commissions from payments table using fee settings
      const feeSettings = await getFeeSettings();
      const avgFeePct = (feeSettings.booking_fee_pct + feeSettings.delivery_fee_pct) / 2;

      // Get succeeded payments totals
      const paymentRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(ROUND(amount * 100)), 0) as total_cents, COUNT(*) as cnt
        FROM payments WHERE status = 'succeeded'
      `);
      const grossCents = Number(paymentRows[0]?.total_cents || 0);
      const paymentCount = Number(paymentRows[0]?.cnt || 0);

      // Estimate commissions: gross * fee_pct / (100 + fee_pct) for additive model
      const commissionCents = Math.round(grossCents * avgFeePct / (100 + avgFeePct));
      const driverNetCents = grossCents - commissionCents;

      // Booking vs delivery breakdown
      const bookingPayRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(ROUND(amount * 100)), 0) as total_cents, COUNT(*) as cnt
        FROM payments WHERE status = 'succeeded' AND booking_id IS NOT NULL
      `);
      const deliveryPayRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(ROUND(amount * 100)), 0) as total_cents, COUNT(*) as cnt
        FROM payments WHERE status = 'succeeded' AND delivery_id IS NOT NULL
      `);

      const bookingGross = Number(bookingPayRows[0]?.total_cents || 0);
      const deliveryGross = Number(deliveryPayRows[0]?.total_cents || 0);
      const bookingCommission = Math.round(bookingGross * feeSettings.booking_fee_pct / (100 + feeSettings.booking_fee_pct));
      const deliveryCommission = Math.round(deliveryGross * feeSettings.delivery_fee_pct / (100 + feeSettings.delivery_fee_pct));

      // Refunds
      const refundRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(ROUND(amount * 100)), 0) as total_cents, COUNT(*) as cnt
        FROM refunds WHERE status IN ('completed', 'pending')
      `);
      const refundCents = Number(refundRows[0]?.total_cents || 0);
      const refundCount = Number(refundRows[0]?.cnt || 0);

      // Recent daily commissions (estimated from payments)
      const recentPayments = await prisma.$queryRawUnsafe<any[]>(`
        SELECT DATE(created_at) as day, COALESCE(SUM(ROUND(amount * 100)), 0) as total_cents, COUNT(*) as cnt
        FROM payments
        WHERE status = 'succeeded' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at) ORDER BY day DESC
      `);

      res.json({
        commissions: { total_cents: commissionCents, total_dollars: commissionCents / 100, count: paymentCount },
        gross_payments: { total_cents: grossCents, total_dollars: grossCents / 100, count: paymentCount },
        driver_net: { total_cents: driverNetCents, total_dollars: driverNetCents / 100, count: paymentCount },
        refunds: { total_cents: refundCents, total_dollars: refundCents / 100, count: refundCount },
        payouts: { total_cents: 0, total_dollars: 0, count: 0 },
        commission_by_type: [
          ...(bookingCommission > 0 ? [{ reference_type: 'booking', total_cents: bookingCommission, total_dollars: bookingCommission / 100, count: Number(bookingPayRows[0]?.cnt || 0) }] : []),
          ...(deliveryCommission > 0 ? [{ reference_type: 'delivery', total_cents: deliveryCommission, total_dollars: deliveryCommission / 100, count: Number(deliveryPayRows[0]?.cnt || 0) }] : []),
        ],
        recent_daily: recentPayments.map((r: any) => {
          const dayCents = Number(r.total_cents);
          const dayCommission = Math.round(dayCents * avgFeePct / (100 + avgFeePct));
          return { day: r.day, total_cents: dayCommission, total_dollars: dayCommission / 100, count: Number(r.cnt) };
        }),
      });
    }
  } catch (err) { next(err); }
});

// GET /admin/ledger - list all ledger entries (wallet_transactions) via raw SQL
router.get('/admin/ledger', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '50', 10);
    const offset = (page - 1) * limit;
    const txnType = req.query.txn_type as string;
    const referenceType = req.query.reference_type as string;
    const direction = req.query.direction as string;

    const hasExtendedCols = await checkExtendedCols();

    if (hasExtendedCols) {
      // Build WHERE clauses dynamically (sanitize inputs)
      const conditions: string[] = ['1=1'];
      const allowedTxnTypes = ['booking_payment','delivery_payment','platform_commission','driver_credit_pending','driver_release_to_available','refund','refund_commission_reversal','refund_driver_debit','dispute_hold','dispute_release','payout','payout_reversal','adjustment'];
      const allowedDirections = ['credit','debit'];
      const allowedRefTypes = ['booking','delivery','refund','payout','adjustment','payment','payout_batch','dispute','system'];

      if (txnType && allowedTxnTypes.includes(txnType)) conditions.push(`wt.txn_type = '${txnType}'`);
      if (referenceType && allowedRefTypes.includes(referenceType)) conditions.push(`wt.reference_type = '${referenceType}'`);
      if (direction && allowedDirections.includes(direction)) conditions.push(`wt.direction = '${direction}'`);
      const whereClause = conditions.join(' AND ');

      const [entries, countRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(`
          SELECT
            wt.id, wt.wallet_id, wt.user_id, wt.direction, wt.amount_cents,
            wt.status as txn_status, wt.txn_type, wt.type, wt.amount, wt.currency,
            wt.reason_code, wt.reference_type, wt.reference_id,
            wt.snapshot_json, wt.balance_bucket, wt.created_at,
            w.user_id as wallet_user_id,
            u.id as u_id, u.first_name, u.last_name, u.email
          FROM wallet_transactions wt
          LEFT JOIN wallets w ON w.id = wt.wallet_id
          LEFT JOIN users u ON u.id = w.user_id
          WHERE ${whereClause}
          ORDER BY wt.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
        prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(`
          SELECT COUNT(*) as cnt FROM wallet_transactions wt WHERE ${whereClause}
        `),
      ]);

      const total = Number(countRows[0]?.cnt || 0);

      const data = entries.map((row: any) => ({
        id: row.id?.toString(),
        wallet_id: row.wallet_id?.toString(),
        user_id: row.user_id?.toString(),
        direction: row.direction,
        amount_cents: Number(row.amount_cents || 0),
        status: row.txn_status,
        txn_type: row.txn_type,
        type: row.type,
        amount: Number(row.amount || 0),
        currency: row.currency,
        reason_code: row.reason_code,
        reference_type: row.reference_type,
        reference_id: row.reference_id?.toString(),
        snapshot_json: row.snapshot_json,
        balance_bucket: row.balance_bucket,
        created_at: row.created_at,
        wallet: {
          user_id: row.wallet_user_id?.toString(),
          user: row.u_id ? {
            id: row.u_id?.toString(),
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
          } : null,
        },
      }));

      res.json({
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } else {
      // Fallback: use raw SQL with only base columns
      const conditions: string[] = ['1=1'];
      const allowedRefTypes = ['booking','delivery','refund','payout','adjustment','payment'];
      if (referenceType && allowedRefTypes.includes(referenceType)) conditions.push(`wt.reference_type = '${referenceType}'`);
      const whereClause = conditions.join(' AND ');

      const [entries, countRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(`
          SELECT
            wt.id, wt.wallet_id, wt.type, wt.amount, wt.currency,
            wt.reason_code, wt.reference_type, wt.reference_id,
            wt.balance_bucket, wt.created_at,
            w.user_id as wallet_user_id,
            u.id as u_id, u.first_name, u.last_name, u.email
          FROM wallet_transactions wt
          LEFT JOIN wallets w ON w.id = wt.wallet_id
          LEFT JOIN users u ON u.id = w.user_id
          WHERE ${whereClause}
          ORDER BY wt.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
        prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(`
          SELECT COUNT(*) as cnt FROM wallet_transactions wt WHERE ${whereClause}
        `),
      ]);

      const total = Number(countRows[0]?.cnt || 0);

      const data = entries.map((row: any) => ({
        id: row.id?.toString(),
        wallet_id: row.wallet_id?.toString(),
        user_id: null,
        direction: null,
        amount_cents: Math.round(Number(row.amount || 0) * 100),
        status: 'posted',
        txn_type: row.type,
        type: row.type,
        amount: Number(row.amount || 0),
        currency: row.currency,
        reason_code: row.reason_code,
        reference_type: row.reference_type,
        reference_id: row.reference_id?.toString(),
        snapshot_json: null,
        balance_bucket: row.balance_bucket,
        created_at: row.created_at,
        wallet: {
          user_id: row.wallet_user_id?.toString(),
          user: row.u_id ? {
            id: row.u_id?.toString(),
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
          } : null,
        },
      }));

      res.json({
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    }
  } catch (err) { next(err); }
});

// ─── Admin Dashboard Stats ───

// GET /admin/dashboard/stats
router.get('/admin/dashboard/stats', authenticate, requireRole('admin', 'support'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      totalUsers,
      totalTrips,
      totalBookings,
      totalDeliveries,
      totalPayments,
      pendingReports,
    ] = await Promise.all([
      prisma.users.count(),
      prisma.trips.count(),
      prisma.bookings.count(),
      prisma.deliveries.count(),
      prisma.payments.count(),
      prisma.reports.count({ where: { status: 'open' } }),
    ]);

    res.json({
      totalUsers,
      totalTrips,
      totalBookings,
      totalDeliveries,
      totalPayments,
      pendingReports,
    });
  } catch (err) { next(err); }
});

export default router;
