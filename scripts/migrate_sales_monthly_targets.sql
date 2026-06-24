CREATE TABLE IF NOT EXISTS sales_monthly_targets (
  month_key CHAR(7) NOT NULL PRIMARY KEY,
  target_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_by_admin_id BIGINT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sales_monthly_targets_updated_by (updated_by_admin_id),
  CONSTRAINT fk_sales_monthly_targets_admin
    FOREIGN KEY (updated_by_admin_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
