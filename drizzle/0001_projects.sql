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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_updated_at_idx
ON projects (updated_at DESC);
