import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from '@/common/api-error';
import { buildQrToken, newId } from '@/common/id';
import { DB, Database } from '@/db/db.module';
import { drivers, users, vehicles } from '@/db/schema';
import { AuditService } from '@/modules/audit/audit.service';
import { IdentityService } from '@/modules/identity/identity.service';

export const verifyLicenseDto = z.object({
  licenseNumber: z.string().min(5).max(40),
  dateOfBirth: z.string().optional(),
});
export type VerifyLicenseDto = z.infer<typeof verifyLicenseDto>;

export const registerVehicleDto = z.object({
  type: z.enum(['car', 'bus', 'tricycle', 'motorcycle', 'minivan']),
  brand: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  year: z.number().int().min(1980).max(new Date().getFullYear() + 1),
  color: z.string().min(1).max(40),
  plateNumber: z
    .string()
    .min(3)
    .max(20)
    .transform((v) => v.toUpperCase().replace(/\s+/g, '-')),
  photos: z.array(z.string().url()).max(6).optional(),
});
export type RegisterVehicleDto = z.infer<typeof registerVehicleDto>;

@Injectable()
export class DriversService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}

  private async requireDriver(userId: string) {
    const [row] = await this.db
      .select({ driver: drivers, user: users })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(eq(drivers.userId, userId))
      .limit(1);
    if (!row) throw new ApiError({ code: 'FORBIDDEN', message: 'Not a driver account' });
    if (row.driver.suspendedAt) {
      throw new ApiError({
        code: 'DRIVER_SUSPENDED',
        message: 'Your driver account is suspended',
        details: { reason: row.driver.suspensionReason },
      });
    }
    return row;
  }

  async getProfile(userId: string) {
    const { driver, user } = await this.requireDriver(userId);
    const vs = await this.db.select().from(vehicles).where(eq(vehicles.driverId, driver.id));
    return { driver, user: this.stripUser(user), vehicles: vs };
  }

  async verifyLicense(userId: string, input: VerifyLicenseDto, corId: string, ip?: string) {
    const { driver } = await this.requireDriver(userId);
    const result = await this.identity.verifyDriverLicense(input.licenseNumber, input.dateOfBirth);
    if (!result.ok) {
      this.audit.write({
        actorId: userId,
        actorRole: 'driver',
        action: 'driver.license.verify.failed',
        targetType: 'driver',
        targetId: driver.id,
        correlationId: corId,
        ip,
      });
      throw new ApiError({ code: 'INVALID_INPUT', message: 'License could not be verified' });
    }
    await this.db
      .update(drivers)
      .set({
        licenseNumber: input.licenseNumber,
        licenseStatus: 'verified',
        licenseVerifiedAt: new Date(),
        licenseProvider: result.provider,
        licenseProviderRef: result.providerRef,
        licenseExpiresAt: result.expiryDate ? new Date(result.expiryDate) : null,
      })
      .where(eq(drivers.id, driver.id));
    this.audit.write({
      actorId: userId,
      actorRole: 'driver',
      action: 'driver.license.verified',
      targetType: 'driver',
      targetId: driver.id,
      correlationId: corId,
      ip,
      metadata: {
        provider: result.provider,
        licenseClass: result.licenseClass,
        expiryDate: result.expiryDate,
      },
    });
    return { verified: true, licenseClass: result.licenseClass, expiryDate: result.expiryDate };
  }

  async registerVehicle(userId: string, input: RegisterVehicleDto, corId: string, ip?: string) {
    const { driver } = await this.requireDriver(userId);

    // No duplicate plates
    const [dup] = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.plateNumber, input.plateNumber))
      .limit(1);
    if (dup) {
      throw new ApiError({
        code: 'CONFLICT',
        message: 'A vehicle with this plate is already registered',
      });
    }

    const id = newId();
    const qrToken = buildQrToken(id);
    const [row] = await this.db
      .insert(vehicles)
      .values({
        id,
        driverId: driver.id,
        type: input.type,
        brand: input.brand,
        model: input.model,
        year: input.year,
        color: input.color,
        plateNumber: input.plateNumber,
        qrToken,
        registrationStatus: 'verified',
        photos: input.photos ?? [],
      })
      .returning();

    this.audit.write({
      actorId: userId,
      actorRole: 'driver',
      action: 'vehicle.registered',
      targetType: 'vehicle',
      targetId: id,
      after: { plate: input.plateNumber, type: input.type },
      correlationId: corId,
      ip,
    });

    return row;
  }

  async revokeVehicle(userId: string, vehicleId: string, reason: string, corId: string, ip?: string) {
    const { driver } = await this.requireDriver(userId);
    const [v] = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.driverId, driver.id)))
      .limit(1);
    if (!v) throw new ApiError({ code: 'NOT_FOUND', message: 'Vehicle not found' });
    await this.db
      .update(vehicles)
      .set({ isActive: false, revokedAt: new Date(), revokedReason: reason })
      .where(eq(vehicles.id, vehicleId));
    this.audit.write({
      actorId: userId,
      actorRole: 'driver',
      action: 'vehicle.revoked',
      targetType: 'vehicle',
      targetId: vehicleId,
      correlationId: corId,
      ip,
      metadata: { reason },
    });
    return { revoked: true };
  }

  async setOnline(userId: string, online: boolean, corId: string, ip?: string) {
    const { driver } = await this.requireDriver(userId);
    await this.db
      .update(drivers)
      .set({ isOnline: online, lastSeenAt: new Date() })
      .where(eq(drivers.id, driver.id));
    this.audit.write({
      actorId: userId,
      actorRole: 'driver',
      action: online ? 'driver.online' : 'driver.offline',
      targetType: 'driver',
      targetId: driver.id,
      correlationId: corId,
      ip,
    });
    return { online };
  }

  private stripUser(u: typeof users.$inferSelect) {
    return {
      id: u.id,
      fullName: u.fullName,
      phone: u.phone,
      photoUrl: u.photoUrl,
      ninStatus: u.ninStatus,
    };
  }
}
