CREATE TABLE IF NOT EXISTS transcript_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(12) NOT NULL,
  revision_id VARCHAR(20) NOT NULL,
  version INT NOT NULL,
  editor VARCHAR(100) NULL,
  change_summary TEXT NULL,
  r2_key VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_revision_id (revision_id),
  UNIQUE KEY uk_job_version (job_id, version),
  INDEX idx_job_id (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
