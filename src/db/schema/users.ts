import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// ── enums ───────────────────────────────────────────
export const userRoleEnum = pgEnum('user_role', ['rider', 'driver', 'admin', 'gov']);
export const verificationStatusEnum = pgEnum('verification_status', [
  'pending',
  'verified',
  'rejected',
  'expired',
]);

// ── users ───────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    phone: varchar('phone', { length: 20 }).notNull().unique(),
    email: varchar('email', { length: 255 }),
    fullName: varchar('full_name', { length: 200 }),
    photoUrl: text('photo_url'),
    role: userRoleEnum('role').notNull(),

    // NIN — encrypted at rest (we only store the hash + last 4 for search)
    ninHash: varchar('nin_hash', { length: 128 }),
    ninLast4: varchar('nin_last4', { length: 4 }),
    ninStatus: verificationStatusEnum('nin_status').notNull().default('pending'),
    ninVerifiedAt: timestamp('nin_verified_at', { withTimezone: true }),
    ninProvider: varchar('nin_provider', { length: 40 }),
    ninProviderRef: varchar('nin_provider_ref', { length: 128 }),

    // Argon2id hash of the 4-digit SOS PIN
    sosPinHash: text('sos_pin_hash'),

    // Rider-specific: rating that OTHER riders give (n/a for drivers here)
    // Driver-specific fields live on `drivers` table

    isBlocked: boolean('is_blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => ({
    phoneIdx: index('users_phone_idx').on(t.phone),
    roleIdx: index('users_role_idx').on(t.role),
  }),
);

// ── drivers (1:1 with users where role=driver) ───────
export const drivers = pgTable(
  'drivers',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    userId: varchar('user_id', { length: 32 })
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),

    licenseNumber: varchar('license_number', { length: 40 }),
    licenseStatus: verificationStatusEnum('license_status').notNull().default('pending'),
    licenseVerifiedAt: timestamp('license_verified_at', { withTimezone: true }),
    licenseProvider: varchar('license_provider', { length: 40 }),
    licenseProviderRef: varchar('license_provider_ref', { length: 128 }),
    licenseExpiresAt: timestamp('license_expires_at', { withTimezone: true }),

    backgroundCheckStatus: verificationStatusEnum('background_check_status')
      .notNull()
      .default('pending'),
    backgroundCheckAt: timestamp('background_check_at', { withTimezone: true }),

    rating: integer('rating').notNull().default(0), // stored as int * 100 (e.g., 480 = 4.80)
    ratingCount: integer('rating_count').notNull().default(0),
    totalVerifiedTrips: integer('total_verified_trips').notNull().default(0),

    isOnline: boolean('is_online').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),

    // Flags accumulate; enough flags → verification suspended, QR stops working
    flagCount: integer('flag_count').notNull().default(0),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    onlineIdx: index('drivers_online_idx').on(t.isOnline),
    ratingIdx: index('drivers_rating_idx').on(t.rating),
  }),
);

// ── emergency contacts (rider's next-of-kin list) ────
export const emergencyContacts = pgTable(
  'emergency_contacts',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    userId: varchar('user_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    relationship: varchar('relationship', { length: 40 }),
    priority: integer('priority').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({ userIdx: index('emergency_contacts_user_idx').on(t.userId) }),
);

// ── OTPs ────────────────────────────────────────────
export const otps = pgTable(
  'otps',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    phone: varchar('phone', { length: 20 }).notNull(),
    codeHash: text('code_hash').notNull(),
    purpose: varchar('purpose', { length: 40 }).notNull(), // 'login' | 'verify_phone'
    attempts: integer('attempts').notNull().default(0),
    consumed: boolean('consumed').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({ phoneIdx: index('otps_phone_idx').on(t.phone) }),
);

// ── refresh tokens (jti stored server-side so we can revoke) ──
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    userId: varchar('user_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: varchar('ip', { length: 64 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({ userIdx: index('refresh_tokens_user_idx').on(t.userId) }),
);

// ── relations ───────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  driver: one(drivers, { fields: [users.id], references: [drivers.userId] }),
  emergencyContacts: many(emergencyContacts),
  refreshTokens: many(refreshTokens),
}));

export const driversRelations = relations(drivers, ({ one }) => ({
  user: one(users, { fields: [drivers.userId], references: [users.id] }),
}));

export const emergencyContactsRelations = relations(emergencyContacts, ({ one }) => ({
  user: one(users, { fields: [emergencyContacts.userId], references: [users.id] }),
}));
