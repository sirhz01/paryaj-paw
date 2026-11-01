import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AppConfig, CONFIG } from '../config';
import { AppError } from './errors';

export type StaffRole = 'super_admin' | 'finance' | 'support' | 'auditor';
export const STAFF_ROLES: StaffRole[] = ['super_admin', 'finance', 'support', 'auditor'];

export interface PlayerPrincipal {
  id: number;
}

export interface StaffPrincipal {
  id: number;
  role: StaffRole;
}

export interface AgentPrincipal {
  id: number;
}

interface AuthedRequest extends Request {
  player?: PlayerPrincipal;
  staff?: StaffPrincipal;
  agent?: AgentPrincipal;
}

function bearerToken(req: Request): string {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
  return token;
}

@Injectable()
export class PlayerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    let payload: { sub: string; typ: string };
    try {
      payload = this.jwt.verify(token, { secret: this.config.jwtSecret });
    } catch {
      throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
    if (payload.typ !== 'player') throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    req.player = { id: Number(payload.sub) };
    return true;
  }
}

const ROLES_KEY = 'staffRoles';

/** Rôles autorisés sur une route du back-office ; sans décorateur, tout membre du staff passe. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    let payload: { sub: string; typ: string; role: StaffRole };
    try {
      payload = this.jwt.verify(token, { secret: this.config.staffJwtSecret });
    } catch {
      throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
    if (payload.typ !== 'staff') throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);

    const allowed = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (allowed && !allowed.includes(payload.role)) throw new AppError('FORBIDDEN', HttpStatus.FORBIDDEN);

    req.staff = { id: Number(payload.sub), role: payload.role };
    return true;
  }
}

/** Agent de point de vente ; son statut (bloqué ou non) est revérifié à chaque opération d'argent. */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    let payload: { sub: string; typ: string };
    try {
      payload = this.jwt.verify(token, { secret: this.config.agentJwtSecret });
    } catch {
      throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
    if (payload.typ !== 'agent') throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    req.agent = { id: Number(payload.sub) };
    return true;
  }
}

export const CurrentPlayer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlayerPrincipal => ctx.switchToHttp().getRequest<AuthedRequest>().player!,
);

export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StaffPrincipal => ctx.switchToHttp().getRequest<AuthedRequest>().staff!,
);

export const CurrentAgent = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AgentPrincipal => ctx.switchToHttp().getRequest<AuthedRequest>().agent!,
);
