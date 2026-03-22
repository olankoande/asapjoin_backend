import { z } from 'zod';

export const roleIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Role id must be a numeric string'),
});

export const userIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'User id must be a numeric string'),
});

export const createRoleSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/, 'Role code must contain lowercase letters, numbers or underscores'),
  description: z.string().max(500).optional().or(z.literal('')),
});

export const updateRoleSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional().or(z.literal('')),
});

export const replaceRolePermissionsSchema = z.object({
  permissionIds: z.array(z.string().regex(/^\d+$/)).default([]),
});

export const replaceUserRolesSchema = z.object({
  roleIds: z.array(z.string().regex(/^\d+$/)).default([]),
});

export const roleQuerySchema = z.object({
  search: z.string().max(120).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
