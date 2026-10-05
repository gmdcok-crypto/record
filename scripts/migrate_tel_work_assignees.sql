CREATE TABLE IF NOT EXISTS tel_work_assignees (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tel_work_assignees_name (name),
  KEY idx_tel_work_assignees_active_sort (is_active, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
