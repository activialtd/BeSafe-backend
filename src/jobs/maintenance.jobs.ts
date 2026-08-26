import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { DB, Database } from '@/db/db.module';
import { otps, refreshTokens, rideShares, rides } from '@/db/schema';
import { AuditService } from '@/modules/audit/audit.service';

@Injectable()
export class MaintenanceJobs {
  private readonly logger = new Logger(MaintenanceJobs.name);

  constructor(@Inject(DB) private readonly db: Database, private readonly audit: AuditService) {}

  /** Auto-end rides that have had no ping for 3+ hours — rider probably forgot to end. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async endStaleRides() {
    const threshold = new Date(Date.now() - 3 * 3600_000);
    const stale = await this.db
      .select({ id: rides.id, riderId: rides.riderId })
      .from(rides)
      .where(
        and(
          eq(rides.status, 'active'),
          or(
            lt(rides.lastPingAt, threshold),
            and(sql`${rides.lastPingAt} IS NULL`, lt(rides.startedAt, threshold)),
          ),
        ),
      );
    if (stale.length === 0) return;
    for (const r of stale) {
      await this.db
        .update(rides)
        .set({ status: 'completed', endedAt: new Date(), endReason: 'auto_timeout' })
        .where(eq(rides.id, r.id));
      await this.db
        .update(rideShares)
        .set({ unsharedAt: new Date() })
        .where(and(eq(rideShares.rideId, r.id), sql`${rideShares.unsharedAt} IS NULL`));
      this.audit.write({
        actorId: null,
        actorRole: 'admin',
        action: 'ride.auto_ended',
        targetType: 'ride',
        targetId: r.id,
        metadata: { reason: 'no_pings_3h' },
      });
    }
    this.logger.log(`Auto-ended ${stale.length} stale ride(s)`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredOtps() {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const res = await this.db.delete(otps).where(lt(otps.expiresAt, cutoff));
    // pg driver returns rowCount on the result; drizzle passes it through
    this.logger.debug(`Cleaned up expired OTPs (older than 24h)`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredRefreshTokens() {
    const now = new Date();
    await this.db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now));
    this.logger.log('Cleaned up expired refresh tokens');
  }
}
