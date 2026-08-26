import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AppEnv } from '@/config/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const pool = new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: config.get('DATABASE_POOL_MAX', { infer: true }),
          // Fail fast — better to error than to hang forever
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
          keepAlive: true,
        });
        // Swallow pool-level errors so they don't crash the process
        pool.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error('[pg-pool error]', err.message);
        });
        return pool;
      },
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema, logger: false }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onModuleDestroy() {
    await this.pool.end();
  }
}
