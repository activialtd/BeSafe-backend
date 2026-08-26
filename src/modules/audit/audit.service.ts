import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, Database } from '@/db/db.module';
import { auditEvents } from '@/db/schema';
import { newId } from '@/common/id';

export interface AuditWriteInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Fire-and-forget. Never let audit writes throw into business flows —
   * an audit failure must never break a real user action.
   */
  write(input: AuditWriteInput): void {
    void this.doWrite(input).catch((err) => {
      this.logger.error(
        `Failed to write audit event ${input.action}: ${(err as Error).message}`,
      );
    });
  }

  /** Blocking variant when the caller needs the row id. Rare. */
  async writeSync(input: AuditWriteInput): Promise<string> {
    return this.doWrite(input);
  }

  private async doWrite(input: AuditWriteInput): Promise<string> {
    const id = newId();
    await this.db.insert(auditEvents).values({
      id,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      before: input.before as any,
      after: input.after as any,
      correlationId: input.correlationId,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: input.metadata as any,
    });
    return id;
  }
}
