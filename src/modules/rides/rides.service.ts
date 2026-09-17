import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/common/api-error";
import { newId, shortToken } from "@/common/id";
import { DB, Database } from "@/db/db.module";
import {
  drivers,
  emergencyContacts,
  rideLocations,
  rideShares,
  rides,
  users,
  vehicles,
} from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";

export const startRideDto = z.object({
  vehicleId: z.string().min(1),
});

export const pingDto = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  accuracyMeters: z.number().nonnegative().optional(),
  speedMps: z.number().nonnegative().optional(),
  source: z.enum(["socket", "http"]).default("http"),
});

export const setSharesDto = z.object({
  contactIds: z.array(z.string()).max(5),
});

@Injectable()
export class RidesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async start(riderId: string, vehicleId: string, corId: string, ip?: string) {
    // Fetch vehicle + driver
    const [v] = await this.db
      .select({ vehicle: vehicles, driver: drivers })
      .from(vehicles)
      .innerJoin(drivers, eq(drivers.id, vehicles.driverId))
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.isActive, true)))
      .limit(1);
    if (!v) {
      throw new ApiError({
        code: "VEHICLE_NOT_VERIFIED",
        message: "Vehicle is not registered or has been revoked",
      });
    }
    if (v.driver.suspendedAt) {
      throw new ApiError({
        code: "DRIVER_SUSPENDED",
        message: "Driver is suspended",
      });
    }

    // Prevent overlapping active rides for this rider
    const [existing] = await this.db
      .select({ id: rides.id })
      .from(rides)
      .where(and(eq(rides.riderId, riderId), eq(rides.status, "active")))
      .limit(1);
    if (existing) {
      throw new ApiError({
        code: "CONFLICT",
        message:
          "You already have an active trip. End it before starting another.",
      });
    }

    const id = newId();
    const [row] = await this.db
      .insert(rides)
      .values({
        id,
        riderId,
        driverId: v.driver.userId,
        vehicleId,
        status: "active",
      })
      .returning();

    this.audit.write({
      actorId: riderId,
      actorRole: "rider",
      action: "ride.started",
      targetType: "ride",
      targetId: id,
      correlationId: corId,
      ip,
      after: { vehicleId, driverId: v.driver.userId },
    });

    return row;
  }

  async ping(
    userId: string,
    rideId: string,
    input: z.infer<typeof pingDto>,
    corId: string,
  ) {
    const [ride] = await this.db
      .select()
      .from(rides)
      .where(eq(rides.id, rideId))
      .limit(1);
    if (!ride)
      throw new ApiError({ code: "NOT_FOUND", message: "Ride not found" });
    if (ride.riderId !== userId)
      throw new ApiError({ code: "FORBIDDEN", message: "Not your ride" });
    if (ride.status !== "active") {
      throw new ApiError({
        code: "RIDE_NOT_ACTIVE",
        message: "Ride is not active",
      });
    }

    const locId = newId();
    await this.db.insert(rideLocations).values({
      id: locId,
      rideId,
      lat: input.lat,
      lng: input.lng,
      accuracyMeters: input.accuracyMeters,
      speedMps: input.speedMps,
      source: input.source,
    });
    await this.db
      .update(rides)
      .set({ lastLat: input.lat, lastLng: input.lng, lastPingAt: new Date() })
      .where(eq(rides.id, rideId));

    // Don't audit every ping — too noisy. Audit start/share/end only.
    return { received: true, at: new Date().toISOString() };
  }

  async end(
    userId: string,
    rideId: string,
    reason: string,
    corId: string,
    ip?: string,
  ) {
    const [ride] = await this.db
      .select()
      .from(rides)
      .where(eq(rides.id, rideId))
      .limit(1);
    if (!ride)
      throw new ApiError({ code: "NOT_FOUND", message: "Ride not found" });
    if (ride.riderId !== userId)
      throw new ApiError({ code: "FORBIDDEN", message: "Not your ride" });
    if (ride.status !== "active") {
      throw new ApiError({
        code: "RIDE_NOT_ACTIVE",
        message: "Ride already ended",
      });
    }
    await this.db
      .update(rides)
      .set({ status: "completed", endedAt: new Date(), endReason: reason })
      .where(eq(rides.id, rideId));

    // Auto-unshare
    await this.db
      .update(rideShares)
      .set({ unsharedAt: new Date() })
      .where(and(eq(rideShares.rideId, rideId), isNull(rideShares.unsharedAt)));

    // Bump driver's verified trip counter
    await this.db
      .update(drivers)
      .set({ totalVerifiedTrips: sql`${drivers.totalVerifiedTrips} + 1` })
      .where(eq(drivers.userId, ride.driverId));

    this.audit.write({
      actorId: userId,
      actorRole: "rider",
      action: "ride.ended",
      targetType: "ride",
      targetId: rideId,
      correlationId: corId,
      ip,
      metadata: { reason },
    });
    return { ended: true };
  }

  async setShares(
    userId: string,
    rideId: string,
    contactIds: string[],
    corId: string,
    ip?: string,
  ) {
    const [ride] = await this.db
      .select()
      .from(rides)
      .where(eq(rides.id, rideId))
      .limit(1);
    if (!ride)
      throw new ApiError({ code: "NOT_FOUND", message: "Ride not found" });
    if (ride.riderId !== userId)
      throw new ApiError({ code: "FORBIDDEN", message: "Not your ride" });
    if (ride.status !== "active") {
      throw new ApiError({
        code: "RIDE_NOT_ACTIVE",
        message: "Ride is not active",
      });
    }

    // Sanity check contacts belong to this rider
    const validContacts = contactIds.length
      ? await this.db
          .select({
            id: emergencyContacts.id,
            phone: emergencyContacts.phone,
            name: emergencyContacts.name,
          })
          .from(emergencyContacts)
          .where(
            and(
              eq(emergencyContacts.userId, userId),
              inArray(emergencyContacts.id, contactIds),
            ),
          )
      : [];
    const validIds = new Set(validContacts.map((c) => c.id));

    // Existing active shares for this ride
    const existing = await this.db
      .select()
      .from(rideShares)
      .where(and(eq(rideShares.rideId, rideId), isNull(rideShares.unsharedAt)));

    // Add new shares
    const toAdd = [...validIds].filter(
      (id) => !existing.some((e) => e.contactId === id),
    );
    for (const contactId of toAdd) {
      await this.db.insert(rideShares).values({
        id: newId(),
        rideId,
        contactId,
        watchToken: shortToken(24).toLowerCase(),
      });
    }
    // Remove shares that were dropped
    const toRemove = existing.filter((e) => !validIds.has(e.contactId));
    for (const e of toRemove) {
      await this.db
        .update(rideShares)
        .set({ unsharedAt: new Date() })
        .where(eq(rideShares.id, e.id));
    }

    const shares = await this.db
      .select()
      .from(rideShares)
      .where(and(eq(rideShares.rideId, rideId), isNull(rideShares.unsharedAt)));

    this.audit.write({
      actorId: userId,
      actorRole: "rider",
      action: "ride.shares.updated",
      targetType: "ride",
      targetId: rideId,
      correlationId: corId,
      ip,
      metadata: { activeContactCount: shares.length },
    });

    return { shares };
  }

  async watchByToken(watchToken: string) {
    const [share] = await this.db
      .select({ share: rideShares, ride: rides })
      .from(rideShares)
      .innerJoin(rides, eq(rides.id, rideShares.rideId))
      .where(eq(rideShares.watchToken, watchToken))
      .limit(1);
    if (!share)
      throw new ApiError({ code: "NOT_FOUND", message: "Invalid watch link" });
    if (share.share.unsharedAt) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "This share has ended",
      });
    }
    // Bump view stats (fire-and-forget-ish)
    await this.db
      .update(rideShares)
      .set({
        lastViewedAt: new Date(),
        viewCount: sql`${rideShares.viewCount} + 1`,
      })
      .where(eq(rideShares.id, share.share.id));

    return {
      status: share.ride.status,
      lastLat: share.ride.lastLat,
      lastLng: share.ride.lastLng,
      lastPingAt: share.ride.lastPingAt,
      startedAt: share.ride.startedAt,
      endedAt: share.ride.endedAt,
    };
  }

  /** Used by the WebSocket gateway to fan out location updates. */
  async listActiveWatchTokens(rideId: string): Promise<string[]> {
    const rows = await this.db
      .select({ watchToken: rideShares.watchToken })
      .from(rideShares)
      .where(and(eq(rideShares.rideId, rideId), isNull(rideShares.unsharedAt)));
    return rows.map((r) => r.watchToken);
  }

  async history(userId: string, role: "rider" | "driver") {
    const filter =
      role === "rider" ? eq(rides.riderId, userId) : eq(rides.driverId, userId);

    const rows = await this.db
      .select({
        ride: rides,
        driverUser: users,
        vehicle: vehicles,
      })
      .from(rides)
      .leftJoin(users, eq(rides.driverId, users.id))
      .leftJoin(vehicles, eq(rides.vehicleId, vehicles.id))
      .where(filter)
      .orderBy(desc(rides.startedAt))
      .limit(100);

    return rows.map(({ ride, driverUser, vehicle }) => ({
      ...ride,
      driver: driverUser
        ? {
            id: driverUser.id,
            fullName: driverUser.fullName,
            photoUrl: driverUser.photoUrl,
          }
        : null,
      vehicle: vehicle
        ? {
            id: vehicle.id,
            brand: vehicle.brand,
            model: vehicle.model,
            plateNumber: vehicle.plateNumber,
          }
        : null,
    }));
  }
}
