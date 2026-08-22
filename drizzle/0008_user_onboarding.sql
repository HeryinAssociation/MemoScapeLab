ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT;

-- Existing accounts have already learned the product organically. Only accounts
-- registered after this migration should receive the automatic first-run guide.
UPDATE users
SET onboarding_completed_at = updated_at
WHERE onboarding_completed_at IS NULL;
