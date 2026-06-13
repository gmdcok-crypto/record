ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS assigned_at DATETIME NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_assigned_at ON jobs (assigned_at);

UPDATE jobs j
LEFT JOIN (
  SELECT job_id, MAX(assigned_at) AS latest_assigned_at
  FROM job_assignments
  WHERE to_transcriber_id IS NOT NULL
  GROUP BY job_id
) a ON a.job_id = j.job_id
SET j.assigned_at = CASE
  WHEN j.assigned_transcriber_id IS NOT NULL THEN a.latest_assigned_at
  ELSE NULL
END
WHERE j.assigned_at IS NULL;
