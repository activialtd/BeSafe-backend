import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "@upstash/redis";
import type { AppEnv } from "@/config/env";
import { RedisService, REDIS_CLIENT } from "./redis.service";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const url = config.get("UPSTASH_REDIS_REST_URL", { infer: true });
        const token = config.get("UPSTASH_REDIS_REST_TOKEN", { infer: true });

        if (!url || !token) {
          throw new Error("Upstash Redis credentials are missing");
        }

        return new Redis({ url, token });
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
