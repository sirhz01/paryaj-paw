import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { PlayRulesService } from '../common/play-rules.service';
import { DATABASE, Database, Queryable, isUniqueViolation } from '../database/db';
import { SeedsService } from '../fairness/seeds.service';
import { WalletService } from '../wallet/wallet.service';
import { Game } from '../fairness/provably-fair';
import {
  Bet,
  BetRequest,
  DOUBLE_ZERO,
  InvalidBetError,
  Variant,
  betReturn,
  colorOf,
  coversAllPockets,
  normalizeBets,
  pocketCount,
  pocketLabel,
  spinNumber,
} from './rules';
import { RouletteSettingsService } from './settings.service';

export interface SpinRequest {
  bets: BetRequest[];
  /** Généré par le client ; renvoyer la même clé après une coupure rend le même tour, jamais un deuxième. */
  idempotencyKey: string;
}

export interface SettledBet extends Bet {
  returnCents: number;
}

export interface SpinResult {
  spinId: number;
  variant: Variant;
  /** 0 à 36, et 37 pour le 00 de la roulette américaine. */
  number: number;
  /** « 00 » pour la case 37. */
  label: string;
  color: 'green' | 'red' | 'black';
  bets: SettledBet[];
  totalStakeCents: number;
  totalPayoutCents: number;
  netCents: number;
  /** Vrai si le plafond de gain par tour a réduit le paiement. */
  capped: boolean;
  balanceCents: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  createdAt: Date;
}

export interface AutoplayRequest extends SpinRequest {
  rounds: number;
  stopOnProfitCents?: number;
  stopOnLossCents?: number;
}

type SpinRow = Omit<SpinResult, 'label' | 'color' | 'netCents' | 'capped' | 'balanceCents'> & { balanceCents?: number };

const SEED_GAME: Record<Variant, Game> = { european: 'roulette', american: 'american_roulette' };

const SPIN_COLUMNS = `r.id AS "spinId", r.variant, r.number, r.bets, r.total_stake_cents AS "totalStakeCents",
  r.total_payout_cents AS "totalPayoutCents", s.server_seed_hash AS "serverSeedHash",
  s.client_seed AS "clientSeed", r.nonce, r.created_at AS "createdAt"`;

function toResult(row: SpinRow, balanceCents: number): SpinResult {
  const gross = row.bets.reduce((sum, b) => sum + b.returnCents, 0);
  return {
    ...row,
    label: pocketLabel(row.number),
    color: colorOf(row.number),
    netCents: row.totalPayoutCents - row.totalStakeCents,
    capped: gross > row.totalPayoutCents,
    balanceCents,
  };
}

