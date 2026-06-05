-- Extend transcriber profile fields for admin registration.
-- Safe to run multiple times only if your MySQL version supports the checks below.

ALTER TABLE transcribers
  MODIFY COLUMN phone VARCHAR(30) NULL COMMENT '휴대폰 번호',
  MODIFY COLUMN resident_id_masked VARCHAR(30) NULL COMMENT '주민등록번호',
  MODIFY COLUMN bank_name VARCHAR(100) NULL COMMENT '은행명',
  MODIFY COLUMN account_number VARCHAR(100) NULL COMMENT '계좌번호',
  MODIFY COLUMN account_holder VARCHAR(100) NULL COMMENT '예금주';
