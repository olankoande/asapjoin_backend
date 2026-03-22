import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { requirePermission } from '../../middlewares/rbac';
import { validate } from '../../middlewares/validate';
import { prisma } from '../../db/prisma';
import * as rbacService from './rbac.service';
import {
  createRoleSchema,
  replaceRolePermissionsSchema,
  replaceUserRolesSchema,
  roleIdParamSchema,
  roleQuerySchema,
  updateRoleSchema,
  userIdParamSchema,
} from './rbac.schemas';

const router = Router();

async function audit(adminId: string, action: string, entityType: string, entityId: string | null, details: Record<string, unknown>) {
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: BigInt(adminId),
      action,
      entity_type: entityType,
      entity_id: entityId ? BigInt(entityId) : null,
      details_json: JSON.stringify(details),
    },
  });
}

router.get('/admin/permissions', authenticate, checkNotBanned, requirePermission('permissions.read'), async (_req, res, next) => {
  try {
    const permissions = await rbacService.getAllPermissions();
    res.json(permissions);
  } catch (error) {
    next(error);
  }
});

router.get('/admin/roles', authenticate, checkNotBanned, validate({ query: roleQuerySchema }), requirePermission('roles.read'), async (req, res, next) => {
  try {
    const roles = await rbacService.listRoles(req.query.search as string | undefined);
    res.json(roles);
  } catch (error) {
    next(error);
  }
});

router.post('/admin/roles', authenticate, checkNotBanned, validate({ body: createRoleSchema }), requirePermission('roles.create'), async (req, res, next) => {
  try {
    const role = await rbacService.createRole(req.body);
    await audit(req.user!.userId, 'ROLE_CREATED', 'role', role.id.toString(), req.body);
    res.status(201).json(role);
  } catch (error) {
    next(error);
  }
});

router.get('/admin/roles/:id', authenticate, checkNotBanned, validate({ params: roleIdParamSchema }), requirePermission('roles.read'), async (req, res, next) => {
  try {
    const role = await rbacService.getRoleById(String(req.params.id));
    res.json(role);
  } catch (error) {
    next(error);
  }
});

router.patch('/admin/roles/:id', authenticate, checkNotBanned, validate({ params: roleIdParamSchema, body: updateRoleSchema }), requirePermission('roles.update'), async (req, res, next) => {
  try {
    const roleId = String(req.params.id);
    const role = await rbacService.updateRole(roleId, req.body);
    await audit(req.user!.userId, 'ROLE_UPDATED', 'role', role.id.toString(), req.body);
    res.json(role);
  } catch (error) {
    next(error);
  }
});

router.delete('/admin/roles/:id', authenticate, checkNotBanned, validate({ params: roleIdParamSchema }), requirePermission('roles.delete'), async (req, res, next) => {
  try {
    const roleId = String(req.params.id);
    await rbacService.deleteRole(roleId);
    await audit(req.user!.userId, 'ROLE_DELETED', 'role', roleId, {});
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get('/admin/roles/:id/permissions', authenticate, checkNotBanned, validate({ params: roleIdParamSchema }), requirePermission('roles.read'), async (req, res, next) => {
  try {
    const permissions = await rbacService.listRolePermissions(String(req.params.id));
    res.json(permissions);
  } catch (error) {
    next(error);
  }
});

router.put('/admin/roles/:id/permissions', authenticate, checkNotBanned, validate({ params: roleIdParamSchema, body: replaceRolePermissionsSchema }), requirePermission('roles.update'), async (req, res, next) => {
  try {
    const roleId = String(req.params.id);
    const permissions = await rbacService.replaceRolePermissions(roleId, req.body.permissionIds);
    await audit(req.user!.userId, 'ROLE_PERMISSIONS_UPDATED', 'role', roleId, { permissionIds: req.body.permissionIds });
    res.json(permissions);
  } catch (error) {
    next(error);
  }
});

router.get('/admin/users/:id/roles', authenticate, checkNotBanned, validate({ params: userIdParamSchema }), requirePermission('users.read'), async (req, res, next) => {
  try {
    const roles = await rbacService.listUserRoles(String(req.params.id));
    res.json(roles);
  } catch (error) {
    next(error);
  }
});

router.put('/admin/users/:id/roles', authenticate, checkNotBanned, validate({ params: userIdParamSchema, body: replaceUserRolesSchema }), requirePermission('users.update'), async (req, res, next) => {
  try {
    const userId = String(req.params.id);
    const roles = await rbacService.replaceUserRoles(userId, req.body.roleIds);
    await audit(req.user!.userId, 'USER_ROLES_UPDATED', 'user', userId, { roleIds: req.body.roleIds });
    res.json(roles);
  } catch (error) {
    next(error);
  }
});

router.get('/me/permissions', authenticate, checkNotBanned, async (req, res, next) => {
  try {
    const permissions = await rbacService.listCurrentUserPermissions(req.user!.userId, req.user!.role);
    res.json({ permissions });
  } catch (error) {
    next(error);
  }
});

router.get('/me/roles', authenticate, checkNotBanned, async (req, res, next) => {
  try {
    const roles = await rbacService.listCurrentUserRoles(req.user!.userId, req.user!.role);
    res.json({ roles });
  } catch (error) {
    next(error);
  }
});

export default router;
