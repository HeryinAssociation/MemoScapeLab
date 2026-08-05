CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'lightcos',
  bucket TEXT NOT NULL,
  region TEXT NOT NULL,
  object_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  etag TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (bucket, object_key)
);

CREATE INDEX IF NOT EXISTS assets_project_kind_idx
ON assets (project_id, kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS assets_owner_updated_idx
ON assets (owner_user_id, updated_at DESC);
