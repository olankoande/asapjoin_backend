import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middlewares/auth';
import { requirePermission } from '../../middlewares/rbac';
import * as policiesService from './policies.service';

const router = Router();

router.get('/', authenticate, requirePermission('roles.read'), async (_req: Request, res: Response, next: NextFunction) => {
  try { res.json(await policiesService.listPolicies()); } catch (err) { next(err); }
});

router.post('/', authenticate, requirePermission('roles.update'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await policiesService.createPolicy(req.body)); } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requirePermission('roles.update'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await policiesService.updatePolicy(req.params.id as string, req.body)); } catch (err) { next(err); }
});

router.post('/:id/activate', authenticate, requirePermission('roles.update'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await policiesService.activatePolicy(req.params.id as string)); } catch (err) { next(err); }
});

// ─── Rules CRUD ───

router.post('/:id/rules', authenticate, requirePermission('roles.update'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await policiesService.addRule(req.params.id as string, req.body)); } catch (err) { next(err); }
});

router.patch('/:id/rules/:ruleId', authenticate, requirePermission('roles.update'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await policiesService.updateRule(req.params.id as string, req.params.ruleId as string, req.body)); } catch (err) { next(err); }
});

router.delete('/:id/rules/:ruleId', authenticate, requirePermission('roles.update'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await policiesService.deleteRule(req.params.id as string, req.params.ruleId as string);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
