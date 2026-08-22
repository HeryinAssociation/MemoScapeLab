export const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_e164 TEXT COLLATE NOCASE UNIQUE,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  avatar_key TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  onboarding_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  banned_at TEXT
)`;

export const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
)`;

export const CREATE_EMAIL_VERIFICATION_TOKENS_TABLE = `
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
)`;

export const CREATE_ADMIN_AUDIT_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  target_user_id TEXT,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
)`;

export const CREATE_AUTH_ATTEMPTS_TABLE = `
CREATE TABLE IF NOT EXISTS auth_attempts (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
)`;

export const CREATE_PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  capture_time TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'curvedPhoto',
  original_image_url TEXT NOT NULL DEFAULT '',
  original_thumbnail_url TEXT NOT NULL DEFAULT '',
  panorama_image_url TEXT NOT NULL DEFAULT '',
  panorama_thumbnail_url TEXT NOT NULL DEFAULT '',
  scene_json TEXT NOT NULL,
  workflow_step INTEGER NOT NULL DEFAULT 1,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  moderation_status TEXT NOT NULL DEFAULT 'clear',
  moderation_reason TEXT NOT NULL DEFAULT '',
  moderated_at TEXT,
  moderated_by_user_id TEXT REFERENCES users(id),
  owner_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const CREATE_PROJECTS_UPDATED_INDEX = `
CREATE INDEX IF NOT EXISTS projects_updated_at_idx
ON projects (updated_at DESC)
`;

export const CREATE_PROJECTS_OWNER_INDEX = `
CREATE INDEX IF NOT EXISTS projects_owner_updated_idx
ON projects (owner_user_id, updated_at DESC)
`;

export const CREATE_ASSETS_TABLE = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'lightcos',
  bucket TEXT NOT NULL,
  region TEXT NOT NULL,
  object_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  etag TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (bucket, object_key)
)
`;

export const CREATE_ASSETS_PROJECT_INDEX = `
CREATE INDEX IF NOT EXISTS assets_project_kind_idx
ON assets (project_id, kind, updated_at DESC)
`;

export const CREATE_ASSETS_OWNER_INDEX = `
CREATE INDEX IF NOT EXISTS assets_owner_updated_idx
ON assets (owner_user_id, updated_at DESC)
`;

export const CREATE_ASSETS_PARENT_INDEX = `
CREATE INDEX IF NOT EXISTS assets_parent_idx
ON assets (parent_asset_id)
`;

export const CREATE_SESSIONS_USER_INDEX = `
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)
`;

export const CREATE_SESSIONS_EXPIRY_INDEX = `
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)
`;

export const CREATE_IMAGE_GEN_TASKS_TABLE = `
CREATE TABLE IF NOT EXISTS image_gen_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_user_id TEXT REFERENCES users(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  reference_image_keys TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  result_keys TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
)`;

export const CREATE_IMAGE_GEN_TASKS_PROJECT_INDEX = `
CREATE INDEX IF NOT EXISTS image_gen_tasks_project_idx
ON image_gen_tasks (project_id, created_at DESC)
`;

export const CREATE_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
)`;

export const CREATE_USER_IMAGEGEN_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS user_imagegen_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
) WITHOUT ROWID
`;

export const MIGRATE_LEGACY_IMAGEGEN_SETTINGS = `
INSERT OR IGNORE INTO user_imagegen_settings (user_id, key, value, updated_at)
SELECT settings.updated_by, settings.key, settings.value, settings.updated_at
FROM settings
INNER JOIN users ON users.id = settings.updated_by
WHERE settings.key LIKE 'imagegen.%'
`;

export const SETTINGS_SCHEMA_STATEMENTS = [
  CREATE_SETTINGS_TABLE,
  CREATE_USER_IMAGEGEN_SETTINGS_TABLE,
  MIGRATE_LEGACY_IMAGEGEN_SETTINGS,
] as const;

export const IMAGE_GEN_SCHEMA_STATEMENTS = [
  CREATE_IMAGE_GEN_TASKS_TABLE,
  CREATE_IMAGE_GEN_TASKS_PROJECT_INDEX,
] as const;

export const AUTH_SCHEMA_STATEMENTS = [
  CREATE_USERS_TABLE,
  CREATE_SESSIONS_TABLE,
  CREATE_EMAIL_VERIFICATION_TOKENS_TABLE,
  CREATE_ADMIN_AUDIT_LOGS_TABLE,
  CREATE_AUTH_ATTEMPTS_TABLE,
  CREATE_SESSIONS_USER_INDEX,
  CREATE_SESSIONS_EXPIRY_INDEX,
] as const;

export const PROJECT_SCHEMA_STATEMENTS = [
  CREATE_PROJECTS_TABLE,
  CREATE_PROJECTS_UPDATED_INDEX,
  CREATE_PROJECTS_OWNER_INDEX,
  CREATE_ASSETS_TABLE,
  CREATE_ASSETS_PROJECT_INDEX,
  CREATE_ASSETS_OWNER_INDEX,
  CREATE_ASSETS_PARENT_INDEX,
] as const;
