CREATE TABLE IF NOT EXISTS transcriber_push_subscriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  transcriber_id BIGINT NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh_key VARCHAR(255) NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transcriber_push_subscriptions_transcriber
    FOREIGN KEY (transcriber_id) REFERENCES transcribers(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE KEY uq_transcriber_push_subscriptions_endpoint (endpoint(255)),
  KEY idx_transcriber_push_subscriptions_transcriber_id (transcriber_id),
  KEY idx_transcriber_push_subscriptions_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
