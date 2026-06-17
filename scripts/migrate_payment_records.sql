CREATE TABLE IF NOT EXISTS payment_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  payment_id VARCHAR(120) NOT NULL,
  member_id BIGINT NULL,
  member_name VARCHAR(100) NOT NULL,
  order_name VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  pay_method VARCHAR(50) NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_payment_records_payment_id (payment_id),
  KEY idx_payment_records_member_id (member_id),
  KEY idx_payment_records_paid_at (paid_at),
  CONSTRAINT fk_payment_records_member
    FOREIGN KEY (member_id) REFERENCES members(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
