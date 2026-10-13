export const ROLES = ['MEMBER', 'GROUP_MANAGER', 'TREASURER', 'AUDITOR', 'LOAN_OFFICER', 'ADMIN', 'SUPER_ADMIN'] as const;
export type RoleName = (typeof ROLES)[number];

export const PERMISSIONS = [
  'financial:read',
  'financial:write',
  'loans:manage',
  'loans:read',
  'administrators:manage',
  'settings:manage',
  'users:read',
  'users:manage',
  'users:delete',
  'groups:read',
  'groups:manage',
  'members:read',
  'members:manage',
  'meetings:read',
  'meetings:manage',
  'notifications:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const rolePermissions: Record<RoleName, readonly Permission[]> = {
  MEMBER: ['groups:read', 'members:read', 'financial:read', 'financial:write', 'loans:read', 'meetings:read', 'notifications:read'],
  GROUP_MANAGER: ['groups:read', 'groups:manage', 'members:read', 'members:manage', 'financial:read', 'financial:write', 'loans:read', 'loans:manage', 'meetings:read', 'meetings:manage', 'notifications:read'],
  TREASURER: ['financial:read', 'financial:write', 'loans:read', 'loans:manage', 'notifications:read'],
  AUDITOR: ['financial:read', 'notifications:read'],
  LOAN_OFFICER: ['loans:read', 'loans:manage', 'notifications:read'],
  ADMIN: ['users:read', 'users:manage', 'groups:read', 'groups:manage', 'members:read', 'members:manage', 'financial:read', 'financial:write', 'loans:read', 'loans:manage', 'meetings:read', 'meetings:manage', 'notifications:read'],
  SUPER_ADMIN: PERMISSIONS,
};

export function hasPermission(role: string, permission: Permission) {
  return role === 'SUPER_ADMIN' || (rolePermissions[role as RoleName] ?? []).includes(permission);
}

export function permissionsFor(role: string): readonly Permission[] {
  return role === 'SUPER_ADMIN' ? PERMISSIONS : rolePermissions[role as RoleName] ?? [];
}
