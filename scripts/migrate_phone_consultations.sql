-- TelWork (phone) consultation records
-- Matches phone/ PWA 상담 등록 schema.

CREATE TABLE IF NOT EXISTS phone_consultations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL DEFAULT '',
  phone VARCHAR(30) NOT NULL DEFAULT '',
  inquiry_type VARCHAR(30) NOT NULL DEFAULT '',
  order_type VARCHAR(20) NOT NULL DEFAULT '',
  file_kind VARCHAR(20) NOT NULL DEFAULT '',
  file_count VARCHAR(30) NOT NULL DEFAULT '',
  range_start VARCHAR(16) NOT NULL DEFAULT '',
  range_end VARCHAR(16) NOT NULL DEFAULT '',
  ranges_json TEXT NULL,
  duration_seconds INT NOT NULL DEFAULT 0,
  estimated_amount INT NOT NULL DEFAULT 0,
  deadline DATETIME NULL,
  delivery_method VARCHAR(20) NOT NULL DEFAULT '',
  memo VARCHAR(500) NULL,
  assignee VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_phone_consultations_phone (phone),
  KEY idx_phone_consultations_status (status),
  KEY idx_phone_consultations_inquiry (inquiry_type),
  KEY idx_phone_consultations_deadline (deadline),
  KEY idx_phone_consultations_assignee (assignee),
  KEY idx_phone_consultations_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
