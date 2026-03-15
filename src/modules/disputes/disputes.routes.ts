import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { requireRole } from '../../middlewares/rbac';
import * as disputesService from './disputes.service';

const router = Router();

// ─── Admin Endpoints (MUST be before /:id to avoid matching "admin" as an ID) ───

/**
 * GET /api/v1/disputes/admin — List disputes (admin)
 */
router.get('/admin', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const disputes = await disputesService.listDisputes(status);
    res.json({ disputes });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/disputes/admin/:id — Get dispute detail (admin — with replies)
 */
router.get('/admin/:id', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dispute = await disputesService.getDispute(String(req.params.id));
    res.json(dispute);
  } catch (err) { next(err); }
});

/**
 * PATCH /api/v1/disputes/admin/:id/status — Update dispute status (admin)
 */
router.patch('/admin/:id/status', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Le statut est requis' });
    }
    const result = await disputesService.updateDisputeStatus(req.user!.userId, String(req.params.id), status);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/disputes/admin/:id/resolve — Resolve dispute (admin)
 */
router.post('/admin/:id/resolve', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await disputesService.resolveDispute(req.user!.userId, String(req.params.id), req.body);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/disputes/admin/:id/reply — Admin reply to a dispute
 */
router.post('/admin/:id/reply', authenticate, requireRole('admin', 'support'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Le message est requis' });
    }
    const result = await disputesService.replyToDispute(
      String(req.params.id),
      req.user!.userId,
      req.user!.role,
      message.trim(),
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ─── User Endpoints ───

/**
 * POST /api/v1/disputes — Open a dispute (user)
 */
router.post('/', authenticate, checkNotBanned, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await disputesService.openDispute(req.user!.userId, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/disputes/:id — Get dispute detail (user — must be participant)
 */
router.get('/:id', authenticate, checkNotBanned, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dispute = await disputesService.getDisputeForUser(String(req.params.id), req.user!.userId);
    res.json(dispute);
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/disputes/:id/reply — Reply to a dispute (user or admin)
 */
router.post('/:id/reply', authenticate, checkNotBanned, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Le message est requis' });
    }
    const result = await disputesService.replyToDispute(
      String(req.params.id),
      req.user!.userId,
      req.user!.role,
      message.trim(),
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
});

export default router;
