import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from '@/common/api-error';
import { DB, Database } from '@/db/db.module';
import { drivers, users, vehicles } from '@/db/schema';
import { AuditService } from '@/modules/audit/audit.service';

export const verifyByQrDto = z.object({
  qrToken: z.string().min(4).max(200),
});
export const verifyByPlateDto = z.object({
  plate: z
    .string()
    .min(3)
    .max(20)
    .transform((v) => v.toUpperCase().replace(/\s+/g, '-')),
});

export interface VerificationResult {
  ok: boolean;
  vehicle?: {
    id: string;
    type: string;
    brand: string;
    model: string;
    year: number;
    color: string;
    plateNumber: string;
  };
  driver?: {
    id: string;
    fullName: string | null;
    photoUrl: string | null;
    rating: number;
    totalVerifiedTrips: number;
    ninStatus: string;
    licenseStatus: string;
    backgroundCheckStatus: string;
  };
  warnings?: string[];
  reason?: string;
}

@Injectable()
export class VerifyService {
  constructor(@Inject(DB) private readonly db: Database, private readonly audit: AuditService) {}

  async byQr(qrToken: string, actorId: string | null, corId: string, ip?: string): Promise<VerificationResult> {
    const row = await this.lookup(eq(vehicles.qrToken, qrToken));
    this.audit.write({
      actorId,
      action: 'verify.by_qr',
      targetType: 'vehicle',
      targetId: row?.vehicle.id,
      correlationId: corId,
      ip,
      metadata: { ok: !!row, qrToken: qrToken.slice(0, 20) + '…' },
    });
    return this.render(row, 'This vehicle is not in the BeSafe registry.');
  }

  async byPlate(plate: string, actorId: string | null, corId: string, ip?: string): Promise<VerificationResult> {
    const row = await this.lookup(eq(vehicles.plateNumber, plate));
    this.audit.write({
      actorId,
      action: 'verify.by_plate',
      targetType: 'vehicle',
      targetId: row?.vehicle.id,
      correlationId: corId,
      ip,
      metadata: { ok: !!row, plate },
    });
    return this.render(row, 'This plate number is NOT registered on BeSafe. Do NOT enter.');
  }

  private async lookup(whereClause: any) {
    const [row] = await this.db
      .select({
        vehicle: vehicles,
        driver: drivers,
        user: users,
      })
      .from(vehicles)
      .innerJoin(drivers, eq(drivers.id, vehicles.driverId))
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(and(whereClause, eq(vehicles.isActive, true)))
      .limit(1);
    return row;
  }

  private render(
    row:
      | {
          vehicle: typeof vehicles.$inferSelect;
          driver: typeof drivers.$inferSelect;
          user: typeof users.$inferSelect;
        }
      | undefined,
    notFoundReason: string,
  ): VerificationResult {
    if (!row) return { ok: false, reason: notFoundReason };
    const { vehicle, driver, user } = row;

    const warnings: string[] = [];
    if (driver.suspendedAt) {
      return { ok: false, reason: 'This driver has been suspended from BeSafe.' };
    }
    if (driver.licenseExpiresAt && driver.licenseExpiresAt.getTime() < Date.now()) {
      warnings.push("Driver's license has expired.");
    }
    if (driver.rating > 0 && driver.rating < 400) {
      warnings.push('Driver has a rating below 4.0.');
    }
    if (driver.flagCount > 3) {
      warnings.push(`Driver has ${driver.flagCount} open reports.`);
    }

    return {
      ok: true,
      vehicle: {
        id: vehicle.id,
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        plateNumber: vehicle.plateNumber,
      },
      driver: {
        id: driver.id,
        fullName: user.fullName,
        photoUrl: user.photoUrl,
        rating: driver.rating / 100,
        totalVerifiedTrips: driver.totalVerifiedTrips,
        ninStatus: user.ninStatus,
        licenseStatus: driver.licenseStatus,
        backgroundCheckStatus: driver.backgroundCheckStatus,
      },
      warnings: warnings.length ? warnings : undefined,
    };
  }
}
