import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';

export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}

/**
 * Écrit les SMS dans les journaux, pour le développement.
 * Refuse de démarrer en production : un vrai fournisseur (Digicel, Natcom…) doit le remplacer.
 */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  constructor(@Inject(CONFIG) config: AppConfig) {
    if (config.env === 'production') throw new Error('Aucun fournisseur SMS configuré pour la production');
  }

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`→ ${phone} : ${message}`);
  }
}
