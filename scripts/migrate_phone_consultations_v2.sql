-- TelWork consultation schema v2 (idempotent column upgrades)

ALTER TABLE phone_consultations
  ADD COLUMN order_type VARCHAR(20) NOT NULL DEFAULT '' AFTER inquiry_type;

ALTER TABLE phone_consultations
  ADD COLUMN file_kind VARCHAR(20) NOT NULL DEFAULT '' AFTER order_type;

ALTER TABLE phone_consultations
  ADD COLUMN file_count VARCHAR(30) NOT NULL DEFAULT '' AFTER file_kind;

ALTER TABLE phone_consultations
  ADD COLUMN range_start VARCHAR(16) NOT NULL DEFAULT '' AFTER file_count;

ALTER TABLE phone_consultations
  ADD COLUMN range_end VARCHAR(16) NOT NULL DEFAULT '' AFTER range_start;

ALTER TABLE phone_consultations
  ADD COLUMN duration_seconds INT NOT NULL DEFAULT 0 AFTER range_end;

ALTER TABLE phone_consultations
  ADD COLUMN estimated_amount INT NOT NULL DEFAULT 0 AFTER duration_seconds;

ALTER TABLE phone_consultations
  ADD COLUMN delivery_method VARCHAR(20) NOT NULL DEFAULT '' AFTER deadline;

ALTER TABLE phone_consultations
  ADD COLUMN assignee VARCHAR(100) NOT NULL DEFAULT '' AFTER memo;

ALTER TABLE phone_consultations
  MODIFY COLUMN inquiry_type VARCHAR(30) NOT NULL DEFAULT '';

ALTER TABLE phone_consultations
  MODIFY COLUMN memo VARCHAR(500) NULL;

ALTER TABLE phone_consultations
  MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'draft';
