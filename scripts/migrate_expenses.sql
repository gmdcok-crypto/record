CREATE TABLE IF NOT EXISTS expense_categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_expense_categories_name (name),
  KEY idx_expense_categories_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS expense_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  category_id BIGINT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  expense_date DATE NOT NULL,
  note VARCHAR(255) NULL,
  source_type VARCHAR(30) NULL,
  source_id VARCHAR(120) NULL,
  created_by_admin_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_expense_records_date (expense_date),
  KEY idx_expense_records_category_id (category_id),
  KEY idx_expense_records_source (source_type, source_id),
  CONSTRAINT fk_expense_records_category
    FOREIGN KEY (category_id) REFERENCES expense_categories(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_expense_records_admin
    FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
