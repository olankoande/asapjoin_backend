import { describe, expect, test, vi } from 'vitest';
import { buildAuthorizationSnapshotFromResolvedRoles, isProtectedRole } from '../src/modules/rbac/rbac.service';
import { requirePermission } from '../src/middlewares/rbac';

describe('RBAC aggregation', () => {
  test('aggregates permissions across multiple roles', () => {
    const snapshot = buildAuthorizationSnapshotFromResolvedRoles(
      [
        { code: 'support', permissionCodes: ['users.read', 'disputes.read'] },
        { code: 'finance', permissionCodes: ['payments.read', 'wallet.adjust', 'users.read'] },
      ],
      null,
    );

    expect(snapshot.isSuperAdmin).toBe(false);
    expect(snapshot.roleCodes).toEqual(['finance', 'support']);
    expect(snapshot.permissionCodes).toEqual(['disputes.read', 'payments.read', 'users.read', 'wallet.adjust']);
  });

  test('super_admin bypass returns all available permissions', () => {
    const snapshot = buildAuthorizationSnapshotFromResolvedRoles(
      [{ code: 'support', permissionCodes: ['users.read'] }],
      'admin',
      ['users.read', 'users.update', 'payouts.execute'],
    );

    expect(snapshot.isSuperAdmin).toBe(true);
    expect(snapshot.roleCodes).toContain('super_admin');
    expect(snapshot.permissionCodes).toEqual(['payouts.execute', 'users.read', 'users.update']);
  });
});

describe('RBAC middleware', () => {
  test('requirePermission allows requests with matching permission', async () => {
    const middleware = requirePermission('users.read');
    const next = vi.fn();
    const req = {
      user: {
        userId: '1',
        role: 'support',
        email: 'support@asapjoin.ca',
        roleCodes: ['support'],
        permissionCodes: ['users.read'],
        isSuperAdmin: false,
      },
    } as any;

    await middleware(req, {} as any, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('requirePermission rejects missing permission', async () => {
    const middleware = requirePermission('wallet.adjust');
    const next = vi.fn();
    const req = {
      user: {
        userId: '1',
        role: 'support',
        email: 'support@asapjoin.ca',
        roleCodes: ['support'],
        permissionCodes: ['users.read'],
        isSuperAdmin: false,
      },
    } as any;

    await middleware(req, {} as any, next);
    const firstCallArg = next.mock.calls[0][0];
    expect(firstCallArg.code).toBe('MISSING_PERMISSION');
  });
});

describe('RBAC protected roles', () => {
  test('system roles are protected', () => {
    expect(isProtectedRole({ is_system: true })).toBe(true);
    expect(isProtectedRole({ is_system: false })).toBe(false);
  });

  test('me permissions snapshot keeps union semantics for endpoint payload', () => {
    const snapshot = buildAuthorizationSnapshotFromResolvedRoles(
      [
        { code: 'support', permissionCodes: ['users.read', 'disputes.resolve'] },
        { code: 'finance', permissionCodes: ['payments.read'] },
      ],
      null,
    );

    expect(snapshot.permissionCodes).toEqual(['disputes.resolve', 'payments.read', 'users.read']);
  });
});
