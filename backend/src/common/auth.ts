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
import { DATABASE, Database } from '../database/db';
import { AppError } from './errors';

export type StaffRole = 'super_admin' | 'finance' | 'support' | 'auditor' | 'cashier';
export const STAFF_ROLES: StaffRole[] = ['super_admin', 'finance', 'support', 'auditor', 'cashier'];

export interface PlayerPrincipal {
  id: number;
}

export interface StaffPrincipal {
  id: number;
  role: StaffRole;
  /** Caisse à laquelle le compte est lié (caissier) ; null : aucune restriction. */
  terminal: string | null;
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
      payload = this.jwt.verify(token, { secret: this.config.jwtSecret, algorithms: ['HS256'] });
    } catch {
      throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
    if (payload.typ !== 'player') throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    req.player = { id: Number(payload.sub) };
    return true;
  }
}

const ROLES_KEY = 'staffRoles';

/** Rôles autorisés sur une route du back-office ; sans décorateur, tout le staff passe sauf le caissier. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

/** Un compte désactivé ou une session révoquée perd son accès au plus tard après ce délai. */
const STAFF_STATUS_TTL_MS = 10_000;

@Injectable()
export class StaffGuard implements CanActivate {
  private readonly status = new Map<number, { at: number; active: boolean; version: number; terminal: string | null }>();

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** État actuel du compte (actif, version des sessions, caisse), gardé quelques secondes en mémoire. */
  private async accountOf(id: number) {
    const cached = this.status.get(id);
    if (cached && Date.now() - cached.at < STAFF_STATUS_TTL_MS) return cached;
    const { rows } = await this.db.query<{ active: boolean; token_version: number; terminal: string | null }>(
      'SELECT active, token_version, terminal FROM staff WHERE id = $1',
      [id],
    );
    const entry = { at: Date.now(), active: rows[0]?.active === true, version: rows[0]?.token_version ?? -1, terminal: rows[0]?.terminal ?? null };
    this.status.set(id, entry);
    return entry;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    let payload: { sub: string; typ: string; role: StaffRole; tv?: number };
    try {
      payload = this.jwt.verify(token, { secret: this.config.staffJwtSecret, algorithms: ['HS256'] });
    } catch {
      throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
    if (payload.typ !== 'staff') throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    const account = await this.accountOf(Number(payload.sub));
    if (!account.active || payload.tv !== account.version) throw new AppError('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);

    const allowed = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (allowed ? !allowed.includes(payload.role) : payload.role === 'cashier') throw new AppError('FORBIDDEN', HttpStatus.FORBIDDEN);

    req.staff = { id: Number(payload.sub), role: payload.role, terminal: account.terminal };
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
      payload = this.jwt.verify(token, { secret: this.config.agentJwtSecret, algorithms: ['HS256'] });
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
