ALTER TABLE transcribers
  ADD COLUMN grade_level INT NOT NULL DEFAULT 1 AFTER status;
