-- Store transcriber license/certificate file reference in R2.

ALTER TABLE transcribers
  ADD COLUMN license_r2_key VARCHAR(255) NULL COMMENT '속기사 자격증 R2 key',
  ADD COLUMN license_filename VARCHAR(255) NULL COMMENT '속기사 자격증 원본 파일명';
