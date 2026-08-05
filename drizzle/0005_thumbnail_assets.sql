ALTER TABLE projects ADD COLUMN original_thumbnail_url TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN panorama_thumbnail_url TEXT NOT NULL DEFAULT '';
ALTER TABLE assets ADD COLUMN parent_asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS assets_parent_idx
ON assets (parent_asset_id);
