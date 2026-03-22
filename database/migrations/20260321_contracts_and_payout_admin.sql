ALTER TABLE users
  ADD COLUMN terms_accepted_version VARCHAR(50) NULL AFTER reset_token_expiry,
  ADD COLUMN terms_accepted_at DATETIME NULL AFTER terms_accepted_version;

CREATE TABLE IF NOT EXISTS contracts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  content LONGTEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  published_by_admin_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contracts_version (version),
  KEY idx_contracts_active_created (is_active, created_at),
  KEY idx_contracts_published_by (published_by_admin_id),
  CONSTRAINT fk_contracts_published_by
    FOREIGN KEY (published_by_admin_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
