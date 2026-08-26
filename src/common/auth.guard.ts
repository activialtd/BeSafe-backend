import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ApiError } from './api-error';
import type { AppEnv } from '@/config/env';

export interface AuthUser {
  id: string;
  role: 'rider' | 'driver' | 'admin' | 'gov';
  phone: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AuthUser['role'][]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) {
      throw new ApiError({ code: 'UNAUTHENTICATED', message: 'Not authenticated' });
    }
    return req.user;
  },
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new ApiError({ code: 'UNAUTHENTICATED', message: 'Missing bearer token' });
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: AuthUser['role']; phone: string }>(
        token,
        { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }) },
      );
      req.user = { id: payload.sub, role: payload.role, phone: payload.phone };
    } catch {
      throw new ApiError({ code: 'UNAUTHENTICATED', message: 'Invalid or expired token' });
    }

    // Role check
    const allowedRoles = this.reflector.getAllAndOverride<AuthUser['role'][] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (allowedRoles && allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      throw new ApiError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }
    return true;
  }
}
