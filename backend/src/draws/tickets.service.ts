import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AgentWalletService } from '../agents/agent-wallet.service';
import { CLOCK, Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { PlayRulesService } from '../common/play-rules.service';
import { AppConfig, CONFIG } from '../config';
import { DATABASE, Database, Queryable, isUniqueViolation } from '../database/db';
import { WalletService } from '../wallet/wallet.service';
import { DrawConfig, DrawGame, InvalidTicketBetError, TicketBet, normalizeTicketBet } from './games';
import { DrawScheduler } from './scheduler.service';
import { DrawSettingsService } from './settings.service';

export interface TicketRequest {
  game: DrawGame;
  bet: TicketBet;
  stakeCents: number;
  /** Nombre de tirages consécutifs couverts, à partir du prochain encore ouvert. */
  draws: number;
  idempotencyKey: string;
}

export type EntryStatus = 'pending' | 'won' | 'lost' | 'review' | 'rejected' | 'refunded';

export interface TicketView {
  code: string;
  game: DrawGame;
  bet: TicketBet;
  stakePerDrawCents: number;
  totalStakeCents: number;
  /** En attente tant qu'un tirage reste à jouer ou à valider, gagnant dès qu'un tirage paie. */
  status: 'pending' | 'won' | 'lost' | 'refunded';
  payoutCents: number;
  createdAt: Date;
  entries: {
    drawId: number;
    scheduledAt: string;
    status: EntryStatus;
    payoutCents: number;
    balls: number[] | null;
    serverSeedHash: string;
  }[];
}

/** Ticket vendu au guichet : de quoi l'imprimer, le vérifier par son QR et le payer. */
export interface AgentTicketView extends TicketView {
  agent: { code: string; name: string };
  /** Contenu du QR code imprimé sur le ticket. */
  qrPayload: string;
  /** Liquide dû au porteur une fois tous les tirages réglés : gains, plus les mises rendues (tirage annulé, gain refusé). */
  cashoutCents: number;
  redemption: { amountCents: number; agentCode: string; redeemedAt: Date } | null;
}

type Owner = { userId: number } | { agentId: number };

/** Codes imprimables sans caractères ambigus (pas de 0, O, 1, I). */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function newTicketCode(): string {
  return [...randomBytes(10)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

type TicketRow = Omit<TicketView, 'status' | 'payoutCents' | 'entries'> & {
  agentCode: string | null;
  agentName: string | null;
  redemptionCents: number | null;
  redemptionAgentCode: string | null;
  redeemedAt: Date | null;
  entries: (TicketView['entries'][number] & { stakeCents: number })[];
};

const VIEW = `SELECT t.code, t.game, t.bet, t.stake_per_draw_cents AS "stakePerDrawCents",
         t.total_stake_cents AS "totalStakeCents", t.created_at AS "createdAt",
         a.code AS "agentCode", a.name AS "agentName",
         r.amount_cents AS "redemptionCents", ra.code AS "redemptionAgentCode", r.created_at AS "redeemedAt",
         json_agg(json_build_object(
           'drawId', d.id, 'scheduledAt', d.scheduled_at, 'status', e.status, 'payoutCents', e.payout_cents,
           'stakeCents', e.stake_cents, 'balls', d.balls, 'serverSeedHash', d.server_seed_hash) ORDER BY d.scheduled_at) AS entries
    FROM tickets t JOIN ticket_entries e ON e.ticket_id = t.id JOIN draws d ON d.id = e.draw_id
    LEFT JOIN agents a ON a.id = t.agent_id
    LEFT JOIN ticket_redemptions r ON r.ticket_id = t.id LEFT JOIN agents ra ON ra.id = r.agent_id`;
const GROUP = 'GROUP BY t.id, a.id, r.ticket_id, ra.id';

function toView(row: TicketRow): TicketView {
  const statuses = row.entries.map((e) => e.status);
  const status = statuses.some((s) => s === 'pending' || s === 'review')
    ? 'pending'
    : statuses.includes('won')
      ? 'won'
      : statuses.every((s) => s === 'refunded')
        ? 'refunded'
        : 'lost';
  const payoutCents = row.entries.filter((e) => e.status === 'won').reduce((sum, e) => sum + e.payoutCents, 0);
  return {
    code: row.code,
    game: row.game,
    bet: row.bet,
    stakePerDrawCents: row.stakePerDrawCents,
    totalStakeCents: row.totalStakeCents,
    status,
    payoutCents,
    createdAt: row.createdAt,
    entries: row.entries.map(({ stakeCents: _, ...entry }) => entry),
  };
}

@Injectable()
export class TicketsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly wallet: WalletService,
    private readonly agentWallet: AgentWalletService,
    private readonly settings: DrawSettingsService,
    private readonly scheduler: DrawScheduler,
    private readonly playRules: PlayRulesService,
  ) {}

  /** Joueur : débite toute la mise d'avance de son portefeuille et l'inscrit aux prochains tirages ouverts. */
  async buy(userId: number, req: TicketRequest): Promise<TicketView> {
    const prepared = await this.prepare(req);
    const owner = { userId };
    const replay = await this.findByKey(this.db, owner, req.idempotencyKey);
    if (replay) return toView(replay);

    const row = await this.withReplay(owner, req.idempotencyKey, () =>
      this.db.transaction(async (tx) => {
        const balance = await this.wallet.lock(tx, userId);
        const again = await this.findByKey(tx, owner, req.idempotencyKey);
        if (again) return again;
        await this.playRules.check(tx, userId, prepared.total);
        if (balance < prepared.total) throw new AppError('INSUFFICIENT_FUNDS');
        const ticketId = await this.insert(tx, owner, req, prepared, 0);
        await this.wallet.post(tx, userId, 'bet', -prepared.total, { type: 'ticket', id: ticketId });
        return (await this.findByKey(tx, owner, req.idempotencyKey))!;
      }),
    );
    return toView(row);
  }

  /**
   * Agent : vente au guichet à un client sans compte, payée en liquide. Le crédit de vente de l'agent
   * est débité de la mise ; sa commission (taux du jour de la vente) est versée au règlement de chaque tirage.
   */
  async sell(agentId: number, req: TicketRequest): Promise<AgentTicketView> {
    const prepared = await this.prepare(req);
    const owner = { agentId };
    const replay = await this.findByKey(this.db, owner, req.idempotencyKey);
    if (replay) return this.toAgentView(replay);

    const row = await this.withReplay(owner, req.idempotencyKey, () =>
      this.db.transaction(async (tx) => {
        const agent = await this.agentWallet.lockActive(tx, agentId);
        const again = await this.findByKey(tx, owner, req.idempotencyKey);
        if (again) return again;
        const ticketId = await this.insert(tx, owner, req, prepared, agent.ticketCommissionBp);
        await this.agentWallet.post(tx, agentId, 'ticket_sale', -prepared.total, { type: 'ticket', id: ticketId });
        return (await this.findByKey(tx, owner, req.idempotencyKey))!;
      }),
    );
    return this.toAgentView(row);
  }

  /**
   * Paiement au guichet d'un ticket d'agent, par n'importe quel agent actif, une seule fois.
   * Le liquide remis au porteur est rendu au crédit de vente de l'agent qui paie.
   */
  async redeem(agentId: number, code: string): Promise<AgentTicketView> {
    try {
      await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<TicketRow & { id: number }>(
          `${VIEW.replace('SELECT t.code', 'SELECT t.id, t.code')} WHERE t.code = $1 AND t.agent_id IS NOT NULL ${GROUP}`,
          [code.toUpperCase()],
        );
        const ticket = rows[0];
        if (!ticket) throw new AppError('TICKET_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (ticket.redeemedAt) throw new AppError('TICKET_ALREADY_PAID', HttpStatus.CONFLICT);
        if (ticket.entries.some((e) => e.status === 'pending' || e.status === 'review')) {
          throw new AppError('TICKET_NOT_SETTLED', HttpStatus.CONFLICT);
        }
        const amount = cashout(ticket);
        if (amount === 0) throw new AppError('TICKET_NOT_WINNING', HttpStatus.CONFLICT);

        await this.agentWallet.lockActive(tx, agentId);
        await tx.query('INSERT INTO ticket_redemptions (ticket_id, agent_id, amount_cents) VALUES ($1, $2, $3)', [
          ticket.id,
          agentId,
          amount,
        ]);
        await this.agentWallet.post(tx, agentId, 'ticket_payout', amount, { type: 'ticket', id: ticket.id });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('TICKET_ALREADY_PAID', HttpStatus.CONFLICT);
      throw error;
    }
    return this.agentTicket(code);
  }

  /** Ticket d'agent par son code : vérification au guichet ou par le porteur en scannant le QR. */
  async agentTicket(code: string): Promise<AgentTicketView> {
    const { rows } = await this.db.query<TicketRow>(`${VIEW} WHERE t.code = $1 AND t.agent_id IS NOT NULL ${GROUP}`, [
      code.toUpperCase(),
    ]);
    if (!rows[0]) throw new AppError('TICKET_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.toAgentView(rows[0]);
  }

  async agentSales(agentId: number, limit: number): Promise<AgentTicketView[]> {
    const { rows } = await this.db.query<TicketRow>(`${VIEW} WHERE t.agent_id = $1 ${GROUP} ORDER BY t.id DESC LIMIT $2`, [
      agentId,
      limit,
    ]);
    return rows.map((row) => this.toAgentView(row));
  }

  async list(userId: number, game: DrawGame | undefined, limit: number): Promise<TicketView[]> {
    const { rows } = await this.db.query<TicketRow>(
      `${VIEW} WHERE t.user_id = $1 AND ($2::text IS NULL OR t.game = $2) ${GROUP} ORDER BY t.id DESC LIMIT $3`,
      [userId, game ?? null, limit],
    );
    return rows.map(toView);
  }

  async byCode(userId: number, code: string): Promise<TicketView> {
    const { rows } = await this.db.query<TicketRow>(`${VIEW} WHERE t.user_id = $1 AND t.code = $2 ${GROUP}`, [
      userId,
      code.toUpperCase(),
    ]);
    if (!rows[0]) throw new AppError('TICKET_NOT_FOUND', HttpStatus.NOT_FOUND);
    return toView(rows[0]);
  }

  /** Pari, mise et nombre de tirages vérifiés avec les paramètres du jour. */
  private async prepare(req: TicketRequest): Promise<{ version: number; config: DrawConfig; bet: TicketBet; total: number }> {
    const { version, config } = await this.settings.current(req.game);
    let bet: TicketBet;
    try {
      bet = normalizeTicketBet(req.game, req.bet, config);
    } catch (error) {
      if (error instanceof InvalidTicketBetError) throw new AppError('INVALID_BET', HttpStatus.BAD_REQUEST, { type: error.message });
      throw error;
    }
    if (req.stakeCents < config.minStakeCents || req.stakeCents > config.maxStakeCents) {
      throw new AppError('STAKE_OUT_OF_RANGE', HttpStatus.BAD_REQUEST, {
        minStakeCents: config.minStakeCents,
        maxStakeCents: config.maxStakeCents,
      });
    }
    if (req.draws < 1 || req.draws > config.maxDrawsPerTicket) {
      throw new AppError('INVALID_DRAW_COUNT', HttpStatus.BAD_REQUEST, { maxDrawsPerTicket: config.maxDrawsPerTicket });
    }
    await this.scheduler.ensureUpcoming(req.game);
    return { version, config, bet, total: req.stakeCents * req.draws };
  }

  /** Inscrit le ticket aux prochains tirages ouverts ; FOR SHARE empêche de les tirer pendant l'inscription. */
  private async insert(
    tx: Queryable,
    owner: Owner,
    req: TicketRequest,
    prepared: { version: number; bet: TicketBet; total: number },
    commissionBp: number,
  ): Promise<number> {
    const { rows: draws } = await tx.query<{ id: number }>(
      `SELECT id FROM draws WHERE game = $1 AND status = 'scheduled' AND closes_at > $2
        ORDER BY scheduled_at LIMIT $3 FOR SHARE`,
      [req.game, this.clock.now(), req.draws],
    );
    if (draws.length < req.draws) throw new AppError('DRAWS_NOT_AVAILABLE', HttpStatus.CONFLICT);

    const userId = 'userId' in owner ? owner.userId : null;
    const agentId = 'agentId' in owner ? owner.agentId : null;
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO tickets (code, user_id, agent_id, game, idempotency_key, bet, stake_per_draw_cents, total_stake_cents,
                            settings_version, commission_bp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [newTicketCode(), userId, agentId, req.game, req.idempotencyKey, JSON.stringify(prepared.bet), req.stakeCents,
        prepared.total, prepared.version, commissionBp],
    );
    for (const draw of draws) {
      await tx.query(
        'INSERT INTO ticket_entries (ticket_id, draw_id, user_id, agent_id, stake_cents) VALUES ($1, $2, $3, $4, $5)',
        [rows[0].id, draw.id, userId, agentId, req.stakeCents],
      );
    }
    return rows[0].id;
  }

  /** Même clé envoyée deux fois en parallèle : la seconde renvoie le ticket de la première. */
  private async withReplay(owner: Owner, key: string, run: () => Promise<TicketRow>): Promise<TicketRow> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findByKey(this.db, owner, key);
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async findByKey(q: Queryable, owner: Owner, key: string): Promise<TicketRow | undefined> {
    const [column, id] = 'userId' in owner ? ['user_id', owner.userId] : ['agent_id', owner.agentId];
    const { rows } = await q.query<TicketRow>(`${VIEW} WHERE t.${column} = $1 AND t.idempotency_key = $2 ${GROUP}`, [id, key]);
    return rows[0];
  }

  private toAgentView(row: TicketRow): AgentTicketView {
    return {
      ...toView(row),
      agent: { code: row.agentCode!, name: row.agentName! },
      qrPayload: `${this.config.ticketQrBaseUrl}${row.code}`,
      cashoutCents: cashout(row),
      redemption:
        row.redeemedAt === null
          ? null
          : { amountCents: row.redemptionCents!, agentCode: row.redemptionAgentCode!, redeemedAt: row.redeemedAt },
    };
  }
}

/** Gains des tirages gagnants plus mises rendues (tirage annulé, gros gain refusé). */
function cashout(row: TicketRow): number {
  return row.entries.reduce((sum, e) => {
    if (e.status === 'won') return sum + e.payoutCents;
    if (e.status === 'refunded' || e.status === 'rejected') return sum + e.stakeCents;
    return sum;
  }, 0);
}
