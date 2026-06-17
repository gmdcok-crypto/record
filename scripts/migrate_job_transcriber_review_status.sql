ALTER TABLE jobs
  MODIFY COLUMN status ENUM(
    'uploaded',
    'waiting_assignment',
    'assigned',
    'working',
    'first_done',
    'client_editing',
    'review_waiting',
    'transcriber_review',
    'final_done',
    'pdf_sent',
    'cancelled'
  ) NOT NULL DEFAULT 'uploaded';
