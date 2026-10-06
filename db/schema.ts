import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), name: text('name'), email: text('email').unique(), emailVerified: text('emailVerified'), image: text('image'),
});
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), provider: text('provider').notNull(), providerAccountId: text('providerAccountId').notNull(),
  refresh_token: text('refresh_token'), access_token: text('access_token'), expires_at: integer('expires_at'), token_type: text('token_type'), scope: text('scope'), id_token: text('id_token'), session_state: text('session_state'), oauth_token: text('oauth_token'), oauth_token_secret: text('oauth_token_secret'),
}, table => [uniqueIndex('idx_accounts_provider').on(table.provider, table.providerAccountId)]);
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), sessionToken: text('sessionToken').notNull().unique(), userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }), expires: text('expires').notNull(),
});
export const verificationTokens = sqliteTable('verification_tokens', {
  identifier: text('identifier').notNull(), token: text('token').notNull(), expires: text('expires').notNull(),
}, table => [primaryKey({ columns: [table.identifier, table.token] })]);
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
}, table => [uniqueIndex('idx_categories_owner_name').on(table.userId, table.name)]);
export const preferences = sqliteTable('preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme', { enum: ['light', 'dark', 'system'] }).notNull().default('system'),
});
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), displayName: text('display_name'), categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }), fileName: text('file_name').notNull(), sourceType: text('source_type').notNull(),
  currentVersion: integer('current_version').notNull().default(1), objectKey: text('object_key').notNull().unique(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deletedAt: text('deleted_at'),
}, table => [index('idx_documents_owner_history').on(table.userId, table.createdAt, table.id)]);
export const documentVersions = sqliteTable('document_versions', {
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(), title: text('title').notNull(), fileName: text('file_name').notNull(),
  objectKey: text('object_key').notNull().unique(), createdAt: text('created_at').notNull(), note: text('note').notNull().default(''),
}, table => [primaryKey({ columns: [table.documentId, table.version] })]);
export const publications = sqliteTable('publications', {
  id: text('id').primaryKey(), documentId: text('document_id').notNull().unique().references(() => documents.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(), title: text('title').notNull(), summary: text('summary').notNull().default(''),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, table => [index('idx_publications_updated').on(table.updatedAt, table.id)]);
