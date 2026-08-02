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
  panorama_image_url TEXT NOT NULL DEFAULT '',
  scene_json TEXT NOT NULL,
  workflow_step INTEGER NOT NULL DEFAULT 1,
  publication_status TEXT NOT NULL DEFAULT 'draft',
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

export const CREATE_SESSIONS_USER_INDEX = `
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)
`;

export const CREATE_SESSIONS_EXPIRY_INDEX = `
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)
`;

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
] as const;
