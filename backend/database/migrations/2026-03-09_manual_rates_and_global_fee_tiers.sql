-- Add manual mode columns to rates
SET @db_name = DATABASE();

SET @has_manual_rate_rub = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'rates'
    AND column_name = 'manual_rate_rub'
);
SET @sql = IF(
  @has_manual_rate_rub = 0,
  'ALTER TABLE `rates` ADD COLUMN `manual_rate_rub` decimal(20,8) DEFAULT NULL AFTER `rate_rub`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_is_manual = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'rates'
    AND column_name = 'is_manual'
);
SET @sql = IF(
  @has_is_manual = 0,
  'ALTER TABLE `rates` ADD COLUMN `is_manual` tinyint(1) NOT NULL DEFAULT ''0'' AFTER `manual_rate_rub`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Create global fee tiers table (ranges by amount for BUY/SELL)
CREATE TABLE IF NOT EXISTS `rate_fee_tiers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `coin` enum('BTC','LTC','XMR') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `dir` enum('BUY','SELL') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `min_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `max_amount` decimal(15,2) DEFAULT NULL,
  `fee_percent` decimal(6,4) NOT NULL DEFAULT '0.0000',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_coin_dir_min` (`coin`,`dir`,`min_amount`),
  KEY `idx_coin_dir_range` (`coin`,`dir`,`min_amount`,`max_amount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
