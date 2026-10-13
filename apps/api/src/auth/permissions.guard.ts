import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, hasPermission } from './authorization';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const permissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!permissions?.length) return true;
    const role = context.switchToHttp().getRequest<{ user?: { role?: string } }>().user?.role;
    if (role && permissions.every((permission) => hasPermission(role, permission))) return true;
    throw new ForbiddenException('You do not have the required permission');
  }
}
