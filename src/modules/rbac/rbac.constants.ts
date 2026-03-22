export const CRUD_MODULES = [
  'users',
  'roles',
  'permissions',
  'trips',
  'bookings',
  'deliveries',
  'disputes',
  'wallet',
  'payouts',
  'refunds',
  'payments',
  'reports',
] as const;

export const CRUD_ACTIONS = ['create', 'read', 'update', 'delete'] as const;

export const EXTRA_PERMISSIONS = [
  { module: 'disputes', action: 'resolve', code: 'disputes.resolve', description: 'Resolve disputes' },
  { module: 'payouts', action: 'execute', code: 'payouts.execute', description: 'Execute payout batches and payouts' },
  { module: 'wallet', action: 'adjust', code: 'wallet.adjust', description: 'Adjust wallet balances manually' },
  { module: 'refunds', action: 'approve', code: 'refunds.approve', description: 'Approve or force refunds' },
  { module: 'users', action: 'ban', code: 'users.ban', description: 'Ban or unban users' },
] as const;

export const SYSTEM_ROLE_CODES = {
  superAdmin: 'super_admin',
  support: 'support',
  finance: 'finance',
} as const;

export const PROTECTED_PERMISSION_CODES = [
  'payouts.execute',
  'wallet.adjust',
  'refunds.approve',
  'users.ban',
] as const;

export function buildSeedPermissions() {
  const permissions = CRUD_MODULES.flatMap((module) =>
    CRUD_ACTIONS.map((action) => ({
      module,
      action,
      code: `${module}.${action}`,
      description: `${action} ${module}`,
    })),
  );

  return [...permissions, ...EXTRA_PERMISSIONS];
}

export function getSupportPermissionCodes() {
  return [
    'users.read',
    'trips.read',
    'bookings.read',
    'deliveries.read',
    'disputes.read',
    'disputes.resolve',
    'reports.read',
    'payments.read',
    'refunds.read',
  ];
}

export function getFinancePermissionCodes() {
  return [
    'payments.read',
    'refunds.read',
    'refunds.create',
    'refunds.approve',
    'wallet.read',
    'wallet.adjust',
    'payouts.read',
    'payouts.create',
    'payouts.update',
    'payouts.execute',
    'reports.read',
  ];
}