@Injectable()
export class RouletteService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly seeds: SeedsService,
    private readonly settings: RouletteSettingsService,
    private readonly playRules: PlayRulesService,
  ) {}

  /** Débit de toutes les mises, tirage, gains et journal dans une seule transaction, sous verrou du portefeuille. */
  async spin(userId: number, variant: Variant, req: SpinRequest): Promise<SpinResult> {
    const settings = await this.settings.current(variant);
    let bets: Bet[];
    try {
      bets = normalizeBets(req.bets, variant);
    } catch (error) {
      if (error instanceof InvalidBetError) throw new AppError('INVALID_BET', HttpStatus.BAD_REQUEST, { type: error.message });
      throw error;
    }
    for (const bet of bets) {
      if (bet.type === 'top_line' && !settings.topLineEnabled) {
        throw new AppError('BET_NOT_AVAILABLE', HttpStatus.BAD_REQUEST, { type: bet.type });
      }
      const limit = settings.betLimits[bet.type]!;
      if (bet.amountCents < limit.minCents || bet.amountCents > limit.maxCents) {
        throw new AppError('BET_OUT_OF_RANGE', HttpStatus.BAD_REQUEST, { type: bet.type, numbers: bet.numbers, ...limit });
      }
    }
    const totalStake = bets.reduce((sum, b) => sum + b.amountCents, 0);
    if (totalStake > settings.maxTotalStakeCents) {
      throw new AppError('TOTAL_STAKE_TOO_HIGH', HttpStatus.BAD_REQUEST, { maxTotalStakeCents: settings.maxTotalStakeCents });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const balance = await this.wallet.lock(tx, userId);
        const replay = await this.findByKey(tx, userId, variant, req.idempotencyKey);
        if (replay) return replay;

        await this.playRules.check(tx, userId, totalStake);
        if (balance < totalStake) throw new AppError('INSUFFICIENT_FUNDS');

        const seed = await this.seeds.takeNonce(tx, userId, SEED_GAME[variant]);
        const number = spinNumber(seed.serverSeed, seed.clientSeed, seed.nonce, variant);
        const settled: SettledBet[] = bets.map((b) => ({ ...b, returnCents: betReturn(b, number, settings.laPartage) }));
        const gross = settled.reduce((sum, b) => sum + b.returnCents, 0);
        const payout = Math.min(gross, settings.maxPayoutCents);

        const { rows } = await tx.query<{ id: number; created_at: Date }>(
          `INSERT INTO roulette_spins (user_id, variant, idempotency_key, seed_id, nonce, number, bets,
                                       total_stake_cents, total_payout_cents, covers_all, settings_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, created_at`,
          [
            userId,
            variant,
            req.idempotencyKey,
            seed.id,
            seed.nonce,
            number,
            JSON.stringify(settled),
            totalStake,
            payout,
            coversAllPockets(bets, variant),
            settings.version,
          ],
        );
        const ref = { type: 'roulette_spin', id: rows[0].id };
        let balanceCents = await this.wallet.post(tx, userId, 'bet', -totalStake, ref);
        if (payout > 0) balanceCents = await this.wallet.post(tx, userId, 'win', payout, ref);

        return toResult(
          {
            spinId: rows[0].id,
            variant,
            number,
            bets: settled,
            totalStakeCents: totalStake,
            totalPayoutCents: payout,
            serverSeedHash: seed.serverSeedHash,
            clientSeed: seed.clientSeed,
            nonce: seed.nonce,
            createdAt: rows[0].created_at,
          },
          balanceCents,
        );
      });
    } catch (error) {
      // Même clé envoyée deux fois en parallèle : la seconde renvoie le tour de la première.
      if (isUniqueViolation(error)) {
        const replay = await this.findByKey(this.db, userId, variant, req.idempotencyKey);
        if (replay) return replay;
      }
      throw error;
    }
  }

  /** Mode automatique : la même disposition rejouée, chaque tour dans sa propre transaction. */
  async autoplay(userId: number, variant: Variant, req: AutoplayRequest) {
    const spins: SpinResult[] = [];
    let netCents = 0;
    for (let round = 0; round < req.rounds; round++) {
      try {
        const spin = await this.spin(userId, variant, { bets: req.bets, idempotencyKey: `${req.idempotencyKey}:${round}` });
        spins.push(spin);
        netCents += spin.netCents;
      } catch (error) {
        // Un tour refusé en cours de série (solde, limite…) arrête la série sans annuler les précédents.
        if (spins.length > 0 && error instanceof AppError) return { spins, netCents, stoppedBy: error.code };
        throw error;
      }
      if (req.stopOnProfitCents !== undefined && netCents >= req.stopOnProfitCents) {
        return { spins, netCents, stoppedBy: 'profit' };
      }
      if (req.stopOnLossCents !== undefined && -netCents >= req.stopOnLossCents) {
        return { spins, netCents, stoppedBy: 'loss' };
      }
    }
    return { spins, netCents, stoppedBy: 'rounds' };
  }

  async recentSpins(userId: number, variant: Variant, limit: number): Promise<Omit<SpinResult, 'balanceCents'>[]> {
    const { rows } = await this.db.query<SpinRow>(
      `SELECT ${SPIN_COLUMNS} FROM roulette_spins r JOIN game_seeds s ON s.id = r.seed_id
        WHERE r.user_id = $1 AND r.variant = $2 ORDER BY r.id DESC LIMIT $3`,
      [userId, variant, limit],
    );
    return rows.map((row) => {
      const { balanceCents: _, ...result } = toResult(row, 0);
      return result;
    });
  }

  /** Derniers numéros du joueur, répartition rouge/noir/zéros, pair/impair, manque/passe, douzaines, chauds et froids. */
  async stats(userId: number, variant: Variant, limit: number) {
    const { rows } = await this.db.query<{ number: number }>(
      'SELECT number FROM roulette_spins WHERE user_id = $1 AND variant = $2 ORDER BY id DESC LIMIT $3',
      [userId, variant, limit],
    );
    const numbers = rows.map((r) => r.number);
    const count = (test: (n: number) => boolean) => numbers.filter(test).length;
    const frequencies = Array.from({ length: pocketCount(variant) }, (_, n) => ({
      number: n,
      label: pocketLabel(n),
      count: count((x) => x === n),
    }));
    const byCount = [...frequencies].sort((a, b) => b.count - a.count || a.number - b.number);
    return {
      spins: numbers.length,
      lastNumbers: numbers,
      colors: {
        red: count((n) => colorOf(n) === 'red'),
        black: count((n) => colorOf(n) === 'black'),
        green: count((n) => colorOf(n) === 'green'),
      },
      parity: { even: count((n) => n > 0 && n <= 36 && n % 2 === 0), odd: count((n) => n <= 36 && n % 2 === 1) },
      halves: { low: count((n) => n >= 1 && n <= 18), high: count((n) => n >= 19 && n < DOUBLE_ZERO) },
      dozens: [1, 2, 3].map((d) => count((n) => n > 12 * (d - 1) && n <= 12 * d)),
      frequencies,
      hot: byCount.slice(0, 5).map((f) => f.number),
      cold: byCount.slice(-5).reverse().map((f) => f.number),
    };
  }

  private async findByKey(q: Queryable, userId: number, variant: Variant, key: string): Promise<SpinResult | undefined> {
    const { rows } = await q.query<SpinRow & { balanceCents: number }>(
      `SELECT ${SPIN_COLUMNS},
              (SELECT l.balance_after_cents FROM ledger_entries l
                WHERE l.ref_type = 'roulette_spin' AND l.ref_id = r.id::text ORDER BY l.id DESC LIMIT 1) AS "balanceCents"
         FROM roulette_spins r JOIN game_seeds s ON s.id = r.seed_id
        WHERE r.user_id = $1 AND r.variant = $2 AND r.idempotency_key = $3`,
      [userId, variant, key],
    );
    return rows[0] && toResult(rows[0], rows[0].balanceCents);
  }
}
