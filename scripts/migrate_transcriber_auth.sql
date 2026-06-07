-- Add self-service login fields for transcriber PWA JWT auth.
ALTER TABLE transcribers
  ADD COLUMN login_id VARCHAR(8) NULL COMMENT '속기사 로그인 ID (영문/숫자 8자)',
  ADD COLUMN password_hash VARCHAR(255) NULL COMMENT 'bcrypt password hash';

CREATE UNIQUE INDEX uk_transcribers_login_id ON transcribers (login_id);
