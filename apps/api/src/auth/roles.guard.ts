import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { RoleName } from './authorization';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const role = context.switchToHttp().getRequest<{ user?: { role?: string } }>().user?.role;
    if (role === 'SUPER_ADMIN' || (role && roles.includes(role as RoleName))) return true;
    throw new ForbiddenException('You do not have the required role');
  }
}
