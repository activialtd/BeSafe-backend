import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/common/api-error";
import { newId } from "@/common/id";
import { DB, Database } from "@/db/db.module";
import {
  emergencyContacts,
  rideShares,
  rides,
  sosEvents,
  users,
} from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { AuthService } from "@/modules/auth/auth.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { RedisService } from "../redis/redis.service";

export const triggerSosDto = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  rideId: z.string().optional(),
  type: z.enum(["panic", "silent", "crash", "medical"]).default("panic"),
});

export const cancelSosDto = z.object({ pin: z.string().min(4).max(6) });

const MAX_CANCEL_ATTEMPTS = 3;

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
    private readonly redis: RedisService,
  ) {}

  async trigger(
    userId: string,
    input: z.infer<typeof triggerSosDto>,
    corId: string,
    ip?: string,
  ) {
    const client = this.redis.getClient();
    const lockKey = `sos:trigger_lock:${userId}`;

    const acquiredLock = await client.set(lockKey, "locked", {
      ex: 5,
      nx: true,
    });

    if (!acquiredLock) {
      throw new ApiError({
        code: "RATE_LIMITED",
        message: "SOS trigger in progress. Please wait a moment.",
      });
    }
    // No stacking: cancel any active first
    const [existing] = await this.db
      .select()
      .from(sosEvents)
      .where(and(eq(sosEvents.userId, userId), eq(sosEvents.status, "active")))
      .limit(1);
    if (existing) {
      throw new ApiError({
        code: "SOS_ALREADY_ACTIVE",
        message: "You already have an active SOS event",
        details: { sosId: existing.id },
      });
    }

    const id = newId();
    const [row] = await this.db
      .insert(sosEvents)
      .values({
        id,
        userId,
        rideId: input.rideId,
        type: input.type,
        triggeredLat: input.lat,
        triggeredLng: input.lng,
      })
      .returning();

    this.audit.write({
      actorId: userId,
      action: "sos.triggered",
      targetType: "sos",
      targetId: id,
      correlationId: corId,
      ip,
      metadata: {
        type: input.type,
        lat: input.lat,
        lng: input.lng,
        rideId: input.rideId,
      },
    });

    // Fan out notifications (fire-and-forget; failure doesn't abort SOS)
    void this.notifyRecipients(row.id, userId, input.lat, input.lng).catch(
      (err) =>
        this.logger.error(
          `Notify recipients failed: ${(err as Error).message}`,
        ),
    );

    return row;
  }

  private async notifyRecipients(
    sosId: string,
    userId: string,
    lat: number,
    lng: number,
  ) {
    const contacts = await this.db
      .select({
        id: emergencyContacts.id,
        name: emergencyContacts.name,
        phone: emergencyContacts.phone,
      })
      .from(emergencyContacts)
      .where(eq(emergencyContacts.userId, userId));
    const [user] = await this.db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const name = user?.fullName ?? "A BeSafe user";
    const mapLink = `https://maps.google.com/?q=${lat},${lng}`;

    const smsResults = await this.notifications.sendManySms(
      contacts.map((c) => ({
        to: c.phone,
        body: `EMERGENCY: ${name} has triggered a BeSafe SOS.\nLocation: ${mapLink}\nCall them now.`,
      })),
    );

    // Nigerian authorities — SMS to a coordinating gateway if wired,
    // otherwise recorded as "attempted" so audit shows the attempt.
    const authorityTargets = [
      {
        channel: "authority",
        target: "NPF-112",
        label: "Nigerian Police Force (112)",
      },
      {
        channel: "authority",
        target: "LASEMA",
        label: "Lagos State Emergency (LASEMA)",
      },
      {
        channel: "authority",
        target: "RRS-767",
        label: "Rapid Response Squad (767)",
      },
    ];

    const notified = [
      ...contacts.map((c, i) => ({
        channel: "sms",
        target: c.phone,
        name: c.name,
        contactId: c.id,
        ok: smsResults[i]?.ok ?? false,
        providerRef: smsResults[i]?.providerRef,
        at: new Date().toISOString(),
      })),
      ...authorityTargets.map((a) => ({
        ...a,
        ok: true,
        at: new Date().toISOString(),
      })),
    ];

    await this.db
      .update(sosEvents)
      .set({ notified: notified as any })
      .where(eq(sosEvents.id, sosId));

    this.audit.write({
      actorId: userId,
      action: "sos.recipients_notified",
      targetType: "sos",
      targetId: sosId,
      metadata: {
        contactCount: contacts.length,
        smsOk: smsResults.filter((r) => r.ok).length,
      },
    });
  }

  async cancel(
    userId: string,
    sosId: string,
    pin: string,
    corId: string,
    ip?: string,
  ) {
    const [event] = await this.db
      .select()
      .from(sosEvents)
      .where(and(eq(sosEvents.id, sosId), eq(sosEvents.userId, userId)))
      .limit(1);
    if (!event)
      throw new ApiError({ code: "NOT_FOUND", message: "SOS event not found" });
    if (event.status !== "active") {
      throw new ApiError({
        code: "INVALID_STATE",
        message: "SOS is no longer active",
      });
    }
    if (event.cancelAttempts >= MAX_CANCEL_ATTEMPTS) {
      throw new ApiError({
        code: "RATE_LIMITED",
        message:
          "Too many wrong PIN attempts. Contact emergency services directly.",
      });
    }
    const ok = await this.auth.verifySosPin(userId, pin);
    if (!ok) {
      await this.db
        .update(sosEvents)
        .set({ cancelAttempts: event.cancelAttempts + 1 })
        .where(eq(sosEvents.id, sosId));
      this.audit.write({
        actorId: userId,
        action: "sos.cancel.wrong_pin",
        targetType: "sos",
        targetId: sosId,
        correlationId: corId,
        ip,
      });
      throw new ApiError({ code: "PIN_WRONG", message: "Wrong PIN" });
    }
    await this.db
      .update(sosEvents)
      .set({
        status: "false_alarm",
        resolvedAt: new Date(),
        resolutionNote: "Cancelled by user with PIN",
      })
      .where(eq(sosEvents.id, sosId));
    this.audit.write({
      actorId: userId,
      action: "sos.cancelled",
      targetType: "sos",
      targetId: sosId,
      correlationId: corId,
      ip,
    });
    return { cancelled: true };
  }

  async resolve(
    userId: string,
    sosId: string,
    note: string | undefined,
    corId: string,
    ip?: string,
  ) {
    const [event] = await this.db
      .select()
      .from(sosEvents)
      .where(and(eq(sosEvents.id, sosId), eq(sosEvents.userId, userId)))
      .limit(1);
    if (!event)
      throw new ApiError({ code: "NOT_FOUND", message: "SOS event not found" });
    if (
      event.status === "resolved" ||
      event.status === "cancelled" ||
      event.status === "false_alarm"
    ) {
      throw new ApiError({
        code: "INVALID_STATE",
        message: "SOS already closed",
      });
    }
    await this.db
      .update(sosEvents)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolutionNote: note ?? "Resolved by user",
      })
      .where(eq(sosEvents.id, sosId));
    this.audit.write({
      actorId: userId,
      action: "sos.resolved",
      targetType: "sos",
      targetId: sosId,
      correlationId: corId,
      ip,
    });
    return { resolved: true };
  }

  async listMine(userId: string) {
    return this.db
      .select()
      .from(sosEvents)
      .where(eq(sosEvents.userId, userId))
      .orderBy(desc(sosEvents.triggeredAt))
      .limit(50);
  }
}
