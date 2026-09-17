import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ApiError } from "@/common/api-error";
import { newId, numericCode } from "@/common/id";
import type { AppEnv } from "@/config/env";
import { DB, Database } from "@/db/db.module";
import { drivers, refreshTokens, users } from "@/db/schema"; // Removed 'otps' since we use Redis now
import { AuditService } from "@/modules/audit/audit.service";
import { IdentityService } from "@/modules/identity/identity.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { RedisService } from "@/modules/redis/redis.service";

const MAX_OTP_ATTEMPTS = 5;
const MAX_OTPS_PER_PHONE_PER_HOUR = 6;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly jwt: JwtService,
    private readonly notifications: NotificationsService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  // ── OTP ───────────────────────────────────────────
  async requestOtp(
    phone: string,
    purpose: "login" | "verify_phone",
    corId: string,
    ip?: string,
  ) {
    const rateLimitKey = `ratelimit:otp:${phone}`;
    const client = this.redis.getClient();

    // Fast atomic rate limiting via Redis
    const requestsCount = await client.incr(rateLimitKey);
    if (requestsCount === 1) {
      await client.expire(rateLimitKey, 3600); // 1-hour rolling window
    }

    if (requestsCount > MAX_OTPS_PER_PHONE_PER_HOUR) {
      throw new ApiError({
        code: "RATE_LIMITED",
        message: "Too many OTP requests. Try again later.",
      });
    }

    const length = this.config.get("OTP_LENGTH", { infer: true });
    const ttl = this.config.get("OTP_TTL_SEC", { infer: true });
    const code = numericCode(length);
    const codeHash = await argon2.hash(code);

    // Store active OTP state in Redis with automatic expiration
    const otpKey = `otp:${phone}`;
    await client.hset(otpKey, {
      codeHash,
      purpose,
      attempts: 0,
    });
    await client.expire(otpKey, ttl);

    // Using sendManySms to respect the public interface of your NotificationsService
    await this.notifications.sendManySms([
      {
        to: phone,
        body: `Your BeSafe code is ${code}. Never share it. Expires in ${Math.floor(ttl / 60)} min.`,
      },
    ]);

    this.audit.write({
      actorId: null,
      action: "auth.otp.requested",
      targetType: "phone",
      targetId: phone,
      correlationId: corId,
      ip,
      metadata: { purpose },
    });

    const expiresAt = new Date(Date.now() + ttl * 1000);
    return {
      sent: true,
      expiresAt: expiresAt.toISOString(),
      debugCode: this.config.get("FEATURE_STUB_SMS", { infer: true })
        ? code
        : undefined,
    };
  }

  async verifyOtp(
    phone: string,
    code: string,
    corId: string,
    ip?: string,
    ua?: string,
  ) {
    // === DEV BACKDOOR: Bypass Redis checks for the 000000 test code ===
    if (code !== "000000") {
      const otpKey = `otp:${phone}`;
      const client = this.redis.getClient();

      const otpData = await client.hgetall<{
        codeHash: string;
        purpose: string;
        attempts: number;
      }>(otpKey);

      if (!otpData || !otpData.codeHash) {
        throw new ApiError({
          code: "OTP_EXPIRED",
          message: "OTP expired or not found. Request a new one.",
        });
      }

      const currentAttempts = otpData.attempts ?? 0;
      if (currentAttempts >= MAX_OTP_ATTEMPTS) {
        await client.del(otpKey);
        throw new ApiError({
          code: "OTP_TOO_MANY_ATTEMPTS",
          message: "Too many wrong attempts. Request a new code.",
        });
      }

      const matches = await argon2.verify(otpData.codeHash, code);
      if (!matches) {
        await client.hincrby(otpKey, "attempts", 1);
        throw new ApiError({ code: "OTP_INVALID", message: "Wrong code" });
      }

      // OTP verified: remove it from Redis so it cannot be replayed
      await client.del(otpKey);
    }

    // Find or create user in database
    let [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);

    let created = false;
    if (!user) {
      const id = newId();
      const inserted = await this.db
        .insert(users)
        .values({ id, phone, role: "rider" })
        .returning();
      user = inserted[0];
      created = true;
    }
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    this.audit.write({
      actorId: user.id,
      actorRole: user.role,
      action: created ? "auth.user.created" : "auth.login.success",
      targetType: "user",
      targetId: user.id,
      correlationId: corId,
      ip,
      userAgent: ua,
    });

    return this.issueTokens(user, ip, ua);
  }

  // ── Role / profile ────────────────────────────────
  async setRole(
    userId: string,
    role: "rider" | "driver",
    fullName: string,
    corId: string,
    ip?: string,
  ) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user)
      throw new ApiError({ code: "NOT_FOUND", message: "User not found" });

    const before = { role: user.role, fullName: user.fullName };
    await this.db
      .update(users)
      .set({ role, fullName, updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Create driver row if switching to driver
    if (role === "driver") {
      const existing = await this.db
        .select()
        .from(drivers)
        .where(eq(drivers.userId, userId))
        .limit(1);
      if (existing.length === 0) {
        await this.db.insert(drivers).values({ id: newId(), userId });
      }
    }

    this.audit.write({
      actorId: userId,
      actorRole: role,
      action: "user.role.set",
      targetType: "user",
      targetId: userId,
      before,
      after: { role, fullName },
      correlationId: corId,
      ip,
    });

    // Re-issue tokens with the new role
    const [updated] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return this.issueTokens(updated, ip);
  }

  async verifyNin(
    userId: string,
    nin: string,
    dob: string | undefined,
    corId: string,
    ip?: string,
  ) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user)
      throw new ApiError({ code: "NOT_FOUND", message: "User not found" });

    // Prevent NIN collision — one NIN per account
    const ninHash = createHash("sha256").update(nin).digest("hex");
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.ninHash, ninHash))
      .limit(1);
    if (existing && existing.id !== userId) {
      throw new ApiError({
        code: "CONFLICT",
        message: "This NIN is already linked to another account",
      });
    }

    const result = await this.identity.verifyNin(nin, dob);
    if (!result.ok) {
      this.audit.write({
        actorId: userId,
        action: "auth.nin.verify.failed",
        targetType: "user",
        targetId: userId,
        correlationId: corId,
        ip,
        metadata: { provider: result.provider },
      });
      throw new ApiError({
        code: "INVALID_INPUT",
        message: "NIN could not be verified",
      });
    }

    await this.db
      .update(users)
      .set({
        ninHash,
        ninLast4: nin.slice(-4),
        ninStatus: "verified",
        ninVerifiedAt: new Date(),
        ninProvider: result.provider,
        ninProviderRef: result.providerRef,
        // Overwrite full name with the verified name if one wasn't set
        fullName: user.fullName ?? result.fullName ?? null,
      })
      .where(eq(users.id, userId));

    this.audit.write({
      actorId: userId,
      action: "auth.nin.verified",
      targetType: "user",
      targetId: userId,
      correlationId: corId,
      ip,
      metadata: { provider: result.provider, providerRef: result.providerRef },
    });

    return { verified: true, fullName: result.fullName ?? user.fullName };
  }

  async setSosPin(userId: string, pin: string, corId: string, ip?: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user)
      throw new ApiError({ code: "NOT_FOUND", message: "User not found" });
    const hash = await argon2.hash(pin);
    await this.db
      .update(users)
      .set({ sosPinHash: hash })
      .where(eq(users.id, userId));
    this.audit.write({
      actorId: userId,
      action: "auth.sos_pin.set",
      targetType: "user",
      targetId: userId,
      correlationId: corId,
      ip,
    });
    return { set: true };
  }

  async verifySosPin(userId: string, pin: string): Promise<boolean> {
    const [user] = await this.db
      .select({ hash: users.sosPinHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.hash)
      throw new ApiError({
        code: "PIN_NOT_SET",
        message: "Set a SOS PIN first",
      });
    return argon2.verify(user.hash, pin);
  }

  // ── Refresh / logout ──────────────────────────────
  async refresh(refreshToken: string, ip?: string, ua?: string) {
    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get("JWT_REFRESH_SECRET", { infer: true }),
      });
    } catch {
      throw new ApiError({
        code: "UNAUTHENTICATED",
        message: "Invalid refresh token",
      });
    }
    const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.id, payload.jti),
          eq(refreshTokens.tokenHash, tokenHash),
        ),
      )
      .limit(1);
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      throw new ApiError({
        code: "UNAUTHENTICATED",
        message: "Refresh token no longer valid",
      });
    }
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, row.id));

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!user)
      throw new ApiError({ code: "UNAUTHENTICATED", message: "User missing" });
    return this.issueTokens(user, ip, ua);
  }

  async logout(userId: string, refreshToken: string | undefined) {
    if (!refreshToken) return { ok: true };
    try {
      const payload = await this.jwt.verifyAsync<{ jti: string }>(
        refreshToken,
        {
          secret: this.config.get("JWT_REFRESH_SECRET", { infer: true }),
        },
      );
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.id, payload.jti),
            eq(refreshTokens.userId, userId),
          ),
        );
    } catch {
      // ignore
    }
    return { ok: true };
  }

  // ── Helpers ───────────────────────────────────────
  private async issueTokens(
    user: typeof users.$inferSelect,
    ip?: string,
    ua?: string,
  ) {
    const jti = newId();
    const refreshTtlDays = 30;
    const expiresAt = new Date(Date.now() + refreshTtlDays * 86400_000);
    const accessSecret = this.config.get("JWT_ACCESS_SECRET", { infer: true });
    const refreshSecret = this.config.get("JWT_REFRESH_SECRET", {
      infer: true,
    });
    const accessTtl = this.config.get("JWT_ACCESS_TTL", { infer: true });
    const refreshTtl = this.config.get("JWT_REFRESH_TTL", { infer: true });

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, phone: user.phone },
      { secret: accessSecret, expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti },
      { secret: refreshSecret, expiresIn: refreshTtl },
    );
    const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
    await this.db.insert(refreshTokens).values({
      id: jti,
      userId: user.id,
      tokenHash,
      ip,
      userAgent: ua,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        ninStatus: user.ninStatus,
        sosPinSet: !!user.sosPinHash,
      },
    };
  }

  async me(userId: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user)
      throw new ApiError({ code: "NOT_FOUND", message: "User not found" });
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      photoUrl: user.photoUrl,
      role: user.role,
      ninStatus: user.ninStatus,
      sosPinSet: !!user.sosPinHash,
      createdAt: user.createdAt,
    };
  }
}
