import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { SQL_HAITI_DAY_START } from '../common/haiti';
import { DATABASE, Database, Queryable, isUniqueViolation } from '../database/db';
import { WalletService } from '../wallet/wallet.service';
import { payoutCents } from './paytable';
import { GRID_SIZE, countHits, drawNumbers } from './provably-fair';
import { SeedsService } from './seeds.service';
import { KenoSettingsService } from './settings.service';

export interface BetRequest {
  picks: number[];
  stakeCents: number;
  /** Généré par le client ; renvoyer la même clé après une coupure rend la même mise, jamais une deuxième. */
  idempotencyKey: string;
}

export interface BetResult {
  betId: number;
  picks: number[];
  drawn: number[];
  hits: number;
  stakeCents: number;
  multiplier: number;
  payoutCents: number;
  balanceCents: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  createdAt: Date;
}

export interface AutoplayRequest {
  picks: number[];
  stakeCents: number;
  rounds: number;
  /** Arrêt quand le gain net de la série atteint ce montant. */
  stopOnProfitCents?: number;
  /** Arrêt quand la perte nette de la série atteint ce montant. */
  stopOnLossCents?: number;
  idempotencyKey: string;
}

export interface AutoplayResult {
  bets: BetResult[];
  netCents: number;
  stoppedBy: 'rounds' | 'profit' | 'loss' | string;
}

const BET_COLUMNS = `b.id AS "betId", b.picks, b.drawn, b.hits, b.stake_cents AS "stakeCents",
  b.multiplier::float8 AS multiplier, b.payout_cents AS "payoutCents", s.server_seed_hash AS "serverSeedHash",
  s.client_seed AS "clientSeed", b.nonce, b.created_at AS "createdAt"`;

