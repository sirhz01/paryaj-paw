import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Erreur métier renvoyée sous la forme `{ code, ...details }`.
 * Le front traduit `code` en kreyòl, français ou anglais.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details: Record<string, unknown> = {},
  ) {
    super({ code, ...details }, status);
  }
}
