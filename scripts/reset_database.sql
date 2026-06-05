-- Full database reset for fresh testing.
-- Run in Railway MySQL console, then re-run init scripts if needed.
-- Prefer: python scripts/reset_database.py (uses init SQL automatically)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS settlement_items;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS invoice_payments;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS job_notes;
DROP TABLE IF EXISTS job_status_logs;
DROP TABLE IF EXISTS job_assignments;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS transcribers;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS transcript_history;

SET FOREIGN_KEY_CHECKS = 1;

-- After this file, run:
--   scripts/init_admin_schema.sql
--   scripts/init_transcript_history.sql
