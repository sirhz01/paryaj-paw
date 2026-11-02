import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfig, CONFIG } from '../config';

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

/**
 * Envoie les e-mails par SMTP (ex. Gmail avec un « mot de passe d'application ») : solution sans domaine,
 * capable d'écrire à n'importe quelle adresse. L'expéditeur est le compte SMTP lui-même (Gmail le réécrit
 * de toute façon). Hors production, le code est aussi journalisé pour la démo.
 */
@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.transport = createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });
    this.from = `Paryaj Paw <${config.smtpUser}>`;
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    if (this.config.env !== 'production') this.logger.log(`→ ${to} : ${subject} : ${text}`);
    try {
      await this.transport.sendMail({ from: this.from, to, subject, text });
    } catch (error) {
      this.logger.warn(`Envoi SMTP impossible : ${error instanceof Error ? error.message : error}`);
    }
  }
}

/**
 * Écrit les e-mails dans les journaux, pour le développement et les tests.
 * Refuse de démarrer en production : une vraie passerelle (Resend) doit le remplacer.
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  constructor(@Inject(CONFIG) config: AppConfig) {
    if (config.env === 'production') throw new Error('Aucune passerelle e-mail configurée pour la production');
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    this.logger.log(`→ ${to} : ${subject} : ${text}`);
  }
}

/**
 * Envoie les e-mails via l'API Resend (https://resend.com). Hors production, écrit aussi le message
 * dans les journaux : pratique pour la démo, où le code reste visible même si l'envoi réel échoue
 * (domaine non vérifié chez Resend). En production, rien n'est journalisé.
 */
@Injectable()
export class ResendEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    if (this.config.env !== 'production') this.logger.log(`→ ${to} : ${subject} : ${text}`);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.config.emailFrom, to, subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.warn(`Envoi Resend refusé (${res.status}) : ${detail.slice(0, 200)}`);
      }
    } catch (error) {
      this.logger.warn(`Envoi Resend impossible : ${error instanceof Error ? error.message : error}`);
    }
  }
}
