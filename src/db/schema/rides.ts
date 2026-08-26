import { relations, sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { emergencyContacts, users } from './users';
import { vehicles } from './vehicles';

export const rideStatusEnum = pgEnum('ride_status', ['active', 'completed', 'cancelled', 'sos']);

// A "ride" in BeSafe = a monitored timespan.
// No pickup / destination / fare — the point is just live tracking.
export const rides = pgTable(
  'rides',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    riderId: varchar('rider_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    driverId: varchar('driver_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    vehicleId: varchar('vehicle_id', { length: 32 })
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),

    status: rideStatusEnum('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    // Denormalised for fast list rendering
    lastLat: doublePrecision('last_lat'),
    lastLng: doublePrecision('last_lng'),
    lastPingAt: timestamp('last_ping_at', { withTimezone: true }),

    // What triggered the end? "arrived", "cancelled", "auto_timeout", "sos_resolved"
    endReason: varchar('end_reason', { length: 40 }),
  },
  (t) => ({
    riderIdx: index('rides_rider_idx').on(t.riderId),
    driverIdx: index('rides_driver_idx').on(t.driverId),
    statusIdx: index('rides_status_idx').on(t.status),
  }),
);

// Every location update during a ride — keep raw so audit can replay
export const rideLocations = pgTable(
  'ride_locations',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    rideId: varchar('ride_id', { length: 32 })
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracyMeters: doublePrecision('accuracy_meters'),
    speedMps: doublePrecision('speed_mps'),
    source: varchar('source', { length: 20 }).notNull().default('socket'), // 'socket' | 'http'
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    rideTimeIdx: index('ride_locations_ride_time_idx').on(t.rideId, t.recordedAt),
  }),
);

// Which contacts a rider chose to share this trip with
export const rideShares = pgTable(
  'ride_shares',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    rideId: varchar('ride_id', { length: 32 })
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    contactId: varchar('contact_id', { length: 32 })
      .notNull()
      .references(() => emergencyContacts.id, { onDelete: 'cascade' }),
    sharedAt: timestamp('shared_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // NULL if still sharing; set when rider un-shares or trip ends
    unsharedAt: timestamp('unshared_at', { withTimezone: true }),
    // Unique token — the contact can open this URL to see live location without login
    watchToken: varchar('watch_token', { length: 64 }).notNull().unique(),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    viewCount: doublePrecision('view_count').notNull().default(0),
  },
  (t) => ({
    rideIdx: index('ride_shares_ride_idx').on(t.rideId),
    watchTokenIdx: index('ride_shares_watch_token_idx').on(t.watchToken),
  }),
);

// Ratings a rider can give a driver after a trip
export const rideRatings = pgTable(
  'ride_ratings',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    rideId: varchar('ride_id', { length: 32 })
      .notNull()
      .unique()
      .references(() => rides.id, { onDelete: 'cascade' }),
    riderId: varchar('rider_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    driverId: varchar('driver_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    stars: doublePrecision('stars').notNull(), // 1..5
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({ driverIdx: index('ride_ratings_driver_idx').on(t.driverId) }),
);

// Reports (rider reporting a driver, or a vehicle)
export const reports = pgTable(
  'reports',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    reporterId: varchar('reporter_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    targetType: varchar('target_type', { length: 20 }).notNull(), // 'driver' | 'vehicle'
    targetId: varchar('target_id', { length: 32 }).notNull(),
    rideId: varchar('ride_id', { length: 32 }).references(() => rides.id),
    reason: varchar('reason', { length: 60 }).notNull(),
    detail: text('detail'),
    status: varchar('status', { length: 20 }).notNull().default('open'), // 'open' | 'reviewing' | 'resolved' | 'dismissed'
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    targetIdx: index('reports_target_idx').on(t.targetType, t.targetId),
    statusIdx: index('reports_status_idx').on(t.status),
  }),
);

// ── relations ──────────────────────────────────────
export const ridesRelations = relations(rides, ({ one, many }) => ({
  rider: one(users, { fields: [rides.riderId], references: [users.id], relationName: 'rides_rider' }),
  driver: one(users, { fields: [rides.driverId], references: [users.id], relationName: 'rides_driver' }),
  vehicle: one(vehicles, { fields: [rides.vehicleId], references: [vehicles.id] }),
  locations: many(rideLocations),
  shares: many(rideShares),
}));

export const rideLocationsRelations = relations(rideLocations, ({ one }) => ({
  ride: one(rides, { fields: [rideLocations.rideId], references: [rides.id] }),
}));

export const rideSharesRelations = relations(rideShares, ({ one }) => ({
  ride: one(rides, { fields: [rideShares.rideId], references: [rides.id] }),
  contact: one(emergencyContacts, { fields: [rideShares.contactId], references: [emergencyContacts.id] }),
}));
