-- TelWork: store consultation completed date and time

ALTER TABLE tel_work
  ADD COLUMN completed_at DATETIME NULL AFTER status,
  ADD COLUMN completed_date DATE NULL AFTER completed_at,
  ADD COLUMN completed_time TIME NULL AFTER completed_date;

ALTER TABLE tel_work
  ADD KEY idx_tel_work_completed_at (completed_at);
