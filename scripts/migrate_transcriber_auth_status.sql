-- Track whether a transcriber can log in (active) or must re-register (pending_signup).
ALTER TABLE transcribers
  ADD COLUMN auth_status VARCHAR(20) NOT NULL DEFAULT 'pending_signup' COMMENT 'active | pending_signup';

UPDATE transcribers
SET auth_status = 'active'
WHERE login_id IS NOT NULL AND password_hash IS NOT NULL;
