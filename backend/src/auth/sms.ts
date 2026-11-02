import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';

export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}

/**
 * Écrit les SMS dans les journaux. Les codes de vérification passent désormais par l'e-mail (voir email.ts) ;
 * ce fournisseur est conservé pour compatibilité (tests) et n'est plus sur le chemin critique. Si un vrai
 * envoi de SMS redevient nécessaire (Digicel, Natcom…), le remplacer par une implémentation dédiée.
 */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async send(phone: string, message: string): Promise<void> {
    if (this.config.env === 'production') {
      this.logger.warn(`SMS non configuré (ignoré) → ${phone}`);
      return;
    }
    this.logger.log(`→ ${phone} : ${message}`);
  }
}
