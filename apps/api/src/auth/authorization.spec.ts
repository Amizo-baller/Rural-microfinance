/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { hasPermission, PERMISSIONS, RoleName } from './authorization';
import { PermissionsGuard } from './permissions.guard';
import { Permissions } from './permissions.decorator';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

describe('authorization policy', () => {
  const expected: Record<RoleName, readonly string[]> = {
    MEMBER: ['groups:read', 'members:read', 'financial:read', 'financial:write', 'loans:read', 'meetings:read', 'notifications:read'],
    GROUP_MANAGER: ['groups:read', 'groups:manage', 'members:read', 'members:manage', 'financial:read', 'financial:write', 'loans:read', 'loans:manage', 'loans:execute', 'meetings:read', 'meetings:manage', 'notifications:read'],
    TREASURER: ['financial:read', 'financial:write', 'loans:read', 'loans:execute', 'withdrawals:review', 'notifications:read'],
    AUDITOR: ['financial:read', 'notifications:read'],
    LOAN_OFFICER: ['loans:read', 'loans:manage', 'loans:execute', 'notifications:read'],
    ADMIN: ['users:read', 'users:manage', 'groups:read', 'groups:manage', 'members:read', 'members:manage', 'financial:read', 'financial:write', 'loans:read', 'loans:manage', 'loans:execute', 'meetings:read', 'meetings:manage', 'notifications:read', 'settings:manage', 'audit:read', 'withdrawals:manage', 'withdrawals:review', 'cycles:manage'],
    SUPER_ADMIN: PERMISSIONS,
  };

  it.each(Object.entries(expected))('%s has only its assigned permissions', (role, allowed) => {
    for (const permission of PERMISSIONS) expect(hasPermission(role, permission)).toBe(allowed.includes(permission));
  });

  it('prevents members and treasurers from managing system administrators', () => {
    expect(hasPermission('MEMBER', 'administrators:manage')).toBe(false);
    expect(hasPermission('TREASURER', 'administrators:manage')).toBe(false);
  });

  it('prevents auditors from modifying financial records', () => {
    expect(hasPermission('AUDITOR', 'financial:read')).toBe(true);
    expect(hasPermission('AUDITOR', 'financial:write')).toBe(false);
  });

  it('prevents loan officers from changing system settings', () => {
    expect(hasPermission('LOAN_OFFICER', 'loans:manage')).toBe(true);
    expect(hasPermission('LOAN_OFFICER', 'settings:manage')).toBe(false);
  });

  it('gives super administrators all system permissions', () => {
    for (const permission of PERMISSIONS) expect(hasPermission('SUPER_ADMIN', permission)).toBe(true);
  });

  it('enforces permission metadata through PermissionsGuard', () => {
    class FinancialController { update() {} }
    const descriptor = Object.getOwnPropertyDescriptor(FinancialController.prototype, 'update')!;
    Permissions('financial:write')(FinancialController.prototype, 'update', descriptor);
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['financial:write']) } as any;
    const guard = new PermissionsGuard(reflector);
    const request = { user: { role: 'AUDITOR' } };
    const context = { getHandler: () => FinancialController.prototype.update, getClass: () => FinancialController, switchToHttp: () => ({ getRequest: () => request }) } as any;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    request.user.role = 'TREASURER';
    expect(guard.canActivate(context)).toBe(true);
  });

  it('stores role metadata through the Roles decorator', () => {
    class AdminController { manage() {} }
    const descriptor = Object.getOwnPropertyDescriptor(AdminController.prototype, 'manage')!;
    Roles('SUPER_ADMIN')(AdminController.prototype, 'manage', descriptor);
    expect(Reflect.getMetadata('roles', AdminController.prototype.manage)).toEqual(['SUPER_ADMIN']);
  });

  it('enforces administrator endpoints through RolesGuard', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN']) } as any;
    const guard = new RolesGuard(reflector);
    const request = { user: { role: 'TREASURER' } };
    const context = { getHandler: jest.fn(), getClass: jest.fn(), switchToHttp: () => ({ getRequest: () => request }) } as any;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    request.user.role = 'SUPER_ADMIN';
    expect(guard.canActivate(context)).toBe(true);
  });

  it.each([
    ['MEMBER', 'administrators:manage', false],
    ['TREASURER', 'administrators:manage', false],
    ['AUDITOR', 'financial:write', false],
    ['LOAN_OFFICER', 'settings:manage', false],
    ['ADMIN', 'users:manage', true],
    ['MEMBER', 'groups:read', true],
    ['GROUP_MANAGER', 'groups:manage', true],
    ['GROUP_MANAGER', 'members:manage', true],
    ['MEMBER', 'members:read', true],
    ['TREASURER', 'groups:manage', false],
    ['ADMIN', 'users:delete', false],
    ['SUPER_ADMIN', 'settings:manage', true],
  ] as const)('%s %s access is %s at a protected route', (role, permission, allowed) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([permission]) } as any;
    const guard = new PermissionsGuard(reflector);
    const context = { getHandler: jest.fn(), getClass: jest.fn(), switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) } as any;
    if (allowed) expect(guard.canActivate(context)).toBe(true);
    else expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
