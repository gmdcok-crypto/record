-- TelWork: add sex (gender) column

ALTER TABLE phone_consultations
  ADD COLUMN sex VARCHAR(20) NOT NULL DEFAULT 'unknown' AFTER phone;
