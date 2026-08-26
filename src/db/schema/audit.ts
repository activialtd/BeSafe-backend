import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Immutable audit log. Every state-changing action writes a row here.
 * Never UPDATE, never DELETE — inserts only.
 * The government dashboard reads this to prove things happened.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: varchar('id', { length: 32 }).primaryKey(),

    // Who did it (nullable for system actions)
    actorId: varchar('actor_id', { length: 32 }),
    actorRole: varchar('actor_role', { length: 20 }),

    // What did they do — dot.notation, e.g. 'ride.started', 'sos.triggered', 'vehicle.registered'
    action: varchar('action', { length: 80 }).notNull(),

    // What was affected
    targetType: varchar('target_type', { length: 40 }),
    targetId: varchar('target_id', { length: 40 }),

    // State snapshots (redact PII before write)
    before: jsonb('before'),
    after: jsonb('after'),

    // Traceability
    correlationId: varchar('correlation_id', { length: 64 }),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),

    // Free-form context
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    actorIdx: index('audit_events_actor_idx').on(t.actorId),
    actionIdx: index('audit_events_action_idx').on(t.action),
    targetIdx: index('audit_events_target_idx').on(t.targetType, t.targetId),
    corIdx: index('audit_events_correlation_idx').on(t.correlationId),
    createdAtIdx: index('audit_events_created_at_idx').on(t.createdAt),
  }),
);
