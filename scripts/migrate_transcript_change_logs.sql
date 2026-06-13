CREATE TABLE IF NOT EXISTS transcript_change_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(12) NOT NULL,
  version INT NOT NULL,
  editor_role VARCHAR(20) NOT NULL,
  editor_id INT NULL,
  editor_name VARCHAR(100) NOT NULL,
  save_kind VARCHAR(40) NOT NULL DEFAULT 'draft',
  changes_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_job_version (job_id, version),
  INDEX idx_job_id (job_id),
  INDEX idx_created_at (created_at),
  CONSTRAINT fk_transcript_change_logs_job FOREIGN KEY (job_id) REFERENCES jobs(job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
