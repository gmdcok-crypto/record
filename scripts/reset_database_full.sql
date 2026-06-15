-- Full reset: drop all tables and recreate schema
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS settlement_items;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS invoice_payments;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS member_push_subscriptions;
DROP TABLE IF EXISTS admin_push_subscriptions;
DROP TABLE IF EXISTS job_inquiry_messages;
DROP TABLE IF EXISTS job_notes;
DROP TABLE IF EXISTS job_status_logs;
DROP TABLE IF EXISTS job_assignments;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS transcript_shares;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS transcribers;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS transcript_history;
DROP TABLE IF EXISTS transcript_change_logs;
SET FOREIGN_KEY_CHECKS = 1;


SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS clients (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  client_code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  contact_name VARCHAR(100) NULL,
  contact_phone VARCHAR(30) NULL,
  contact_email VARCHAR(150) NULL,
  billing_policy VARCHAR(100) NULL,
  default_unit_price DECIMAL(12,2) NULL,
  default_turnaround_hours INT NULL,
  notes TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_clients_code (client_code),
  KEY idx_clients_name (name),
  KEY idx_clients_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('owner', 'manager', 'operator', 'accounting', 'viewer') NOT NULL DEFAULT 'operator',
  phone VARCHAR(30) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_admin_users_email (email),
  KEY idx_admin_users_role (role),
  KEY idx_admin_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS members (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(30) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_members_email (email),
  KEY idx_members_phone (phone),
  KEY idx_members_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transcribers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  transcriber_code VARCHAR(50) NOT NULL,
  login_id VARCHAR(8) NULL,
  password_hash VARCHAR(255) NULL,
  auth_status VARCHAR(20) NOT NULL DEFAULT 'pending_signup',
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(30) NULL COMMENT '휴대폰 번호',
  email VARCHAR(150) NULL,
  status ENUM('available', 'working', 'off', 'inactive') NOT NULL DEFAULT 'available',
  grade_level INT NOT NULL DEFAULT 1,
  specialty VARCHAR(200) NULL,
  unit_price_type ENUM('per_minute', 'per_case', 'custom') NOT NULL DEFAULT 'per_minute',
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  monthly_capacity INT NULL,
  current_load INT NOT NULL DEFAULT 0,
  quality_score DECIMAL(3,2) NULL,
  bank_name VARCHAR(100) NULL COMMENT '은행명',
  account_holder VARCHAR(100) NULL COMMENT '예금주',
  account_number VARCHAR(100) NULL COMMENT '계좌번호',
  resident_id_masked VARCHAR(30) NULL COMMENT '주민등록번호',
  license_r2_key VARCHAR(255) NULL COMMENT '속기사 자격증 R2 key',
  license_filename VARCHAR(255) NULL COMMENT '속기사 자격증 원본 파일명',
  notes TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_transcribers_code (transcriber_code),
  UNIQUE KEY uk_transcribers_email (email),
  UNIQUE KEY uk_transcribers_login_id (login_id),
  KEY idx_transcribers_auth_status (auth_status),
  KEY idx_transcribers_status (status),
  KEY idx_transcribers_active (is_active),
  KEY idx_transcribers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  project_id VARCHAR(12) NOT NULL PRIMARY KEY,
  client_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  due_at DATETIME NULL,
  memo TEXT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  pdf_delivery_mode VARCHAR(20) NOT NULL DEFAULT 'individual',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  KEY idx_projects_client (client_id),
  KEY idx_projects_due (due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS jobs (
  job_id VARCHAR(12) PRIMARY KEY,
  project_id VARCHAR(12) NULL,
  client_id BIGINT NULL,
  title VARCHAR(200) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  media_type VARCHAR(50) NULL,
  duration_seconds INT NULL,
  source_language VARCHAR(20) NULL DEFAULT 'ko',
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at DATETIME NULL,
  completed_at DATETIME NULL,
  priority ENUM('normal', 'urgent') NOT NULL DEFAULT 'normal',
  status ENUM(
    'uploaded',
    'waiting_assignment',
    'assigned',
    'working',
    'first_done',
    'client_editing',
    'review_waiting',
    'final_done',
    'pdf_sent',
    'cancelled'
  ) NOT NULL DEFAULT 'uploaded',
  assigned_transcriber_id BIGINT NULL,
  assigned_at DATETIME NULL,
  assigned_admin_id BIGINT NULL,
  r2_voice_key VARCHAR(255) NOT NULL,
  r2_transcript_key VARCHAR(255) NULL,
  final_pdf_r2_key VARCHAR(255) NULL,
  final_pdf_filename VARCHAR(255) NULL,
  selected_segments_json JSON NULL,
  transcript_version INT NOT NULL DEFAULT 1,
  speaker_count INT NULL,
  memo TEXT NULL,
  internal_note TEXT NULL,
  sales_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  extra_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  final_bill_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  settlement_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_status ENUM('unpaid', 'partial_paid', 'paid') NOT NULL DEFAULT 'unpaid',
  settlement_status ENUM('waiting', 'confirmed', 'paid') NOT NULL DEFAULT 'waiting',
  finalized_at DATETIME NULL,
  final_pdf_generated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_jobs_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_jobs_project
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_jobs_transcriber
    FOREIGN KEY (assigned_transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_jobs_admin
    FOREIGN KEY (assigned_admin_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  KEY idx_jobs_status (status),
  KEY idx_jobs_due_at (due_at),
  KEY idx_jobs_uploaded_at (uploaded_at),
  KEY idx_jobs_client_id (client_id),
  KEY idx_jobs_project_id (project_id),
  KEY idx_jobs_assigned_transcriber_id (assigned_transcriber_id),
  KEY idx_jobs_assigned_at (assigned_at),
  KEY idx_jobs_priority_status (priority, status),
  KEY idx_jobs_payment_status (payment_status),
  KEY idx_jobs_settlement_status (settlement_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS job_assignments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(12) NOT NULL,
  from_transcriber_id BIGINT NULL,
  to_transcriber_id BIGINT NULL,
  assigned_by_admin_id BIGINT NULL,
  assignment_type ENUM('manual', 'bulk', 'reassign', 'auto') NOT NULL DEFAULT 'manual',
  reason VARCHAR(255) NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_job_assignments_job
    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_job_assignments_from_transcriber
    FOREIGN KEY (from_transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_job_assignments_to_transcriber
    FOREIGN KEY (to_transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_job_assignments_admin
    FOREIGN KEY (assigned_by_admin_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  KEY idx_job_assignments_job_id (job_id),
  KEY idx_job_assignments_to_transcriber_id (to_transcriber_id),
  KEY idx_job_assignments_assigned_at (assigned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS job_status_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(12) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NOT NULL,
  changed_by_admin_id BIGINT NULL,
  changed_by_transcriber_id BIGINT NULL,
  change_note VARCHAR(255) NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_job_status_logs_job
    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_job_status_logs_admin
    FOREIGN KEY (changed_by_admin_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_job_status_logs_transcriber
    FOREIGN KEY (changed_by_transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  KEY idx_job_status_logs_job_id (job_id),
  KEY idx_job_status_logs_to_status (to_status),
  KEY idx_job_status_logs_changed_at (changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS job_notes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(12) NOT NULL,
  author_admin_id BIGINT NULL,
  author_transcriber_id BIGINT NULL,
  note_type ENUM('internal', 'client_request', 'assignment', 'billing', 'quality') NOT NULL DEFAULT 'internal',
  content TEXT NOT NULL,
  is_private TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_job_notes_job
    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_job_notes_admin
    FOREIGN KEY (author_admin_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_job_notes_transcriber
    FOREIGN KEY (author_transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  KEY idx_job_notes_job_id (job_id),
  KEY idx_job_notes_type (note_type),
  KEY idx_job_notes_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  CONSTRAINT fk_transcript_change_logs_job
    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transcript_shares (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(12) NOT NULL,
  token VARCHAR(96) NOT NULL,
  created_by_member_id BIGINT NULL,
  expires_at DATETIME NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  allow_audio TINYINT(1) NOT NULL DEFAULT 1,
  allow_pdf_download TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_transcript_shares_token (token),
  KEY idx_transcript_shares_job_id (job_id),
  KEY idx_transcript_shares_member_id (created_by_member_id),
  KEY idx_transcript_shares_expires_at (expires_at),
  CONSTRAINT fk_transcript_shares_job
    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_transcript_shares_member
    FOREIGN KEY (created_by_member_id) REFERENCES members(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS job_inquiry_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(12) NOT NULL,
  thread_type VARCHAR(30) NOT NULL,
  sender_role VARCHAR(20) NOT NULL,
  sender_name VARCHAR(100) NOT NULL,
  sender_member_id BIGINT NULL,
  sender_transcriber_id BIGINT NULL,
  sender_admin_id BIGINT NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_job_inquiry_messages_job_id (job_id),
  KEY idx_job_inquiry_messages_thread_type (thread_type),
  KEY idx_job_inquiry_messages_sender_role (sender_role),
  KEY idx_job_inquiry_messages_sender_member_id (sender_member_id),
  KEY idx_job_inquiry_messages_sender_transcriber_id (sender_transcriber_id),
  KEY idx_job_inquiry_messages_sender_admin_id (sender_admin_id),
  KEY idx_job_inquiry_messages_created_at (created_at),
  CONSTRAINT fk_job_inquiry_messages_job
    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_job_inquiry_messages_member
    FOREIGN KEY (sender_member_id) REFERENCES members(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_job_inquiry_messages_transcriber
    FOREIGN KEY (sender_transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_job_inquiry_messages_admin
    FOREIGN KEY (sender_admin_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS member_push_subscriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  member_id BIGINT NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh_key VARCHAR(255) NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_member_push_subscriptions_member
    FOREIGN KEY (member_id) REFERENCES members(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE KEY uq_member_push_subscriptions_endpoint (endpoint(255)),
  KEY idx_member_push_subscriptions_member_id (member_id),
  KEY idx_member_push_subscriptions_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  admin_user_id BIGINT NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh_key VARCHAR(255) NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_push_subscriptions_admin_user
    FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE KEY uq_admin_push_subscriptions_endpoint (endpoint(255)),
  KEY idx_admin_push_subscriptions_admin_user_id (admin_user_id),
  KEY idx_admin_push_subscriptions_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(50) NOT NULL,
  job_id VARCHAR(12) NOT NULL,
  client_id BIGINT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NULL,
  base_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  extra_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  vat_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  invoice_status ENUM('draft', 'issued', 'partial_paid', 'paid', 'cancelled') NOT NULL DEFAULT 'draft',
  memo TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_invoices_invoice_no (invoice_no),
  CONSTRAINT fk_invoices_job
    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_invoices_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  KEY idx_invoices_job_id (job_id),
  KEY idx_invoices_client_id (client_id),
  KEY idx_invoices_issue_date (issue_date),
  KEY idx_invoices_status (invoice_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  invoice_id BIGINT NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_method ENUM('bank_transfer', 'card', 'cash', 'other') NOT NULL DEFAULT 'bank_transfer',
  payer_name VARCHAR(100) NULL,
  reference_no VARCHAR(100) NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoice_payments_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  KEY idx_invoice_payments_invoice_id (invoice_id),
  KEY idx_invoice_payments_payment_date (payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settlements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  settlement_no VARCHAR(50) NOT NULL,
  transcriber_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_jobs INT NOT NULL DEFAULT 0,
  total_minutes INT NOT NULL DEFAULT 0,
  gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  adjustment_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  final_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('draft', 'confirmed', 'paid') NOT NULL DEFAULT 'draft',
  confirmed_by_admin_id BIGINT NULL,
  confirmed_at DATETIME NULL,
  paid_at DATETIME NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_settlements_no (settlement_no),
  CONSTRAINT fk_settlements_transcriber
    FOREIGN KEY (transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_settlements_admin
    FOREIGN KEY (confirmed_by_admin_id) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  KEY idx_settlements_transcriber_id (transcriber_id),
  KEY idx_settlements_period (period_start, period_end),
  KEY idx_settlements_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settlement_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  settlement_id BIGINT NOT NULL,
  job_id VARCHAR(12) NOT NULL,
  transcriber_id BIGINT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity_minutes INT NOT NULL DEFAULT 0,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  adjustment_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  final_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_settlement_items_settlement
    FOREIGN KEY (settlement_id) REFERENCES settlements(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_settlement_items_job
    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_settlement_items_transcriber
    FOREIGN KEY (transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE KEY uk_settlement_items_job (settlement_id, job_id),
  KEY idx_settlement_items_transcriber_id (transcriber_id),
  KEY idx_settlement_items_job_id (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
