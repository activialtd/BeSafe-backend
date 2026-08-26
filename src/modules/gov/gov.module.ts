import { Controller, Get, Inject, Injectable, Query } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Roles } from '@/common/auth.guard';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { DB, Database } from '@/db/db.module';
import { auditEvents, drivers, rides, sosEvents, users, vehicles } from '@/db/schema';

const auditQueryDto = z.object({
  action: z.string().optional(),
  actorId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@Injectable()
export class GovService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async stats() {
    const [{ n: userCount }] = await this.db.select({ n: count() }).from(users);
    const [{ n: driverCount }] = await this.db.select({ n: count() }).from(drivers);
    const [{ n: vehicleCount }] = await this.db
      .select({ n: count() })
      .from(vehicles)
      .where(eq(vehicles.isActive, true));
    const [{ n: activeRides }] = await this.db
      .select({ n: count() })
      .from(rides)
      .where(eq(rides.status, 'active'));
    const [{ n: activeSos }] = await this.db
      .select({ n: count() })
      .from(sosEvents)
      .where(eq(sosEvents.status, 'active'));

    // Last 24h counts
    const dayAgo = new Date(Date.now() - 86400_000);
    const [{ n: ridesToday }] = await this.db
      .select({ n: count() })
      .from(rides)
      .where(gte(rides.startedAt, dayAgo));
    const [{ n: sosToday }] = await this.db
      .select({ n: count() })
      .from(sosEvents)
      .where(gte(sosEvents.triggeredAt, dayAgo));

    return {
      userCount: Number(userCount),
      driverCount: Number(driverCount),
      activeVehicleCount: Number(vehicleCount),
      activeRides: Number(activeRides),
      activeSos: Number(activeSos),
      last24h: {
        rides: Number(ridesToday),
        sosEvents: Number(sosToday),
      },
      at: new Date().toISOString(),
    };
  }

  async activeSosFeed() {
    return this.db
      .select({
        sos: sosEvents,
        user: {
          id: users.id,
          fullName: users.fullName,
          phone: users.phone,
        },
      })
      .from(sosEvents)
      .innerJoin(users, eq(users.id, sosEvents.userId))
      .where(eq(sosEvents.status, 'active'))
      .orderBy(desc(sosEvents.triggeredAt))
      .limit(100);
  }

  async queryAudit(input: z.infer<typeof auditQueryDto>) {
    const conds = [];
    if (input.action) conds.push(eq(auditEvents.action, input.action));
    if (input.actorId) conds.push(eq(auditEvents.actorId, input.actorId));
    if (input.from) conds.push(gte(auditEvents.createdAt, new Date(input.from)));
    if (input.to) conds.push(sql`${auditEvents.createdAt} <= ${new Date(input.to)}`);
    const where = conds.length ? and(...conds) : undefined;
    return this.db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(input.limit);
  }
}

@Controller('gov')
export class GovController {
  constructor(private readonly svc: GovService) {}

  @Get('stats')
  @Roles('gov', 'admin')
  stats() {
    return this.svc.stats();
  }

  @Get('sos/active')
  @Roles('gov', 'admin')
  activeSos() {
    return this.svc.activeSosFeed();
  }

  @Get('audit')
  @Roles('gov', 'admin')
  audit(@Query(new ZodValidationPipe(auditQueryDto)) q: z.infer<typeof auditQueryDto>) {
    return this.svc.queryAudit(q);
  }
}

@Module({
  controllers: [GovController],
  providers: [GovService],
})
export class GovModule {}
