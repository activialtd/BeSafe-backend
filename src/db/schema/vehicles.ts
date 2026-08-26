import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { drivers, verificationStatusEnum } from './users';

export const vehicleTypeEnum = pgEnum('vehicle_type', [
  'car',
  'bus',
  'tricycle',
  'motorcycle',
  'minivan',
]);

export const vehicles = pgTable(
  'vehicles',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    driverId: varchar('driver_id', { length: 32 })
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),

    type: vehicleTypeEnum('type').notNull(),
    brand: varchar('brand', { length: 60 }).notNull(),
    model: varchar('model', { length: 60 }).notNull(),
    year: integer('year').notNull(),
    color: varchar('color', { length: 40 }).notNull(),
    plateNumber: varchar('plate_number', { length: 20 }).notNull(),

    // Unique unguessable QR token — printed inside the vehicle
    qrToken: text('qr_token').notNull().unique(),
    // Which token version — bumping this invalidates old printed stickers
    qrVersion: integer('qr_version').notNull().default(1),

    registrationStatus: verificationStatusEnum('registration_status').notNull().default('pending'),
    photos: text('photos').array().notNull().default(sql`ARRAY[]::text[]`),

    isActive: boolean('is_active').notNull().default(true),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    driverIdx: index('vehicles_driver_idx').on(t.driverId),
    plateIdx: uniqueIndex('vehicles_plate_uidx').on(t.plateNumber),
    qrTokenIdx: uniqueIndex('vehicles_qr_token_uidx').on(t.qrToken),
    activeIdx: index('vehicles_active_idx').on(t.isActive),
  }),
);

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  driver: one(drivers, { fields: [vehicles.driverId], references: [drivers.id] }),
}));
