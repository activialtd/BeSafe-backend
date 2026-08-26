import { relations, sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { rides } from './rides';
import { users } from './users';

export const sosTypeEnum = pgEnum('sos_type', ['panic', 'silent', 'crash', 'medical']);
export const sosStatusEnum = pgEnum('sos_status', [
  'active',
  'acknowledged',
  'resolved',
  'cancelled',
  'false_alarm',
]);

export const sosEvents = pgTable(
  'sos_events',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    userId: varchar('user_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    rideId: varchar('ride_id', { length: 32 }).references(() => rides.id, { onDelete: 'set null' }),

    type: sosTypeEnum('type').notNull().default('panic'),
    status: sosStatusEnum('status').notNull().default('active'),

    triggeredLat: doublePrecision('triggered_lat').notNull(),
    triggeredLng: doublePrecision('triggered_lng').notNull(),

    // Who was notified: [{channel: 'sms'|'call'|'authority', target: '+2348...', ok, at}]
    notified: jsonb('notified').notNull().default(sql`'[]'::jsonb`),

    // Cancel PIN attempts (rate limited)
    cancelAttempts: integer('cancel_attempts').notNull().default(0),

    triggeredAt: timestamp('triggered_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
  },
  (t) => ({
    userIdx: index('sos_events_user_idx').on(t.userId),
    statusIdx: index('sos_events_status_idx').on(t.status),
    triggeredAtIdx: index('sos_events_triggered_at_idx').on(t.triggeredAt),
  }),
);

export const sosEventsRelations = relations(sosEvents, ({ one }) => ({
  user: one(users, { fields: [sosEvents.userId], references: [users.id] }),
  ride: one(rides, { fields: [sosEvents.rideId], references: [rides.id] }),
}));
