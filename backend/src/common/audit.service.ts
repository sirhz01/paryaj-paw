import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database, Queryable } from '../database/db';

/** Journal append-only des actions du back-office. */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async log(
    staffId: number,
    action: string,
    target: { type: string; id: string | number },
    details: Record<string, unknown> = {},
    tx: Queryable = this.db,
  ): Promise<void> {
    await tx.query(
      'INSERT INTO audit_log (staff_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)',
      [staffId, action, target.type, String(target.id), JSON.stringify(details)],
    );
  }
}
