import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { Public } from '@/common/auth.guard';
import { PG_POOL } from '@/db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Public()
  @Get()
  live() {
    return { status: 'ok', at: new Date().toISOString() };
  }

  @Public()
  @Get('deep')
  async deep() {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
    // Postgres
    const t0 = Date.now();
    try {
      await this.pool.query('SELECT 1');
      checks.postgres = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      checks.postgres = { ok: false, error: (err as Error).message };
    }
    const ok = Object.values(checks).every((c) => c.ok);
    return { status: ok ? 'ok' : 'degraded', checks, at: new Date().toISOString() };
  }
}
