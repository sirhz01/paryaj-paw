import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database, Queryable } from '../database/db';
import { WalletService } from '../wallet/wallet.service';
import { hashServerSeed, newClientSeed, newServerSeed } from './provably-fair';

export interface ActiveSeed {
  id: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface PublicSeed {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
}

export interface RevealedSeed extends PublicSeed {
  serverSeed: string;
  revealedAt: Date;
}

type SeedRow = Omit<ActiveSeed, 'nonce'> & { nextNonce: number };

const ACTIVE_COLUMNS = `id, server_seed AS "serverSeed", server_seed_hash AS "serverSeedHash",
  client_seed AS "clientSeed", next_nonce AS "nextNonce"`;

/**
 * Paire de graines par joueur. Le hash de la graine serveur est connu du joueur avant ses mises ;
 * la graine elle-même n'est révélée qu'à la rotation, ce qui permet de vérifier chaque tirage passé.
 * Les opérations verrouillent le portefeuille pour s'ordonner avec les mises.
 */
@Injectable()
export class SeedsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly wallet: WalletService,
  ) {}

  /** Graine active verrouillée, nonce réservé pour une mise. */
  async takeNonce(tx: Queryable, userId: number): Promise<ActiveSeed> {
    const seed = (await this.findActive(tx, userId)) ?? (await this.create(tx, userId, newClientSeed()));
    await tx.query('UPDATE keno_seeds SET next_nonce = next_nonce + 1 WHERE id = $1', [seed.id]);
    const { nextNonce, ...rest } = seed;
    return { ...rest, nonce: nextNonce };
  }

  active(userId: number): Promise<PublicSeed> {
    return this.db.transaction(async (tx) => {
      await this.wallet.lock(tx, userId);
      const seed = (await this.findActive(tx, userId)) ?? (await this.create(tx, userId, newClientSeed()));
      return { serverSeedHash: seed.serverSeedHash, clientSeed: seed.clientSeed, nextNonce: seed.nextNonce };
    });
  }

  /** Révèle la graine serveur en cours et en ouvre une nouvelle. */
  rotate(userId: number, clientSeed?: string): Promise<{ previous: RevealedSeed | null; current: PublicSeed }> {
    return this.db.transaction(async (tx) => {
      await this.wallet.lock(tx, userId);
      const { rows } = await tx.query<RevealedSeed>(
        `UPDATE keno_seeds SET active = false, revealed_at = now()
          WHERE user_id = $1 AND active
          RETURNING server_seed AS "serverSeed", server_seed_hash AS "serverSeedHash", client_seed AS "clientSeed",
                    next_nonce AS "nextNonce", revealed_at AS "revealedAt"`,
        [userId],
      );
      const next = await this.create(tx, userId, clientSeed ?? newClientSeed());
      return {
        previous: rows[0] ?? null,
        current: { serverSeedHash: next.serverSeedHash, clientSeed: next.clientSeed, nextNonce: next.nextNonce },
      };
    });
  }

  async revealed(userId: number, limit = 20): Promise<RevealedSeed[]> {
    const { rows } = await this.db.query<RevealedSeed>(
      `SELECT server_seed AS "serverSeed", server_seed_hash AS "serverSeedHash", client_seed AS "clientSeed",
              next_nonce AS "nextNonce", revealed_at AS "revealedAt"
         FROM keno_seeds WHERE user_id = $1 AND NOT active
        ORDER BY revealed_at DESC LIMIT $2`,
      [userId, limit],
    );
    return rows;
  }

  private async findActive(tx: Queryable, userId: number): Promise<SeedRow | undefined> {
    const { rows } = await tx.query<SeedRow>(
      `SELECT ${ACTIVE_COLUMNS} FROM keno_seeds WHERE user_id = $1 AND active FOR UPDATE`,
      [userId],
    );
    return rows[0];
  }

  private async create(tx: Queryable, userId: number, clientSeed: string): Promise<SeedRow> {
    const serverSeed = newServerSeed();
    const { rows } = await tx.query<SeedRow>(
      `INSERT INTO keno_seeds (user_id, server_seed, server_seed_hash, client_seed)
       VALUES ($1, $2, $3, $4) RETURNING ${ACTIVE_COLUMNS}`,
      [userId, serverSeed, hashServerSeed(serverSeed), clientSeed],
    );
    return rows[0];
  }
}
