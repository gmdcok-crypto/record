-- TelWork: store multiple work ranges as JSON

ALTER TABLE phone_consultations
  ADD COLUMN ranges_json TEXT NULL AFTER range_end;
