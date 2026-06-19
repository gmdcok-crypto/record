ALTER TABLE admin_users
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER phone;
