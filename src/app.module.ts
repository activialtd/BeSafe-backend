import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { validateEnv } from "./config/env";
import { JwtAuthGuard } from "./common/auth.guard";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";

import { DbModule } from "./db/db.module";

import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { DriversModule } from "./modules/drivers/drivers.module";
import { GovModule } from "./modules/gov/gov.module";
import { HealthModule } from "./modules/health/health.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { RidersModule } from "./modules/riders/riders.module";
import { RidesModule } from "./modules/rides/rides.module";
import { SosModule } from "./modules/sos/sos.module";
import { VerifyModule } from "./modules/verify/verify.module";

import { GatewaysModule } from "./gateways/gateways.module";
import { JobsModule } from "./jobs/jobs.module";
import { RedisModule } from "./modules/redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    // JwtModule at root so guard can inject it (individual modules re-import as needed)
    JwtModule.register({ global: true }),

    DbModule,
    RedisModule,

    // Global infrastructure modules
    AuditModule,
    IdentityModule,
    NotificationsModule,

    // Feature modules
    AuthModule,
    RidersModule,
    DriversModule,
    VerifyModule,
    RidesModule,
    SosModule,
    HealthModule,
    GovModule,

    // Real-time + jobs
    GatewaysModule,
    JobsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
