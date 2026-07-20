import { pgTable, text, jsonb, timestamp, serial, boolean, index } from 'drizzle-orm/pg-core';

export const kvStore = pgTable('kv_store', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull().default('info'),
  actor: text('actor').notNull().default(''),
  message: text('message').notNull(),
  meta: jsonb('meta'),
  seen: boolean('seen').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('notifications_seen_idx').on(t.seen),
  index('notifications_created_idx').on(t.createdAt),
]);

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  clave: text('clave').notNull().unique(),
  estId: text('est_id'),
  data: jsonb('data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('documents_est_id_idx').on(t.estId),
]);
