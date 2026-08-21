-- TelWork (phone) consultation records
-- Matches phone/ PWA IndexedDB schema for server sync.

CREATE TABLE IF NOT EXISTS phone_consultations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL DEFAULT '',
  phone VARCHAR(30) NOT NULL DEFAULT '',
  inquiry_type VARCHAR(100) NOT NULL DEFAULT '',
  purpose VARCHAR(100) NOT NULL DEFAULT '',
  estimated_duration VARCHAR(50) NOT NULL DEFAULT '',
  work_scope VARCHAR(20) NOT NULL DEFAULT 'undecided',
  region VARCHAR(50) NOT NULL DEFAULT '',
  deadline DATETIME NULL,
  file_format VARCHAR(20) NOT NULL DEFAULT 'audio',
  inflow_channel VARCHAR(100) NOT NULL DEFAULT '',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  memo TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_phone_consultations_phone (phone),
  KEY idx_phone_consultations_status (status),
  KEY idx_phone_consultations_priority (priority),
  KEY idx_phone_consultations_deadline (deadline),
  KEY idx_phone_consultations_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
