import { Inject, Injectable } from "@nestjs/common";
import { Redis } from "@upstash/redis";

export const REDIS_CLIENT = "REDIS_CLIENT";

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async set(
    key: string,
    value: string | number | Record<string, unknown>,
    ttlSeconds?: number,
  ): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, {
        ex: ttlSeconds,
      });
    } else {
      await this.redis.set(key, value);
    }
  }

  async get<T = string>(key: string): Promise<T | null> {
    return this.redis.get<T>(key);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  getClient(): Redis {
    return this.redis;
  }
}
