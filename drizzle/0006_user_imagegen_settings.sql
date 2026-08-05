CREATE TABLE IF NOT EXISTS user_imagegen_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
) WITHOUT ROWID;

INSERT OR IGNORE INTO user_imagegen_settings (user_id, key, value, updated_at)
SELECT settings.updated_by, settings.key, settings.value, settings.updated_at
FROM settings
INNER JOIN users ON users.id = settings.updated_by
WHERE settings.key LIKE 'imagegen.%';
