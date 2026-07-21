import { pgTable, text, jsonb, timestamp, serial, boolean, index, integer } from 'drizzle-orm/pg-core';

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

// ── Módulo Repositorio ────────────────────────────────────────────────────────

export const repositorioResources = pgTable('repositorio_resources', {
  id:            serial('id').primaryKey(),
  institucionId: text('institucion_id').notNull().default('default'),
  title:         text('title').notNull(),
  author:        text('author').notNull().default(''),
  level:         text('level').default('General'),
  skill:         text('skill').default(''),
  metadata:      text('metadata').default(''),
  type:          text('type').default(''),
  description:   text('description').default(''),
  uploader:      text('uploader').default(''),
  link:          text('link'),
  fileData:      text('file_data'),
  fileName:      text('file_name'),
  ratingSum:     integer('rating_sum').notNull().default(0),
  ratingCount:   integer('rating_count').notNull().default(0),
  comments:      jsonb('comments').default([]),
  downloadsCount:integer('downloads_count').notNull().default(0),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const repositorioUsers = pgTable('repositorio_users', {
  id:            serial('id').primaryKey(),
  institucionId: text('institucion_id').notNull().default('default'),
  username:      text('username').notNull(),
  fullname:      text('fullname').notNull(),
  role:          text('role').notNull(),
  pass:          text('pass').notNull(),
});

export const repositorioStats = pgTable('repositorio_stats', {
  institucionId: text('institucion_id').primaryKey(),
  views:         integer('views').notNull().default(0),
  downloads:     integer('downloads').notNull().default(0),
  logs:          jsonb('logs').default([]),
});

export const repositorioConfig = pgTable('repositorio_config', {
  institucionId: text('institucion_id').primaryKey(),
  name:          text('name').notNull().default('REPOSITORIO INSTITUCIONAL'),
  logo:          text('logo').notNull().default(''),
});
