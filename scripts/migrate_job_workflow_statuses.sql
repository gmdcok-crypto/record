-- Normalize legacy job workflow statuses to the 6-step model.
UPDATE jobs SET status = 'working' WHERE status = 'assigned';
UPDATE jobs SET status = 'client_review' WHERE status IN ('first_done', 'client_editing');
UPDATE jobs SET status = 'transcript_request' WHERE status = 'review_waiting';
UPDATE jobs SET status = 'pdf_sent' WHERE status = 'final_done';
UPDATE jobs SET status = 'waiting_assignment' WHERE status = 'uploaded';

UPDATE job_status_logs SET from_status = 'working' WHERE from_status = 'assigned';
UPDATE job_status_logs SET to_status = 'working' WHERE to_status = 'assigned';
UPDATE job_status_logs SET from_status = 'client_review' WHERE from_status IN ('first_done', 'client_editing');
UPDATE job_status_logs SET to_status = 'client_review' WHERE to_status IN ('first_done', 'client_editing');
UPDATE job_status_logs SET from_status = 'transcript_request' WHERE from_status = 'review_waiting';
UPDATE job_status_logs SET to_status = 'transcript_request' WHERE to_status = 'review_waiting';
UPDATE job_status_logs SET from_status = 'pdf_sent' WHERE from_status = 'final_done';
UPDATE job_status_logs SET to_status = 'pdf_sent' WHERE to_status = 'final_done';
UPDATE job_status_logs SET from_status = 'waiting_assignment' WHERE from_status = 'uploaded';
UPDATE job_status_logs SET to_status = 'waiting_assignment' WHERE to_status = 'uploaded';
