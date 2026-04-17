CREATE TABLE IF NOT EXISTS system_settings (
  `key` VARCHAR(128) NOT NULL,
  `value` TEXT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO system_settings (`key`, `value`)
VALUES ('company_usdt_wallet_trc20', '')
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);

INSERT INTO system_settings (`key`, `value`)
VALUES ('rapira_usdtrub_cache', NULL)
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);

INSERT INTO system_settings (`key`, `value`)
VALUES ('rapira_usdtrub_cached_at', NULL)
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);


CREATE TABLE IF NOT EXISTS operator_usdt_debts (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `support_id` BIGINT NOT NULL,
  `order_id` BIGINT NOT NULL,
  `sum_rub_locked` DECIMAL(20,2) NOT NULL,
  `rapira_rate_rub` DECIMAL(20,8) NOT NULL,
  `markup_rub` DECIMAL(20,8) NOT NULL DEFAULT 4.00000000,
  `usdt_due` DECIMAL(20,6) NOT NULL,
  `usdt_paid` DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
  `rub_released` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('OPEN','PARTIALLY_PAID','PAID') NOT NULL DEFAULT 'OPEN',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_operator_usdt_debts_order_id` (`order_id`),
  KEY `idx_operator_usdt_debts_support_status` (`support_id`, `status`),
  CONSTRAINT `fk_operator_usdt_debts_support` FOREIGN KEY (`support_id`) REFERENCES supports(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_operator_usdt_debts_order` FOREIGN KEY (`order_id`) REFERENCES orders(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS operator_usdt_payment_intents (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `support_id` BIGINT NOT NULL,
  `requested_usdt` DECIMAL(20,6) NOT NULL,
  `exact_usdt` DECIMAL(20,6) NOT NULL,
  `company_wallet` VARCHAR(128) NOT NULL,
  `status` ENUM('OPEN','CONSUMED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `consumed_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_operator_usdt_payment_intents_support_status_expires` (`support_id`, `status`, `expires_at`),
  CONSTRAINT `fk_operator_usdt_payment_intents_support` FOREIGN KEY (`support_id`) REFERENCES supports(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS operator_usdt_payments (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `support_id` BIGINT NOT NULL,
  `intent_id` BIGINT NOT NULL,
  `tx_hash` VARCHAR(128) NOT NULL,
  `declared_amount_usdt` DECIMAL(20,6) NULL,
  `actual_amount_usdt` DECIMAL(20,6) NULL,
  `confirmations` INT NOT NULL DEFAULT 0,
  `to_address` VARCHAR(128) NULL,
  `from_address` VARCHAR(128) NULL,
  `status` ENUM('PENDING','CONFIRMED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `reject_reason` VARCHAR(255) NULL,
  `network` ENUM('TRC20') NOT NULL DEFAULT 'TRC20',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `confirmed_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_operator_usdt_payments_tx_hash` (`tx_hash`),
  KEY `idx_operator_usdt_payments_support_status` (`support_id`, `status`),
  KEY `idx_operator_usdt_payments_intent` (`intent_id`),
  CONSTRAINT `fk_operator_usdt_payments_support` FOREIGN KEY (`support_id`) REFERENCES supports(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_operator_usdt_payments_intent` FOREIGN KEY (`intent_id`) REFERENCES operator_usdt_payment_intents(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS operator_usdt_payment_allocations (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `payment_id` BIGINT NOT NULL,
  `debt_id` BIGINT NOT NULL,
  `usdt_applied` DECIMAL(20,6) NOT NULL,
  `rub_released` DECIMAL(20,2) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_operator_usdt_payment_allocations_payment_debt` (`payment_id`, `debt_id`),
  KEY `idx_operator_usdt_payment_allocations_payment` (`payment_id`),
  KEY `idx_operator_usdt_payment_allocations_debt` (`debt_id`),
  CONSTRAINT `fk_operator_usdt_payment_allocations_payment` FOREIGN KEY (`payment_id`) REFERENCES operator_usdt_payments(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_operator_usdt_payment_allocations_debt` FOREIGN KEY (`debt_id`) REFERENCES operator_usdt_debts(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
