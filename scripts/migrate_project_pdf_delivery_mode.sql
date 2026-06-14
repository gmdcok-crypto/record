ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS pdf_delivery_mode VARCHAR(20) NOT NULL DEFAULT 'individual';
