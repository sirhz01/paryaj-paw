import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { RoundsService } from './rounds.service';

const TICK_MS = 2000;

/**
 * Scelle les tours à venir (hash publié avant la fermeture des mises) et règle les tickets des tours
 * terminés, sans attendre qu'un caissier les consulte. Désactivé en test : les tests appellent les services.
 */
@Injectable()
export class ShopScheduler implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly logger = new Logger(ShopScheduler.name);

  constructor(
    private readonly rounds: RoundsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.env === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.rounds.sealUpcoming();
      await this.rounds.settleDue();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }
}
