-- Delete all test jobs and transcribers (keeps clients/admin_users tables).
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM settlement_items;
DELETE FROM settlements;
DELETE FROM invoice_payments;
DELETE FROM invoices;
DELETE FROM job_notes;
DELETE FROM job_status_logs;
DELETE FROM job_assignments;
DELETE FROM jobs;
DELETE FROM transcribers;
DELETE FROM transcript_history;

SET FOREIGN_KEY_CHECKS = 1;
