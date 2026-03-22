ALTER TABLE users
  MODIFY COLUMN password_hash VARCHAR(255) NULL,
  ADD COLUMN google_sub VARCHAR(255) NULL AFTER email_verified,
  ADD COLUMN auth_provider ENUM('local','google') NOT NULL DEFAULT 'local' AFTER google_sub;

UPDATE users
SET auth_provider = 'local'
WHERE auth_provider IS NULL;

CREATE UNIQUE INDEX uq_users_google_sub ON users (google_sub);
