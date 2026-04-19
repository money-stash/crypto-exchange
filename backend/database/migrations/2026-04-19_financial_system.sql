-- ============================================================
-- Financial system: shifts, profit tracking, operator types
-- ============================================================

SET @db_name = DATABASE();

-- ── 1. operator_shifts ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS `operator_shifts` (
  `id`                   BIGINT       NOT NULL AUTO_INCREMENT,
  `support_id`           BIGINT       NOT NULL,
  `started_at`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at`             TIMESTAMP    NULL,
  `status`               ENUM('active','closed') NOT NULL DEFAULT 'active',
  `planned_duration_min` INT          NOT NULL DEFAULT 480,  -- 8 hours default
  `actual_duration_min`  INT          NULL,
  `early_close_penalty`  DECIMAL(10,2) NOT NULL DEFAULT 0,
  `orders_completed`     INT          NOT NULL DEFAULT 0,
  `total_volume_rub`     DECIMAL(20,2) NOT NULL DEFAULT 0,
  `total_profit_rub`     DECIMAL(20,2) NOT NULL DEFAULT 0,
  `notes`                TEXT         NULL,
  `created_at`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_shifts_support_id` (`support_id`),
  KEY `idx_shifts_status` (`status`),
  KEY `idx_shifts_started_at` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Add columns to orders ────────────────────────────────

SET @col = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db_name AND table_name='orders' AND column_name='operator_received_usdt');
SET @sql = IF(@col=0,
  'ALTER TABLE orders ADD COLUMN operator_received_usdt DECIMAL(20,8) NULL AFTER cancel_reason',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db_name AND table_name='orders' AND column_name='operator_rate_rub');
SET @sql = IF(@col=0,
  'ALTER TABLE orders ADD COLUMN operator_rate_rub DECIMAL(20,8) NULL AFTER operator_received_usdt',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db_name AND table_name='orders' AND column_name='operator_profit_rub');
SET @sql = IF(@col=0,
  'ALTER TABLE orders ADD COLUMN operator_profit_rub DECIMAL(20,2) NULL AFTER operator_rate_rub',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db_name AND table_name='orders' AND column_name='shift_id');
SET @sql = IF(@col=0,
  'ALTER TABLE orders ADD COLUMN shift_id BIGINT NULL AFTER operator_profit_rub',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 3. Add columns to supports ──────────────────────────────

SET @col = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db_name AND table_name='supports' AND column_name='operator_type');
SET @sql = IF(@col=0,
  'ALTER TABLE supports ADD COLUMN operator_type ENUM(''manual'',''card'',''auto'') NOT NULL DEFAULT ''manual'' AFTER role',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db_name AND table_name='supports' AND column_name='shift_duration_min');
SET @sql = IF(@col=0,
  'ALTER TABLE supports ADD COLUMN shift_duration_min INT NOT NULL DEFAULT 480 AFTER operator_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db_name AND table_name='supports' AND column_name='penalty_per_hour');
SET @sql = IF(@col=0,
  'ALTER TABLE supports ADD COLUMN penalty_per_hour DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER shift_duration_min',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=@db_name AND table_name='supports' AND column_name='rapira_offset');
SET @sql = IF(@col=0,
  'ALTER TABLE supports ADD COLUMN rapira_offset DECIMAL(5,2) NOT NULL DEFAULT 4.00 AFTER penalty_per_hour',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 4. monthly_summaries ────────────────────────────────────

CREATE TABLE IF NOT EXISTS `monthly_summaries` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `period`          DATE         NOT NULL,               -- first day of month
  `support_id`      BIGINT       NULL,                   -- NULL = overall
  `operator_type`   ENUM('manual','card','auto','all') NOT NULL DEFAULT 'all',
  `orders_count`    INT          NOT NULL DEFAULT 0,
  `volume_rub`      DECIMAL(20,2) NOT NULL DEFAULT 0,
  `profit_rub`      DECIMAL(20,2) NOT NULL DEFAULT 0,
  `shifts_count`    INT          NOT NULL DEFAULT 0,
  `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_summary` (`period`,`support_id`,`operator_type`),
  KEY `idx_summary_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