@Injectable()
export class KenoService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly seeds: SeedsService,
    private readonly settings: KenoSettingsService,
  ) {}

  /**
   * Débit, tirage, gain et journal dans une seule transaction,
   * sous le verrou du portefeuille : les mises d'un joueur passent une par une.
   */
  async placeBet(userId: number, req: BetRequest): Promise<BetResult> {
    const settings = await this.settings.current();
    const picks = this.checkPicks(req.picks, settings.maxPicks);
    if (req.stakeCents < settings.minStakeCents || req.stakeCents > settings.maxStakeCents) {
      throw new AppError('STAKE_OUT_OF_RANGE', HttpStatus.BAD_REQUEST, {
        minStakeCents: settings.minStakeCents,
        maxStakeCents: settings.maxStakeCents,
      });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const balance = await this.wallet.lock(tx, userId);
        const replay = await this.findByKey(tx, userId, req.idempotencyKey);
        if (replay) return replay;

        await this.checkCanPlay(tx, userId, req.stakeCents);
        if (balance < req.stakeCents) throw new AppError('INSUFFICIENT_FUNDS');

        const seed = await this.seeds.takeNonce(tx, userId);
        const drawn = drawNumbers(seed.serverSeed, seed.clientSeed, seed.nonce);
        const hits = countHits(picks, drawn);
        const multiplier = settings.paytable[String(picks.length)][hits];
        const payout = payoutCents(req.stakeCents, multiplier, settings.maxPayoutCents);

        const { rows } = await tx.query<{ id: number; created_at: Date }>(
          `INSERT INTO keno_bets (user_id, idempotency_key, seed_id, nonce, picks, drawn, hits,
                                  stake_cents, multiplier, payout_cents, settings_version)
           VALUES ($1, $2, $3, $4, $5::smallint[], $6::smallint[], $7, $8, $9, $10, $11)
           RETURNING id, created_at`,
          [userId, req.idempotencyKey, seed.id, seed.nonce, picks, drawn, hits, req.stakeCents, multiplier, payout, settings.version],
        );
        const betId = rows[0].id;
        const ref = { type: 'keno_bet', id: betId };
        let balanceCents = await this.wallet.post(tx, userId, 'bet', -req.stakeCents, ref);
        if (payout > 0) balanceCents = await this.wallet.post(tx, userId, 'win', payout, ref);

        return {
          betId,
          picks,
          drawn,
          hits,
          stakeCents: req.stakeCents,
          multiplier,
          payoutCents: payout,
          balanceCents,
          serverSeedHash: seed.serverSeedHash,
          clientSeed: seed.clientSeed,
          nonce: seed.nonce,
          createdAt: rows[0].created_at,
        };
      });
    } catch (error) {
      // Même clé envoyée deux fois en parallèle : la seconde renvoie la mise de la première.
      if (isUniqueViolation(error)) {
        const replay = await this.findByKey(this.db, userId, req.idempotencyKey);
        if (replay) return replay;
      }
      throw error;
    }
  }

  /** Mode automatique : mises successives, chacune dans sa propre transaction. */
  async autoplay(userId: number, req: AutoplayRequest): Promise<AutoplayResult> {
    const bets: BetResult[] = [];
    let netCents = 0;
    for (let round = 0; round < req.rounds; round++) {
      try {
        const bet = await this.placeBet(userId, {
          picks: req.picks,
          stakeCents: req.stakeCents,
          idempotencyKey: `${req.idempotencyKey}:${round}`,
        });
        bets.push(bet);
        netCents += bet.payoutCents - bet.stakeCents;
      } catch (error) {
        // Une mise refusée en cours de série (solde, limite…) arrête la série sans annuler les précédentes.
        if (bets.length > 0 && error instanceof AppError) return { bets, netCents, stoppedBy: error.code };
        throw error;
      }
      if (req.stopOnProfitCents !== undefined && netCents >= req.stopOnProfitCents) {
        return { bets, netCents, stoppedBy: 'profit' };
      }
      if (req.stopOnLossCents !== undefined && -netCents >= req.stopOnLossCents) {
        return { bets, netCents, stoppedBy: 'loss' };
      }
    }
    return { bets, netCents, stoppedBy: 'rounds' };
  }

  async recentBets(userId: number, limit: number): Promise<Omit<BetResult, 'balanceCents'>[]> {
    const { rows } = await this.db.query<Omit<BetResult, 'balanceCents'>>(
      `SELECT ${BET_COLUMNS} FROM keno_bets b JOIN keno_seeds s ON s.id = b.seed_id
        WHERE b.user_id = $1 ORDER BY b.id DESC LIMIT $2`,
      [userId, limit],
    );
    return rows;
  }

  /** Fréquence de chaque numéro sur les `limit` derniers tirages du joueur, avec les 10 plus et moins sortis. */
  async stats(userId: number, limit: number) {
    const { rows } = await this.db.query<{ drawn: number[] }>(
      'SELECT drawn FROM keno_bets WHERE user_id = $1 ORDER BY id DESC LIMIT $2',
      [userId, limit],
    );
    const counts = Array.from({ length: GRID_SIZE }, (_, i) => ({ number: i + 1, count: 0 }));
    for (const row of rows) for (const n of row.drawn) counts[n - 1].count++;
    const byCount = [...counts].sort((a, b) => b.count - a.count || a.number - b.number);
    return {
      draws: rows.length,
      frequencies: counts,
      hot: byCount.slice(0, 10).map((c) => c.number),
      cold: byCount.slice(-10).reverse().map((c) => c.number),
    };
  }

  private async findByKey(q: Queryable, userId: number, key: string): Promise<BetResult | undefined> {
    const { rows } = await q.query<BetResult>(
      `SELECT ${BET_COLUMNS},
              (SELECT l.balance_after_cents FROM ledger_entries l
                WHERE l.ref_type = 'keno_bet' AND l.ref_id = b.id::text ORDER BY l.id DESC LIMIT 1) AS "balanceCents"
         FROM keno_bets b JOIN keno_seeds s ON s.id = b.seed_id
        WHERE b.user_id = $1 AND b.idempotency_key = $2`,
      [userId, key],
    );
    return rows[0];
  }

  private checkPicks(picks: number[], maxPicks: number): number[] {
    const valid =
      picks.length >= 1 &&
      picks.length <= maxPicks &&
      picks.every((n) => Number.isInteger(n) && n >= 1 && n <= GRID_SIZE) &&
      new Set(picks).size === picks.length;
    if (!valid) throw new AppError('INVALID_PICKS', HttpStatus.BAD_REQUEST, { maxPicks });
    return [...picks].sort((a, b) => a - b);
  }

  /** Compte bloqué, auto-exclusion et limite de perte du jour (la mise compte comme perte possible). */
  private async checkCanPlay(tx: Queryable, userId: number, stakeCents: number): Promise<void> {
    const { rows } = await tx.query<{ status: string; excluded: boolean; limit: number | null; lost_today: number }>(
      `SELECT u.status,
              COALESCE(u.self_excluded_until > now(), false) AS excluded,
              u.daily_loss_limit_cents AS "limit",
              (SELECT COALESCE(SUM(stake_cents - payout_cents), 0)::bigint FROM keno_bets
                WHERE user_id = u.id AND created_at >= ${SQL_HAITI_DAY_START}) AS lost_today
         FROM users u WHERE u.id = $1`,
      [userId],
    );
    const user = rows[0];
    if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED', HttpStatus.FORBIDDEN);
    if (user.excluded) throw new AppError('SELF_EXCLUDED', HttpStatus.FORBIDDEN);
    if (user.limit !== null && user.lost_today + stakeCents > user.limit) {
      throw new AppError('LOSS_LIMIT_REACHED', HttpStatus.FORBIDDEN, { dailyLossLimitCents: user.limit });
    }
  }
}
