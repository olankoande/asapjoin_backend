import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import {
  buildSeedPermissions,
  getFinancePermissionCodes,
  getSupportPermissionCodes,
  PROTECTED_PERMISSION_CODES,
  SYSTEM_ROLE_CODES,
} from './rbac.constants';
import type { CreateRoleInput, UpdateRoleInput } from './rbac.schemas';

type AuthorizationSnapshot = {
  roleCodes: string[];
  permissionCodes: string[];
  isSuperAdmin: boolean;
};

const rbacPrisma = prisma as any;
let rbacTablesAvailable: boolean | null = null;

function inferSystemRoleCodesFromLegacyRole(role: string | undefined | null): string[] {
  if (role === 'admin') return [SYSTEM_ROLE_CODES.superAdmin];
  if (role === 'support') return [SYSTEM_ROLE_CODES.support];
  return [];
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort();
}

async function hasRbacTables() {
  if (rbacTablesAvailable !== null) {
    return rbacTablesAvailable;
  }

  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ table_name?: string; TABLE_NAME?: string }>>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('roles', 'permissions', 'role_permissions', 'user_roles')
      `,
    );

    rbacTablesAvailable = tables.length === 4;
  } catch {
    rbacTablesAvailable = false;
  }

  return rbacTablesAvailable;
}

function buildLegacyAuthorizationSnapshot(legacyRole?: string | null): AuthorizationSnapshot {
  const roleCodes = uniqueSorted(inferSystemRoleCodesFromLegacyRole(legacyRole));
  return {
    roleCodes,
    permissionCodes: [],
    isSuperAdmin: roleCodes.includes(SYSTEM_ROLE_CODES.superAdmin),
  };
}

export function buildAuthorizationSnapshotFromResolvedRoles(
  resolvedRoles: Array<{ code: string; permissionCodes: string[] }>,
  legacyRole?: string | null,
  allPermissionCodes: string[] = [],
): AuthorizationSnapshot {
  const roleCodes = uniqueSorted([
    ...resolvedRoles.map((role) => role.code),
    ...inferSystemRoleCodesFromLegacyRole(legacyRole),
  ]);

  const isSuperAdmin = roleCodes.includes(SYSTEM_ROLE_CODES.superAdmin);
  if (isSuperAdmin) {
    return {
      roleCodes,
      permissionCodes: uniqueSorted(allPermissionCodes),
      isSuperAdmin: true,
    };
  }

  return {
    roleCodes,
    permissionCodes: uniqueSorted(resolvedRoles.flatMap((role) => role.permissionCodes)),
    isSuperAdmin: false,
  };
}

export function isProtectedRole(role: { is_system: boolean }) {
  return role.is_system;
}

export async function getRoleByCode(code: string) {
  if (!(await hasRbacTables())) {
    return null;
  }
  return rbacPrisma.roles.findUnique({ where: { code } });
}

export async function getAllPermissions() {
  if (!(await hasRbacTables())) {
    return [];
  }
  return rbacPrisma.permissions.findMany({
    orderBy: [{ module: 'asc' }, { action: 'asc' }],
  });
}

export async function resolveUserAuthorization(userId: string, legacyRole?: string | null): Promise<AuthorizationSnapshot> {
  if (!(await hasRbacTables())) {
    return buildLegacyAuthorizationSnapshot(legacyRole);
  }

  const dbRoles = await rbacPrisma.user_roles.findMany({
    where: { user_id: BigInt(userId) },
    select: {
      role: {
        select: {
          code: true,
          role_permissions: {
            select: {
              permission: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const resolvedRoles = dbRoles.map((entry: any) => ({
    code: entry.role.code,
    permissionCodes: entry.role.role_permissions.map((rp: any) => rp.permission.code),
  }));

  const roleCodes = uniqueSorted([
    ...resolvedRoles.map((entry: { code: string }) => entry.code),
    ...inferSystemRoleCodesFromLegacyRole(legacyRole),
  ]);

  if (roleCodes.includes(SYSTEM_ROLE_CODES.superAdmin)) {
    const allPermissions = await rbacPrisma.permissions.findMany({ select: { code: true } });
    return buildAuthorizationSnapshotFromResolvedRoles(
      resolvedRoles,
      legacyRole,
      allPermissions.map((permission: any) => permission.code),
    );
  }

  return buildAuthorizationSnapshotFromResolvedRoles(resolvedRoles, legacyRole);
}

export async function userHasRole(userId: string, roleCode: string, legacyRole?: string | null) {
  const authz = await resolveUserAuthorization(userId, legacyRole);
  return authz.isSuperAdmin || authz.roleCodes.includes(roleCode);
}

export async function userHasPermission(userId: string, permissionCode: string, legacyRole?: string | null) {
  const authz = await resolveUserAuthorization(userId, legacyRole);
  return authz.isSuperAdmin || authz.permissionCodes.includes(permissionCode);
}

export async function listRoles(search?: string) {
  if (!(await hasRbacTables())) {
    return [];
  }
  return rbacPrisma.roles.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search } },
            { code: { contains: search } },
            { description: { contains: search } },
          ],
        }
      : undefined,
    include: {
      _count: {
        select: {
          user_roles: true,
          role_permissions: true,
        },
      },
    },
    orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
  });
}

export async function getRoleById(roleId: string) {
  if (!(await hasRbacTables())) {
    throw Errors.notFound('Role', 'RBAC_NOT_INITIALIZED');
  }
  const role = await rbacPrisma.roles.findUnique({
    where: { id: BigInt(roleId) },
    include: {
      role_permissions: {
        include: {
          permission: true,
        },
      },
      _count: {
        select: {
          user_roles: true,
        },
      },
    },
  });

  if (!role) {
    throw Errors.notFound('Role');
  }

  return role;
}

export async function createRole(input: CreateRoleInput) {
  if (!(await hasRbacTables())) {
    throw Errors.conflict('RBAC tables are not initialized in the database', 'RBAC_NOT_INITIALIZED');
  }
  try {
    return await rbacPrisma.roles.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description || null,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw Errors.conflict('Role code already exists', 'ROLE_CODE_EXISTS');
    }
    throw error;
  }
}

function ensureRoleCanBeMutated(role: { is_system: boolean; code: string }) {
  if (isProtectedRole(role)) {
    throw Errors.forbidden('System role is protected', 'ROLE_PROTECTED');
  }
}

export async function updateRole(roleId: string, input: UpdateRoleInput) {
  if (!(await hasRbacTables())) {
    throw Errors.conflict('RBAC tables are not initialized in the database', 'RBAC_NOT_INITIALIZED');
  }
  const existing = await rbacPrisma.roles.findUnique({ where: { id: BigInt(roleId) } });
  if (!existing) throw Errors.notFound('Role');
  ensureRoleCanBeMutated(existing);

  return rbacPrisma.roles.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      description: input.description === '' ? null : input.description,
    },
  });
}

export async function deleteRole(roleId: string) {
  if (!(await hasRbacTables())) {
    throw Errors.conflict('RBAC tables are not initialized in the database', 'RBAC_NOT_INITIALIZED');
  }
  const existing = await rbacPrisma.roles.findUnique({
    where: { id: BigInt(roleId) },
    include: {
      _count: { select: { user_roles: true } },
    },
  });

  if (!existing) throw Errors.notFound('Role');
  ensureRoleCanBeMutated(existing);

  if (existing._count.user_roles > 0) {
    throw Errors.conflict('Role is still assigned to users', 'ROLE_IN_USE');
  }

  await rbacPrisma.roles.delete({ where: { id: existing.id } });
}

export async function listRolePermissions(roleId: string) {
  if (!(await hasRbacTables())) {
    return [];
  }
  await getRoleById(roleId);
  const permissions = await getAllPermissions();
  const rolePermissions = await rbacPrisma.role_permissions.findMany({
    where: { role_id: BigInt(roleId) },
    select: { permission_id: true },
  });
  const assignedIds = new Set(rolePermissions.map((entry: any) => entry.permission_id.toString()));

  return permissions.map((permission: any) => ({
    ...permission,
    assigned: assignedIds.has(permission.id.toString()),
  }));
}

export async function replaceRolePermissions(roleId: string, permissionIds: string[]) {
  if (!(await hasRbacTables())) {
    throw Errors.conflict('RBAC tables are not initialized in the database', 'RBAC_NOT_INITIALIZED');
  }
  const role = await rbacPrisma.roles.findUnique({ where: { id: BigInt(roleId) } });
  if (!role) throw Errors.notFound('Role');
  ensureRoleCanBeMutated(role);

  const normalizedIds = uniqueSorted(permissionIds);
  const permissions = await rbacPrisma.permissions.findMany({
    where: { id: { in: normalizedIds.map((id) => BigInt(id)) } },
    select: { id: true },
  });

  if (permissions.length !== normalizedIds.length) {
    throw Errors.badRequest('One or more permissions do not exist', 'INVALID_PERMISSION_SET');
  }

  await rbacPrisma.$transaction([
    rbacPrisma.role_permissions.deleteMany({ where: { role_id: role.id } }),
    ...(normalizedIds.length > 0
      ? [
          rbacPrisma.role_permissions.createMany({
            data: normalizedIds.map((permissionId) => ({
              role_id: role.id,
              permission_id: BigInt(permissionId),
            })),
          }),
        ]
      : []),
  ]);

  return listRolePermissions(roleId);
}

export async function listUserRoles(userId: string) {
  if (!(await hasRbacTables())) {
    const user = await prisma.users.findUnique({
      where: { id: BigInt(userId) },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
      },
    });
    if (!user) throw Errors.notFound('User');

    return {
      user: {
        id: user.id.toString(),
        email: user.email,
        first_name: user.first_name ?? '',
        last_name: user.last_name ?? '',
      },
      roles: inferSystemRoleCodesFromLegacyRole(user.role).map((code) => ({
        id: code,
        name: code,
        code,
        description: 'Legacy role fallback',
        is_system: true,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        assigned: true,
      })),
    };
  }

  const user = await prisma.users.findUnique({
    where: { id: BigInt(userId) },
    select: {
      id: true,
      email: true,
      first_name: true,
      last_name: true,
    },
  });
  if (!user) throw Errors.notFound('User');

  const roles = await rbacPrisma.roles.findMany({
    include: {
      user_roles: {
        where: { user_id: user.id },
        select: { id: true },
      },
    },
    orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
  });

  return {
    user: {
      ...user,
      id: user.id.toString(),
    },
    roles: roles.map((role: any) => ({
      ...role,
      id: role.id.toString(),
      assigned: role.user_roles.length > 0,
    })),
  };
}

export async function replaceUserRoles(userId: string, roleIds: string[]) {
  if (!(await hasRbacTables())) {
    throw Errors.conflict('RBAC tables are not initialized in the database', 'RBAC_NOT_INITIALIZED');
  }
  const user = await prisma.users.findUnique({ where: { id: BigInt(userId) } });
  if (!user) throw Errors.notFound('User');

  const normalizedIds = uniqueSorted(roleIds);
  const roles = await rbacPrisma.roles.findMany({
    where: { id: { in: normalizedIds.map((id) => BigInt(id)) } },
    select: { id: true, is_system: true, code: true },
  });

  if (roles.length !== normalizedIds.length) {
    throw Errors.badRequest('One or more roles do not exist', 'INVALID_ROLE_ASSIGNMENT');
  }

  await rbacPrisma.$transaction([
    rbacPrisma.user_roles.deleteMany({ where: { user_id: user.id } }),
    ...(normalizedIds.length > 0
      ? [
          rbacPrisma.user_roles.createMany({
            data: normalizedIds.map((roleId) => ({
              user_id: user.id,
              role_id: BigInt(roleId),
            })),
          }),
        ]
      : []),
  ]);

  return listUserRoles(userId);
}

export async function listCurrentUserPermissions(userId: string, legacyRole?: string | null) {
  return resolveUserAuthorization(userId, legacyRole).then((snapshot) => snapshot.permissionCodes);
}

export async function listCurrentUserRoles(userId: string, legacyRole?: string | null) {
  return resolveUserAuthorization(userId, legacyRole).then((snapshot) => snapshot.roleCodes);
}

export async function seedRbacData() {
  rbacTablesAvailable = true;
  const seedPermissions = buildSeedPermissions();

  for (const permission of seedPermissions) {
    await rbacPrisma.permissions.upsert({
      where: { code: permission.code },
      update: {
        module: permission.module,
        action: permission.action,
        description: permission.description,
      },
      create: permission,
    });
  }

  const allPermissions = await rbacPrisma.permissions.findMany({ select: { id: true, code: true } });
  const permissionByCode = new Map(allPermissions.map((permission: any) => [permission.code, permission.id]));

  const roles = [
    {
      name: 'Super Admin',
      code: SYSTEM_ROLE_CODES.superAdmin,
      description: 'Full platform access',
      permissions: allPermissions.map((permission: any) => permission.id),
    },
    {
      name: 'Support',
      code: SYSTEM_ROLE_CODES.support,
      description: 'Read access and dispute handling',
      permissions: getSupportPermissionCodes().map((code) => permissionByCode.get(code)).filter(Boolean) as bigint[],
    },
    {
      name: 'Finance',
      code: SYSTEM_ROLE_CODES.finance,
      description: 'Payments, payouts, refunds and wallet operations',
      permissions: getFinancePermissionCodes().map((code) => permissionByCode.get(code)).filter(Boolean) as bigint[],
    },
  ];

  for (const roleInput of roles) {
    const role = await rbacPrisma.roles.upsert({
      where: { code: roleInput.code },
      update: {
        name: roleInput.name,
        description: roleInput.description,
        is_system: true,
      },
      create: {
        name: roleInput.name,
        code: roleInput.code,
        description: roleInput.description,
        is_system: true,
      },
    });

    await rbacPrisma.role_permissions.deleteMany({ where: { role_id: role.id } });
    if (roleInput.permissions.length > 0) {
      await rbacPrisma.role_permissions.createMany({
        data: roleInput.permissions.map((permissionId: bigint) => ({
          role_id: role.id,
          permission_id: permissionId,
        })),
        skipDuplicates: true,
      });
    }
  }
}

export function isCriticalPermission(permissionCode: string) {
  return PROTECTED_PERMISSION_CODES.includes(permissionCode as (typeof PROTECTED_PERMISSION_CODES)[number]);
}
