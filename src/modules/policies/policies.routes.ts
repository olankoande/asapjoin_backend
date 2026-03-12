import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middlewares/auth';
import { requireRole } from '../../middlewares/rbac';
import * as policiesService from './policies.service';

const router = Router();

router.get('/', authenticate, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try { res.json(await policiesService.listPolicies()); } catch (err) { next(err); }
});

router.post('/', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await policiesService.createPolicy(req.body)); } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await policiesService.updatePolicy(req.params.id as string, req.body)); } catch (err) { next(err); }
});

router.post('/:id/activate', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await policiesService.activatePolicy(req.params.id as string)); } catch (err) { next(err); }
});

// ─── Rules CRUD ───

router.post('/:id/rules', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await policiesService.addRule(req.params.id as string, req.body)); } catch (err) { next(err); }
});

router.patch('/:id/rules/:ruleId', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await policiesService.updateRule(req.params.id as string, req.params.ruleId as string, req.body)); } catch (err) { next(err); }
});

router.delete('/:id/rules/:ruleId', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await policiesService.deleteRule(req.params.id as string, req.params.ruleId as string);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
