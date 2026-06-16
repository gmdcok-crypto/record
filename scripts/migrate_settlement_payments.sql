ALTER TABLE settlements
  ADD COLUMN total_paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER final_amount;

CREATE TABLE IF NOT EXISTS settlement_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  settlement_id BIGINT NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_settlement_payments_settlement
    FOREIGN KEY (settlement_id) REFERENCES settlements(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  KEY idx_settlement_payments_settlement_id (settlement_id),
  KEY idx_settlement_payments_paid_at (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
