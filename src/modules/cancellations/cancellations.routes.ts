/**
 * Cancellation & Refund Routes
 *
 * Endpoints:
 * - GET  /bookings/:id/cancel-preview
 * - POST /bookings/:id/cancel
 * - GET  /deliveries/:id/cancel-preview
 * - POST /deliveries/:id/cancel
 * - GET  /admin/refund-policies
 * - POST /admin/refund-policies
 * - PATCH /admin/refund-policies/:id
 * - POST /admin/refund-policies/:id/activate
 * - POST /admin/refund-policies/:id/deactivate
 * - POST /admin/refunds/override
 * - GET  /admin/cancellation-requests
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { requireRole } from '../../middlewares/rbac';
import {
  previewBookingCancellation,
  previewDeliveryCancellation,
  executeBookingCancellation,
  executeDeliveryCancellation,
  adminOverrideRefund,
} from './cancellationService';
import {
  listRefundPolicies,
  createRefundPolicy,
  updateRefundPolicy,
  activateRefundPolicy,
  deactivateRefundPolicy,
} from './refundPolicyService';
import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';

const router = Router();

// ─── Booking Cancel Preview ───
router.get(
  '/bookings/:id/cancel-preview',
  authenticate,
  checkNotBanned,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await previewBookingCancellation(
        req.params.id as string,
        req.user!.userId,
        req.user!.role,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Booking Cancel ───
router.post(
  '/bookings/:id/cancel',
  authenticate,
  checkNotBanned,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await executeBookingCancellation(
        req.params.id as string,
        req.user!.userId,
        req.user!.role,
        req.body?.reason,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Delivery Cancel Preview ───
router.get(
  '/deliveries/:id/cancel-preview',
  authenticate,
  checkNotBanned,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await previewDeliveryCancellation(
        req.params.id as string,
        req.user!.userId,
        req.user!.role,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Delivery Cancel ───
router.post(
  '/deliveries/:id/cancel',
  authenticate,
  checkNotBanned,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await executeDeliveryCancellation(
        req.params.id as string,
        req.user!.userId,
        req.user!.role,
        req.body?.reason,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin: List Refund Policies ───
router.get(
  '/admin/refund-policies',
  authenticate,
  requireRole('admin', 'support'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters: any = {};
      if (req.query.resource_type) filters.resource_type = req.query.resource_type as string;
      if (req.query.actor_role) filters.actor_role = req.query.actor_role as string;
      if (req.query.active !== undefined) filters.active = req.query.active === 'true';

      const policies = await listRefundPolicies(filters);

      // Serialize BigInt for JSON
      const serialized = policies.map(p => ({
        ...p,
        id: p.id.toString(),
      }));

      res.json(serialized);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin: Create Refund Policy ───
router.post(
  '/admin/refund-policies',
  authenticate,
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        resource_type, actor_role, name,
        min_hours_before_departure, refund_request_deadline_hours,
        cancellation_fee_fixed_cents, cancellation_fee_percent,
        refund_percent_to_customer, driver_compensation_percent,
        applies_when_statuses, priority, notes,
      } = req.body;

      if (!resource_type || !actor_role || !name || !applies_when_statuses) {
        throw Errors.badRequest('resource_type, actor_role, name, and applies_when_statuses are required');
      }

      const policy = await createRefundPolicy({
        resource_type,
        actor_role,
        name,
        min_hours_before_departure,
        refund_request_deadline_hours,
        cancellation_fee_fixed_cents,
        cancellation_fee_percent,
        refund_percent_to_customer,
        driver_compensation_percent,
        applies_when_statuses,
        priority,
        notes,
      });

      // Audit log
      await prisma.admin_audit_logs.create({
        data: {
          admin_id: BigInt(req.user!.userId),
          action: 'REFUND_POLICY_CREATED',
          entity_type: 'refund_policy',
          entity_id: policy.id,
          details_json: JSON.stringify(req.body),
        },
      });

      res.status(201).json({ ...policy, id: policy.id.toString() });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin: Update Refund Policy ───
router.patch(
  '/admin/refund-policies/:id',
  authenticate,
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const policyId = BigInt(req.params.id as string);
      const policy = await updateRefundPolicy(policyId, req.body);

      // Audit log
      await prisma.admin_audit_logs.create({
        data: {
          admin_id: BigInt(req.user!.userId),
          action: 'REFUND_POLICY_UPDATED',
          entity_type: 'refund_policy',
          entity_id: policyId,
          details_json: JSON.stringify(req.body),
        },
      });

      res.json({ ...policy, id: policy.id.toString() });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin: Activate Refund Policy ───
router.post(
  '/admin/refund-policies/:id/activate',
  authenticate,
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const policyId = BigInt(req.params.id as string);
      const policy = await activateRefundPolicy(policyId);

      await prisma.admin_audit_logs.create({
        data: {
          admin_id: BigInt(req.user!.userId),
          action: 'REFUND_POLICY_ACTIVATED',
          entity_type: 'refund_policy',
          entity_id: policyId,
        },
      });

      res.json({ ...policy, id: policy.id.toString() });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin: Deactivate Refund Policy ───
router.post(
  '/admin/refund-policies/:id/deactivate',
  authenticate,
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const policyId = BigInt(req.params.id as string);
      const policy = await deactivateRefundPolicy(policyId);

      await prisma.admin_audit_logs.create({
        data: {
          admin_id: BigInt(req.user!.userId),
          action: 'REFUND_POLICY_DEACTIVATED',
          entity_type: 'refund_policy',
          entity_id: policyId,
        },
      });

      res.json({ ...policy, id: policy.id.toString() });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin: Override Refund ───
router.post(
  '/admin/refunds/override',
  authenticate,
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { resource_type, resource_id, refund_amount_cents, reason, override_policy } = req.body;

      if (!resource_type || !resource_id || refund_amount_cents === undefined) {
        throw Errors.badRequest('resource_type, resource_id, and refund_amount_cents are required');
      }

      if (!['booking', 'delivery'].includes(resource_type)) {
        throw Errors.badRequest('resource_type must be booking or delivery');
      }

      const result = await adminOverrideRefund(req.user!.userId, {
        resource_type,
        resource_id: String(resource_id),
        refund_amount_cents: Number(refund_amount_cents),
        reason,
        override_policy,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin: List Cancellation Requests ───
router.get(
  '/admin/cancellation-requests',
  authenticate,
  requireRole('admin', 'support'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, resource_type } = req.query;
      let query = 'SELECT * FROM cancellation_requests WHERE 1=1';
      const params: any[] = [];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }
      if (resource_type) {
        query += ' AND resource_type = ?';
        params.push(resource_type);
      }

      query += ' ORDER BY created_at DESC LIMIT 200';

      const rows = await prisma.$queryRawUnsafe<any[]>(query, ...params);

      const serialized = rows.map((r: any) => ({
        id: r.id?.toString(),
        resource_type: r.resource_type,
        resource_id: r.resource_id?.toString(),
        actor_user_id: r.actor_user_id?.toString(),
        actor_role: r.actor_role,
        reason: r.reason,
        original_amount_cents: Number(r.original_amount_cents || 0),
        calculated_refund_cents: Number(r.calculated_refund_cents || 0),
        calculated_fee_cents: Number(r.calculated_fee_cents || 0),
        driver_reversal_cents: Number(r.driver_reversal_cents || 0),
        commission_reversal_cents: Number(r.commission_reversal_cents || 0),
        driver_compensation_cents: Number(r.driver_compensation_cents || 0),
        policy_id: r.policy_id?.toString() || null,
        status: r.status,
        stripe_refund_id: r.stripe_refund_id,
        refund_id: r.refund_id?.toString() || null,
        is_admin_override: Boolean(r.is_admin_override),
        created_at: r.created_at,
        processed_at: r.processed_at,
      }));

      res.json(serialized);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
